import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { OpaEvent } from '../../../core/src/opa/events.js';
import type {
  OpaTask,
  OpaTaskCommand,
  OpaTaskQueue,
  OpaTaskRun,
  OpaUsage,
  OpaWorkData,
  TaskExecution,
  TaskRunsPage,
  TaskStatus,
} from '../../../core/src/opa/work.js';
import {
  isTask,
  isTaskExecution,
  isTaskQueue,
  isTaskRun,
  isUsage,
  taskStatuses,
} from '../../../core/src/opa/work.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { discoverAdapters } from './adapters/registry.js';
import { registerOpaProject } from './campus.js';
import { isTaskRunning } from './execution.js';

const states = new WeakMap<AgentStateStore, OpaWorkData>();
/** History never stores transient permission options/callback state. */
function historyExecution(execution: TaskExecution): TaskExecution {
  const { permissions: _permissions, ...evidence } = execution;
  void _permissions;
  return structuredClone(evidence);
}
const sameEvidence = (a: unknown, b: unknown) =>
  isDeepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
const sameRun = (run: OpaTaskRun, projectPath: string, taskId: string, runId: string) =>
  run.projectPath === projectPath && run.taskId === taskId && run.execution.runId === runId;
function state(store: AgentStateStore): OpaWorkData {
  let data = states.get(store);
  if (!data) {
    const raw = store.getAdapter()?.loadOpaWork?.();
    if (raw?.runHistoryVersion !== undefined && raw.runHistoryVersion !== 1)
      throw new WorkError('HISTORY_UNSUPPORTED');
    if (raw?.runs !== undefined && (!Array.isArray(raw.runs) || !raw.runs.every(isTaskRun)))
      throw new WorkError('HISTORY_INVALID');
    if (raw?.queueVersion !== undefined && raw.queueVersion !== 1)
      throw new WorkError('QUEUE_VERSION_UNSUPPORTED');
    if (
      raw?.queues !== undefined &&
      (!Array.isArray(raw.queues) ||
        !raw.queues.every(isTaskQueue) ||
        new Set(raw.queues.map((q) => q.projectPath)).size !== raw.queues.length)
    )
      throw new WorkError('QUEUE_HISTORY_INVALID');
    const runs: OpaTaskRun[] = (raw?.runs ?? []).map((run) => ({
      ...run,
      execution: historyExecution(
        run.execution.state === 'running'
          ? { ...run.execution, state: 'interrupted' }
          : run.execution,
      ),
    }));
    const identities = new Set<string>();
    for (const run of runs) {
      const key = JSON.stringify([run.projectPath, run.taskId, run.execution.runId]);
      if (identities.has(key)) throw new WorkError('HISTORY_INVALID');
      identities.add(key);
    }
    const tasks = (raw?.tasks ?? []).filter(isTask).map((task) => {
      if (!task.execution) return task;
      if (!isTaskExecution(task.execution)) throw new WorkError('HISTORY_INVALID');
      const recorded = runs.find((run) =>
        sameRun(run, task.projectPath, task.id, task.execution!.runId),
      );
      const execution =
        recorded?.execution ??
        historyExecution(
          task.execution.state === 'running'
            ? { ...task.execution, state: 'interrupted' }
            : task.execution,
        );
      if (!recorded)
        runs.push({
          version: 1,
          projectPath: task.projectPath,
          taskId: task.id,
          title: task.title,
          titleFromLegacyTask: true,
          execution,
        });
      return { ...task, execution };
    });
    data = { ...raw, runHistoryVersion: 1, tasks, usage: (raw?.usage ?? []).filter(isUsage), runs };
    // Persist migration/recovery before publishing it. Never silently resume a process.
    if (JSON.stringify(data) !== JSON.stringify(raw)) {
      try {
        store.getAdapter()?.saveOpaWork?.(data);
      } catch {
        throw new WorkError('STORAGE_FAILED');
      }
    }
    states.set(store, data);
  }
  return data;
}
export function opaWorkSnapshot(store: AgentStateStore) {
  const data = state(store);
  return {
    type: 'opaWorkState' as const,
    tasks: data.tasks.map((task) =>
      task.execution?.state === 'running' && !isTaskRunning(store, task)
        ? { ...task, execution: { ...task.execution, state: 'interrupted' } }
        : task,
    ),
    usage: data.usage,
    queues: (data.queues ?? []).map(({ receipts: _receipts, ...queue }) => {
      void _receipts;
      return queue;
    }),
    executors: discoverAdapters()
      .adapters.filter((adapter) => adapter.status === 'available')
      .map(({ id, name, transport, capabilities }) => ({ id, name, transport, capabilities })),
  };
}
function save(store: AgentStateStore, data: OpaWorkData): void {
  // Commit before publication. A failed write must not acknowledge lost work.
  try {
    store.getAdapter()?.saveOpaWork?.(data);
  } catch {
    throw new WorkError('STORAGE_FAILED');
  }
  states.set(store, data);
  store.broadcast({ ...opaWorkSnapshot(store) });
}
export class WorkError extends Error {}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}

export function changeTask(
  store: AgentStateStore,
  raw: Record<string, unknown>,
  now = Date.now(),
): OpaTask {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new WorkError('TASK_INVALID');
  if (
    !text(raw.projectPath, 8192) ||
    !text(raw.requestId, 200) ||
    !['create', 'update'].includes(raw.action as string)
  )
    throw new WorkError('TASK_INVALID');
  if (raw.title !== undefined && !text(raw.title, 2000)) throw new WorkError('TASK_INVALID');
  if (raw.assignee !== undefined && (typeof raw.assignee !== 'string' || raw.assignee.length > 200))
    throw new WorkError('TASK_INVALID');
  if (raw.status !== undefined && !taskStatuses.includes(raw.status as TaskStatus))
    throw new WorkError('TASK_INVALID');
  if (raw.taskId !== undefined && !text(raw.taskId, 200)) throw new WorkError('TASK_INVALID');
  const command = raw as OpaTaskCommand;
  const projectPath = toPathKey(command.projectPath);
  const data = state(store);
  const id = command.taskId ?? command.requestId ?? randomUUID();
  const existing = data.tasks.find((t) => t.id === id && t.projectPath === projectPath);
  let task: OpaTask;
  if (command.action === 'create') {
    if (!text(command.title, 2000)) throw new WorkError('TASK_INVALID');
    if (existing) {
      if (
        existing.title === command.title.trim() &&
        existing.assignee === (command.assignee?.trim() || undefined)
      )
        return existing;
      throw new WorkError('TASK_CONFLICT');
    }
    task = {
      id,
      projectPath,
      title: command.title.trim(),
      assignee: command.assignee?.trim() || undefined,
      status: command.status ?? 'open',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    if (!existing) throw new WorkError('TASK_NOT_FOUND');
    if (command.expectedRevision !== existing.revision) throw new WorkError('TASK_CONFLICT');
    task = {
      ...existing,
      title: command.title?.trim() ?? existing.title,
      status: command.status ?? existing.status,
      assignee:
        command.assignee === undefined ? existing.assignee : command.assignee.trim() || undefined,
      revision: existing.revision + 1,
      updatedAt: now,
    };
  }
  save(store, {
    ...data,
    tasks: [...data.tasks.filter((t) => !(t.id === id && t.projectPath === projectPath)), task],
  });
  registerOpaProject(store, projectPath);
  return task;
}

/** Durable keys prevent journal replay from double-charging. Same source observation replaces, never adds. */
export function applyWorkEvent(store: AgentStateStore, event: OpaEvent): boolean {
  const data = state(store);
  if (event.type === 'usage.reported') {
    const usage: OpaUsage = { ...event.usage, projectPath: toPathKey(event.usage.projectPath) };
    const same = (u: OpaUsage) =>
      u.usageId === usage.usageId &&
      u.provider === usage.provider &&
      u.sessionId === usage.sessionId;
    const previous = data.usage.find(same);
    if (previous && Date.parse(previous.timestamp) > Date.parse(usage.timestamp)) return false;
    if (previous && JSON.stringify(previous) === JSON.stringify(usage)) return false;
    if (previous && previous.projectPath !== usage.projectPath)
      throw new WorkError('USAGE_PROJECT_CONFLICT');
    save(store, { ...data, usage: [...data.usage.filter((u) => !same(u)), usage] });
    registerOpaProject(store, usage.projectPath);
    return true;
  }
  if (event.type === 'task.upserted') {
    const projectPath = toPathKey(event.cwd);
    const previous = data.tasks.find((t) => t.id === event.taskId && t.projectPath === projectPath);
    if (previous && isTaskRunning(store, previous)) return false;
    const occurredAt = Math.min(Date.now(), Date.parse(event.timestamp));
    if (previous && previous.updatedAt > occurredAt) return false;
    if (
      previous &&
      previous.title === event.title.trim() &&
      previous.status === event.status &&
      previous.assignee === (event.assignee?.trim() || undefined)
    )
      return false;
    const task: OpaTask = {
      id: event.taskId,
      projectPath,
      title: event.title.trim(),
      status: event.status,
      assignee: event.assignee?.trim() || undefined,
      execution: previous?.execution,
      createdAt: previous?.createdAt ?? occurredAt,
      updatedAt: occurredAt,
      revision: (previous?.revision ?? 0) + 1,
    };
    save(store, {
      ...data,
      tasks: [
        ...data.tasks.filter((t) => !(t.id === task.id && t.projectPath === projectPath)),
        task,
      ],
    });
    registerOpaProject(store, projectPath);
    return true;
  }
  return false;
}

export function updateTaskExecution(
  store: AgentStateStore,
  task: OpaTask,
  execution: NonNullable<OpaTask['execution']>,
  status: TaskStatus,
) {
  const data = state(store);
  const current = data.tasks.find((t) => t.id === task.id && t.projectPath === task.projectPath);
  if (
    !current ||
    (current.execution &&
      current.execution.runId !== execution.runId &&
      execution.state !== 'running')
  )
    return;
  if (!isTaskExecution(execution)) throw new WorkError('TASK_INVALID');
  const runs = data.runs ?? [];
  const index = runs.findIndex((run) => sameRun(run, task.projectPath, task.id, execution.runId));
  const evidence = historyExecution(execution);
  if (index >= 0 && runs[index].execution.state !== 'running') {
    if (sameEvidence(runs[index].execution, evidence)) return;
    throw new WorkError('RUN_FINALIZED');
  }
  const run: OpaTaskRun = {
    version: 1,
    projectPath: task.projectPath,
    taskId: task.id,
    title: index < 0 ? current.title : runs[index].title,
    titleFromLegacyTask: index < 0 ? undefined : runs[index].titleFromLegacyTask,
    execution: evidence,
  };
  const nextRuns = runs.map((r) =>
    r.projectPath === task.projectPath &&
    r.taskId === task.id &&
    r.execution.runId !== execution.runId &&
    r.execution.state === 'running'
      ? { ...r, execution: { ...r.execution, state: 'interrupted' } }
      : r,
  );
  if (index < 0) nextRuns.push(run);
  else nextRuns[index] = run;
  if (current.execution && sameEvidence(current.execution, execution) && current.status === status)
    return;
  save(store, {
    ...data,
    runs: nextRuns,
    tasks: data.tasks.map((t) =>
      t === current
        ? { ...t, execution, status, updatedAt: Date.now(), revision: t.revision + 1 }
        : t,
    ),
  });
}

/** Bounded, passive retrieval. Append order is stable even when source clocks disagree. */
export function taskRunsPage(store: AgentStateStore, raw: Record<string, unknown>): TaskRunsPage {
  if (
    !text(raw.projectPath, 8192) ||
    !text(raw.taskId, 200) ||
    (raw.limit !== undefined &&
      (!Number.isSafeInteger(raw.limit) ||
        (raw.limit as number) < 1 ||
        (raw.limit as number) > 50)) ||
    (raw.before !== undefined && !text(raw.before, 200)) ||
    (raw.runId !== undefined && !text(raw.runId, 200)) ||
    (raw.before !== undefined && raw.runId !== undefined)
  )
    throw new WorkError('RUNS_INVALID');
  const projectPath = toPathKey(raw.projectPath);
  const data = state(store);
  if (!data.tasks.some((t) => t.projectPath === projectPath && t.id === raw.taskId))
    throw new WorkError('TASK_NOT_FOUND');
  const task = data.tasks.find((t) => t.projectPath === projectPath && t.id === raw.taskId)!;
  let runs = (data.runs ?? [])
    .filter((run) => run.projectPath === projectPath && run.taskId === raw.taskId)
    .slice()
    .reverse();
  runs = runs.map((run) =>
    run.execution.state === 'running' &&
    (task.execution?.runId !== run.execution.runId || !isTaskRunning(store, task))
      ? { ...run, execution: { ...run.execution, state: 'interrupted' } }
      : run,
  );
  if (raw.runId) {
    const run = runs.find((r) => r.execution.runId === raw.runId);
    if (!run) throw new WorkError('RUN_NOT_FOUND');
    return { runs: structuredClone([run]) };
  }
  if (raw.before) {
    const before = runs.findIndex((r) => r.execution.runId === raw.before);
    if (before < 0) throw new WorkError('RUNS_CURSOR_INVALID');
    runs = runs.slice(before + 1);
  }
  const limit = (raw.limit as number | undefined) ?? 20;
  const page = runs.slice(0, limit);
  return {
    // Lists are metadata-only; selected-run queries above return bounded result evidence.
    runs: structuredClone(
      page.map((run) => {
        const execution = { ...run.execution };
        delete execution.output;
        delete execution.error;
        delete execution.usage;
        return { ...run, execution };
      }),
    ),
    nextCursor: runs.length > limit ? page.at(-1)!.execution.runId : undefined,
  };
}
export function taskRunsReply(store: AgentStateStore, raw: Record<string, unknown>) {
  const requestId = text(raw.requestId, 200) ? raw.requestId : '';
  try {
    if (!requestId) throw new WorkError('RUNS_INVALID');
    return { type: 'opaTaskRunsPage' as const, requestId, ...taskRunsPage(store, raw) };
  } catch (error) {
    return {
      type: 'opaTaskRunsPage' as const,
      requestId,
      runs: [],
      error: error instanceof WorkError ? error.message : 'RUNS_INVALID',
    };
  }
}

export function taskQueue(store: AgentStateStore, projectPath: string): OpaTaskQueue {
  const path = toPathKey(projectPath);
  return structuredClone(
    state(store).queues?.find((q) => q.projectPath === path) ?? {
      projectPath: path,
      revision: 0,
      paused: false,
      taskIds: [],
      receipts: [],
    },
  );
}
export function saveTaskQueue(store: AgentStateStore, queue: OpaTaskQueue): void {
  if (!isTaskQueue(queue)) throw new WorkError('QUEUE_INVALID');
  const data = state(store);
  save(store, {
    ...data,
    queueVersion: 1,
    queues: [...(data.queues ?? []).filter((q) => q.projectPath !== queue.projectPath), queue],
  });
  registerOpaProject(store, queue.projectPath);
}
