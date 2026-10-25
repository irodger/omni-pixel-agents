import { randomUUID } from 'node:crypto';

import type { OpaEvent } from '../../../core/src/opa/events.js';
import type {
  OpaTask,
  OpaTaskCommand,
  OpaUsage,
  OpaWorkData,
  TaskStatus,
} from '../../../core/src/opa/work.js';
import { isTask, isUsage, taskStatuses } from '../../../core/src/opa/work.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { registerOpaProject } from './campus.js';
import { availableExecutors, isTaskRunning } from './execution.js';

const states = new WeakMap<AgentStateStore, OpaWorkData>();
function state(store: AgentStateStore): OpaWorkData {
  let data = states.get(store);
  if (!data) {
    const raw = store.getAdapter()?.loadOpaWork?.();
    data = { tasks: raw?.tasks.filter(isTask) ?? [], usage: raw?.usage.filter(isUsage) ?? [] };
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
    executors: availableExecutors().map(({ id, name }) => ({ id, name })),
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
  save(store, {
    ...data,
    tasks: data.tasks.map((t) =>
      t === current
        ? { ...t, execution, status, updatedAt: Date.now(), revision: t.revision + 1 }
        : t,
    ),
  });
}
