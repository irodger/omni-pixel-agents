import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { accessSync, appendFileSync, constants, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createInterface } from 'node:readline';

import type { OpaEvent } from '../../../core/src/opa/events.js';
import { OpaNormalizer } from '../../../core/src/opa/normalize.js';
import type { OpaTask } from '../../../core/src/opa/work.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { OpaOffice } from './office.js';
import { changeTask, opaWorkSnapshot, updateTaskExecution, WorkError } from './work.js';

const probes = new Map<string, { time: number; ok: boolean }>();
export function availableExecutors() {
  return ['codex', 'opencode'].flatMap((id) => {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const executable = join(dir, process.platform === 'win32' ? `${id}.exe` : id);
      try {
        accessSync(executable, constants.X_OK);
        let probe = probes.get(executable);
        if (!probe || Date.now() - probe.time > 60000) {
          let ok = false;
          try {
            execFileSync(executable, ['--version'], {
              timeout: 3000,
              input: '',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            ok = true;
          } catch {
            /* Installed but unusable. */
          }
          probe = { time: Date.now(), ok };
          probes.set(executable, probe);
        }
        if (!probe.ok) continue;
        return [{ id, name: id === 'codex' ? 'Codex' : 'OpenCode', executable }];
      } catch {
        /* Try the next PATH entry. */
      }
    }
    return [];
  });
}
const runs = new WeakMap<AgentStateStore, Map<string, { runId: string; stop: () => void }>>();
const key = (task: OpaTask) => JSON.stringify([task.projectPath, task.id]);
export function executeTaskCommand(store: AgentStateStore, raw: Record<string, unknown>): OpaTask {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    typeof raw.projectPath !== 'string' ||
    (raw.launch !== undefined && typeof raw.launch !== 'boolean')
  )
    throw new WorkError('TASK_INVALID');
  raw = { ...raw, projectPath: toPathKey(raw.projectPath) };
  const before = opaWorkSnapshot(store).tasks.find(
    (t) => t.id === (raw.taskId ?? raw.requestId) && t.projectPath === raw.projectPath,
  );
  const selected = raw.assignee === undefined ? before?.assignee : raw.assignee;
  const launch =
    !!selected &&
    (raw.launch === true || (!before && raw.action === 'create') || selected !== before?.assignee);
  const active = runs.get(store)?.get(before ? key(before) : '');
  if (active && raw.action === 'create') return changeTask(store, raw);
  if (active && raw.status !== 'cancelled') throw new WorkError('TASK_RUNNING');
  const executor = availableExecutors().find((e) => e.id === selected);
  if (launch) {
    if (!executor) throw new WorkError('EXECUTOR_UNAVAILABLE');
    if (raw.status === 'done' || raw.status === 'cancelled') throw new WorkError('TASK_INVALID');
    try {
      if (!statSync(String(raw.projectPath)).isDirectory()) throw Error();
    } catch {
      throw new WorkError('PROJECT_UNAVAILABLE');
    }
    if (
      opaWorkSnapshot(store).tasks.some(
        (t) => t.projectPath === raw.projectPath && runs.get(store)?.has(key(t)),
      )
    )
      throw new WorkError('PROJECT_BUSY');
  }
  if (launch && before && ['done', 'cancelled'].includes(before.status) && raw.status !== 'open')
    throw new WorkError('TASK_INVALID');
  const task = changeTask(store, raw);
  if (active && raw.status === 'cancelled') {
    active.stop();
    return task;
  }
  if (!launch || !executor || (before?.execution && raw.action === 'create')) return task;
  try {
    start(store, task, executor);
  } catch {
    throw new WorkError('LAUNCH_FAILED');
  }
  return opaWorkSnapshot(store).tasks.find((t) => key(t) === key(task))!;
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
      { runId, state: 'running', journal, startedAt },
      'in_progress',
    );
  } catch (error) {
    map.delete(key(task));
    throw error;
  }
  const normalizer = new OpaNormalizer(executor.id as 'codex' | 'opencode', task.projectPath);
  const office = new OpaOffice(store);
  let failed = false,
    completed = false,
    output = '';
  let lastEvent: OpaEvent | undefined;
  const record = (raw: unknown) => {
    for (const event of normalizer.normalize(raw)) {
      appendFileSync(journal, `${JSON.stringify(event)}\n`);
      office.accept(event);
      lastEvent = event;
      if (event.type === 'turn.failed') failed = true;
      if (event.type === 'turn.completed') completed = true;
      if (event.type === 'message' && event.role === 'assistant')
        output = (output + event.text + '\n').slice(-8000);
    }
  };
  // Arguments are passed directly, never interpolated into a shell command.
  const args =
    executor.id === 'codex'
      ? ['exec', '--json', '--sandbox', 'workspace-write', '-']
      : ['run', '--format', 'json', '--', task.title];
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
  map.set(key(task), {
    runId,
    stop: () => {
      cancelled = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 2000);
      killTimer.unref();
    },
  });
  child.stdin.on('error', () => {});
  if (executor.id === 'codex') child.stdin.end(task.title);
  else child.stdin.end();
  let error = '';
  child.stderr.on('data', (chunk) => {
    error = (error + chunk.toString()).slice(-2000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      if (executor.id === 'codex') record(event);
      else {
        // OpenCode run JSON is a separate contract from plugin events.
        const sessionID = event.sessionID;
        if (event.type === 'step_start')
          record({ type: 'session.status', properties: { sessionID, status: { type: 'busy' } } });
        if (event.type === 'text')
          output = (output + String(event.part?.text ?? '') + '\n').slice(-8000);
        if (event.type === 'error')
          record({ type: 'session.error', properties: { sessionID, error: event.error } });
        if (event.type === 'step_finish') {
          const part = event.part;
          record({
            type: 'message.updated',
            properties: {
              info: {
                id: part.id,
                sessionID,
                role: 'assistant',
                time: { completed: event.timestamp },
                tokens: part.tokens,
                cost: part.cost,
              },
            },
          });
          if (part.reason === 'stop') record({ type: 'session.idle', properties: { sessionID } });
        }
        if (event.type === 'tool_use')
          record({ type: 'message.part.updated', properties: { sessionID, part: event.part } });
      }
    } catch {
      failed = true;
      error = 'Invalid agent event stream or journal write failure';
      child.kill('SIGTERM');
    }
  });
  child.on('error', (e) => {
    failed = true;
    error = e.message;
  });
  child.on('close', (code) => {
    map.delete(key(task));
    if (killTimer) clearTimeout(killTimer);
    try {
      if (lastEvent && (cancelled || code !== 0 || !completed || failed)) {
        const event: OpaEvent = {
          ...lastEvent,
          type: 'turn.failed',
          id: randomUUID(),
          sequence: lastEvent.sequence + 1,
          timestamp: new Date().toISOString(),
          message: cancelled ? 'Task cancelled' : error || 'Agent did not complete the task',
        };
        appendFileSync(journal, JSON.stringify(event) + '\n');
        office.accept(event);
      }
      updateTaskExecution(
        store,
        task,
        {
          runId,
          journal,
          startedAt,
          state: cancelled
            ? 'cancelled'
            : code === 0 && completed && !failed
              ? 'completed'
              : 'failed',
          finishedAt: Date.now(),
          output,
          error: cancelled
            ? undefined
            : code === 0 && completed && !failed
              ? undefined
              : error || 'Agent exited without completing the task',
        },
        cancelled ? 'cancelled' : code === 0 && completed && !failed ? 'done' : 'open',
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
