import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { nativeAdapters } from '../../../core/src/opa/adapters/native.js';
import type { PermissionRequest } from '../../../core/src/opa/adapters/types.js';
import type { OpaEvent } from '../../../core/src/opa/events.js';
import type { OpaTask, TaskStatus } from '../../../core/src/opa/work.js';
import { taskStatuses } from '../../../core/src/opa/work.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { AcpClient } from './adapters/acpClient.js';
import { discoverAdapters } from './adapters/registry.js';
import { HistoryError } from './history.js';
import { OpaOffice } from './office.js';
import { changeTask, opaWorkSnapshot, taskQueue, updateTaskExecution, WorkError } from './work.js';

export function availableExecutors() {
  return discoverAdapters().executors;
}
const runs = new WeakMap<
  AgentStateStore,
  Map<string, { runId: string; stop: () => void; decide?: (id: string, option: string) => boolean }>
>();
const key = (task: OpaTask) => JSON.stringify([task.projectPath, task.id]);
export function executeTaskCommand(store: AgentStateStore, raw: Record<string, unknown>): OpaTask {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.projectPath !== 'string' ||
    typeof raw.requestId !== 'string' ||
    !raw.requestId.trim() ||
    raw.requestId.length > 200 ||
    (raw.launch !== undefined && typeof raw.launch !== 'boolean')
  )
    throw new WorkError('TASK_INVALID');
  raw = { ...raw, projectPath: toPathKey(raw.projectPath) };
  const before = opaWorkSnapshot(store).tasks.find(
    (t) => t.id === (raw.taskId ?? raw.requestId) && t.projectPath === raw.projectPath,
  );
  if (raw.action === 'move') {
    if (!before || typeof raw.taskId !== 'string') throw new WorkError('TASK_NOT_FOUND');
    if (
      ['assignee', 'launch', 'title', 'runId', 'permissionId', 'optionId'].some(
        (field) => raw[field] !== undefined,
      ) ||
      !taskStatuses.includes(raw.status as TaskStatus)
    )
      throw new WorkError('TASK_INVALID');
    if (runs.get(store)?.has(key(before))) throw new WorkError('TASK_MOVE_RUNNING');
    return changeTask(store, {
      action: 'update',
      requestId: raw.requestId,
      projectPath: before.projectPath,
      taskId: before.id,
      expectedRevision: raw.expectedRevision,
      status: raw.status,
    });
  }
  if (raw.action === 'permission') {
    const active = before && runs.get(store)?.get(key(before));
    if (
      !before ||
      !active ||
      raw.runId !== active.runId ||
      typeof raw.permissionId !== 'string' ||
      typeof raw.optionId !== 'string' ||
      !active.decide?.(raw.permissionId, raw.optionId)
    )
      throw new WorkError('PERMISSION_STALE');
    return before;
  }
  if (raw.launch === true) throw new WorkError('EXPLICIT_START_REQUIRED');
  const active = runs.get(store)?.get(before ? key(before) : '');
  if (raw.action === 'start') {
    if (!before) throw new WorkError('TASK_NOT_FOUND');
    if (taskQueue(store, before.projectPath).taskIds.includes(before.id))
      throw new WorkError('TASK_QUEUED');
    const executor = validateTaskStart(store, before, raw.expectedRevision);
    if (
      ['title', 'assignee', 'status', 'launch', 'runId', 'permissionId', 'optionId'].some(
        (field) => raw[field] !== undefined,
      )
    )
      throw new WorkError('TASK_INVALID');
    const task = changeTask(store, {
      action: 'update',
      requestId: raw.requestId,
      projectPath: before.projectPath,
      taskId: before.id,
      expectedRevision: before.revision,
      status: 'open',
    });
    try {
      start(store, task, executor);
    } catch {
      throw new WorkError('LAUNCH_FAILED');
    }
    return opaWorkSnapshot(store).tasks.find((t) => key(t) === key(task))!;
  }
  if (active && raw.action === 'create') return changeTask(store, raw);
  if (active && raw.status !== 'cancelled') throw new WorkError('TASK_RUNNING');
  const task = changeTask(store, raw);
  if (active && raw.status === 'cancelled') {
    active.stop();
    return task;
  }
  return task;
}
/** Preflight is read-only; callers must still reserve dispatch durably before spawning. */
export function validateTaskStart(
  store: AgentStateStore,
  task: OpaTask,
  expectedRevision: unknown,
) {
  if (expectedRevision !== task.revision) throw new WorkError('TASK_CONFLICT');
  if (isTaskRunning(store, task)) throw new WorkError('TASK_RUNNING');
  const executor = availableExecutors().find((e) => e.id === task.assignee);
  if (!executor) throw new WorkError('EXECUTOR_UNAVAILABLE');
  try {
    if (!statSync(task.projectPath).isDirectory()) throw Error();
  } catch {
    throw new WorkError('PROJECT_UNAVAILABLE');
  }
  if (
    opaWorkSnapshot(store).tasks.some(
      (t) => t.projectPath === task.projectPath && isTaskRunning(store, t),
    )
  )
    throw new WorkError('PROJECT_BUSY');
  return executor;
}

function start(
  store: AgentStateStore,
  task: OpaTask,
  executor: ReturnType<typeof availableExecutors>[number],
) {
  const runId = randomUUID();
  const directory = join(homedir(), '.pixel-agents', 'opa-runs');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const journal = join(directory, `${runId}.opa.jsonl`);
  appendFileSync(journal, '', { mode: 0o600 });
  const startedAt = Date.now();
  const map = runs.get(store) ?? new Map();
  runs.set(store, map);
  map.set(key(task), { runId, stop: () => {} });
  try {
    updateTaskExecution(
      store,
      task,
      { runId, executorId: executor.id, state: 'running', journal, startedAt },
      'in_progress',
    );
  } catch (error) {
    map.delete(key(task));
    throw error;
  }
  const office = new OpaOffice(store, Date.now, { origin: 'task-journal', taskId: task.id, runId });
  let failed = false,
    completed = false,
    output = '';
  let lastEvent: OpaEvent | undefined;
  let source: { provider?: string; sessionId?: string; sourceAgentId?: string } = {};
  let outputTruncated = false;
  let resultEventId: string | undefined;
  let usageOverflow = false;
  const usage = new Map<string, import('../../../core/src/opa/work.js').OpaUsage>();
  const record = (event: OpaEvent) => {
    appendFileSync(journal, `${JSON.stringify(event)}\n`);
    office.accept(event);
    lastEvent = event;
    if (event.type === 'session.started')
      source = {
        provider: event.provider,
        sessionId: event.sessionId,
        sourceAgentId: event.agentId,
      };
    if (event.type === 'usage.reported' && !usageOverflow) {
      const id = JSON.stringify([event.provider, event.sessionId, event.usage.usageId]);
      const previous = usage.get(id);
      if (usage.size >= 1000 && !previous) {
        usage.clear();
        usageOverflow = true;
      } else if (!previous || Date.parse(event.usage.timestamp) >= Date.parse(previous.timestamp))
        usage.set(id, event.usage);
    }
    if (event.type === 'turn.failed' || event.type === 'turn.completed') resultEventId = event.id;
    if (event.type === 'turn.failed') failed = true;
    if (event.type === 'turn.completed') completed = true;
    if (event.type === 'message' && event.role === 'assistant') {
      outputTruncated ||= output.length + event.text.length > 8000;
      output = (output + event.text).slice(-8000);
    }
  };
  // Arguments are passed directly, never interpolated into a shell command.
  const native = nativeAdapters.find((adapter) => adapter.id === executor.id);
  const invocation =
    executor.transport === 'acp-stdio'
      ? { args: executor.args, stdin: undefined }
      : native?.invocation(task.title);
  if (!invocation) throw new Error('No native adapter registered');
  const args = invocation.args;
  const env = { ...process.env };
  // This process owns ingestion; an installed OPA plugin must not deliver it a second time.
  delete env.OPA_URL;
  delete env.OPA_TOKEN;
  delete env.OPA_LOG;
  const child = spawn(executor.executable, args, {
    env,
    cwd: task.projectPath,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let cancelled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      /* Process already exited. */
    }
  };
  let acp: AcpClient | undefined;
  let controlledClose = false;
  const permissions = new Map<
    string,
    { request: PermissionRequest; resolve: (option: string | null) => void }
  >();
  const publishPermissions = () => {
    updateTaskExecution(
      store,
      task,
      {
        runId,
        executorId: executor.id,
        ...source,
        state: 'running',
        journal,
        startedAt,
        permissions: [...permissions.values()].map((p) => p.request),
      },
      'in_progress',
    );
  };
  map.set(key(task), {
    runId,
    decide: (id: string, option: string) => {
      const permission = permissions.get(id);
      if (!permission || !permission.request.options.some((o) => o.optionId === option))
        return false;
      permissions.delete(id);
      try {
        publishPermissions();
      } catch (error) {
        permissions.set(id, permission);
        throw error;
      }
      permission.resolve(option);
      return true;
    },
    stop: () => {
      cancelled = true;
      for (const p of permissions.values()) p.resolve(null);
      permissions.clear();
      if (acp) acp.cancel();
      else kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 2000);
      killTimer.unref();
    },
  });
  child.stdin.on('error', () => {});
  if (executor.transport !== 'acp-stdio') {
    child.stdin.end(invocation.stdin);
  }
  let error = '';
  child.stderr.on('data', (chunk) => {
    error = (error + chunk.toString()).slice(-2000);
  });
  const hooks = {
    event: record,
    permission: (request: PermissionRequest) =>
      new Promise<string | null>((resolve) => {
        permissions.set(request.id, { request, resolve });
        publishPermissions();
      }),
  };
  const receiveNative =
    executor.transport === 'native-jsonl' ? native!.stream(task.projectPath, hooks) : undefined;
  if (executor.transport === 'acp-stdio')
    acp = new AcpClient(
      (message) => child.stdin.write(JSON.stringify(message) + '\n'),
      hooks,
      executor.provider,
      task.projectPath,
    );
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      if (line.length > 1048576) throw new Error('Agent message exceeds 1 MiB');
      const event: unknown = JSON.parse(line);
      if (acp) acp.receive(event);
      else receiveNative!(event);
    } catch (failure) {
      failed = true;
      error =
        failure instanceof HistoryError
          ? `Local event history could not retain observation: ${failure.message}`
          : 'Invalid agent event stream or journal write failure';
      kill('SIGTERM');
    }
  });
  if (acp)
    void acp
      .run(task.title)
      .then(() => {
        controlledClose = true;
        child.stdin.end();
        kill('SIGTERM');
      })
      .catch((e) => {
        failed = true;
        error = e instanceof Error ? e.message : 'ACP failed';
        kill('SIGTERM');
      });
  child.on('error', (e) => {
    failed = true;
    error = e.message;
  });
  child.on('close', (code) => {
    map.delete(key(task));
    acp?.close();
    for (const p of permissions.values()) p.resolve(null);
    permissions.clear();
    if (killTimer) clearTimeout(killTimer);
    try {
      if (lastEvent && (cancelled || (code !== 0 && !controlledClose) || !completed || failed)) {
        const event: OpaEvent = {
          ...lastEvent,
          type: 'turn.failed',
          id: randomUUID(),
          sequence: lastEvent.sequence + 1,
          timestamp: new Date().toISOString(),
          message: cancelled ? 'Task cancelled' : error || 'Agent did not complete the task',
        };
        record(event);
      }
      updateTaskExecution(
        store,
        task,
        {
          runId,
          executorId: executor.id,
          ...source,
          usage: usageOverflow ? undefined : [...usage.values()],
          outputTruncated,
          resultEventId,
          journal,
          startedAt,
          state: cancelled
            ? 'cancelled'
            : (code === 0 || controlledClose) && completed && !failed
              ? 'completed'
              : 'failed',
          finishedAt: Date.now(),
          output,
          error: cancelled
            ? undefined
            : (code === 0 || controlledClose) && completed && !failed
              ? undefined
              : error || 'Agent exited without completing the task',
        },
        cancelled
          ? 'cancelled'
          : (code === 0 || controlledClose) && completed && !failed
            ? 'done'
            : 'open',
      );
    } catch {
      /* Durable running marker remains visible for recovery; never relaunch automatically. */
    }
  });
}
export function isTaskRunning(store: AgentStateStore, task: OpaTask) {
  return runs.get(store)?.has(key(task)) ?? false;
}

export function stopTaskExecutions(store: AgentStateStore) {
  for (const run of runs.get(store)?.values() ?? []) run.stop();
}
