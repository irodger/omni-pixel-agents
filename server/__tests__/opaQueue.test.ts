import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaWorkData } from '../../core/src/opa/work.js';
const sandbox = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => sandbox.home,
}));
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { executeTaskCommand, stopTaskExecutions } from '../src/opa/execution.js';
import { executeQueueCommand } from '../src/opa/queue.js';
import { registerQueueRoute } from '../src/opa/queueRoutes.js';
import { opaWorkSnapshot, taskQueue } from '../src/opa/work.js';
const roots: string[] = [];
const stores: AgentStateStore[] = [];
afterEach(() => {
  stores.forEach(stopTaskExecutions);
  vi.unstubAllEnvs();
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'opa-queue-fixture-'));
  roots.push(root);
  sandbox.home = root;
  const project = join(root, 'project');
  mkdirSync(project);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'codex'),
    `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('fixture');process.exit(0)}\nprocess.stdin.resume();process.stdin.on('end',()=>{for(const e of [{type:'thread.started',thread_id:'fixture'},{type:'turn.started'},{type:'turn.completed',usage:{input_tokens:1,output_tokens:0}}]) console.log(JSON.stringify(e));});`,
    { mode: 0o755 },
  );
  vi.stubEnv('PATH', bin);
  let saved: OpaWorkData = { tasks: [], usage: [] };
  const save = vi.fn((next: OpaWorkData) => {
    saved = structuredClone(next);
  });
  const adapter = {
    loadOpaWork: () => structuredClone(saved),
    saveOpaWork: save,
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_: string, fallback: unknown) => fallback,
    setSetting: () => {},
  } as StateAdapter;
  const restart = () => {
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    stores.push(store);
    return store;
  };
  const store = restart();
  const create = (id: string) =>
    executeTaskCommand(store, {
      action: 'create',
      requestId: id,
      projectPath: project,
      title: `Fixture ${id}`,
      assignee: 'codex',
    });
  const command = (action: string, extra: Record<string, unknown> = {}) => ({
    action,
    projectPath: project,
    requestId: crypto.randomUUID(),
    expectedRevision: taskQueue(store, project).revision,
    ...extra,
  });
  return { store, project, create, command, restart, save };
}
describe('explicit local queue', () => {
  it('keeps create/edit/assignment/enqueue/move/reorder/pause/resume passive and durable', () => {
    const f = fixture();
    const first = f.create('a');
    const second = f.create('b');
    const edit = executeTaskCommand(f.store, {
      action: 'update',
      requestId: 'edit',
      projectPath: f.project,
      taskId: first.id,
      expectedRevision: first.revision,
      title: 'Prepared fixture',
      assignee: 'missing-executor',
    });
    expect(edit.execution).toBeUndefined();
    const enqueue = f.command('enqueue', { taskId: first.id, expectedTaskRevision: edit.revision });
    executeQueueCommand(f.store, enqueue);
    executeQueueCommand(f.store, enqueue);
    executeQueueCommand(
      f.store,
      f.command('enqueue', { taskId: second.id, expectedTaskRevision: second.revision }),
    );
    executeQueueCommand(f.store, f.command('reorder', { taskIds: [second.id, first.id] }));
    executeQueueCommand(f.store, f.command('pause'));
    const restarted = f.restart();
    expect(taskQueue(restarted, f.project)).toMatchObject({ paused: true, taskIds: ['b', 'a'] });
    executeQueueCommand(restarted, {
      ...f.command('resume'),
      expectedRevision: taskQueue(restarted, f.project).revision,
    });
    expect(opaWorkSnapshot(restarted).tasks.every((t) => !t.execution)).toBe(true);
    expect(taskQueue(restarted, f.project).paused).toBe(false);
    expect(() =>
      executeTaskCommand(restarted, {
        action: 'update',
        requestId: 'legacy',
        projectPath: f.project,
        taskId: edit.id,
        expectedRevision: edit.revision,
        launch: true,
      }),
    ).toThrow('EXPLICIT_START_REQUIRED');
  });
  it('starts once, rejects stale clients and never drains the next task after completion/restart', async () => {
    const f = fixture();
    const a = f.create('a');
    const b = f.create('b');
    for (const task of [a, b])
      executeQueueCommand(
        f.store,
        f.command('enqueue', { taskId: task.id, expectedTaskRevision: task.revision }),
      );
    const start = f.command('start-next', { taskId: a.id, expectedTaskRevision: a.revision });
    executeQueueCommand(f.store, start);
    expect(() => executeQueueCommand(f.store, start)).toThrow('QUEUE_START_ALREADY_RECORDED');
    expect(() => executeQueueCommand(f.store, { ...start, requestId: 'other-client' })).toThrow(
      'QUEUE_CONFLICT',
    );
    expect(() =>
      executeQueueCommand(
        f.store,
        f.command('start-next', { taskId: b.id, expectedTaskRevision: b.revision }),
      ),
    ).toThrow('PROJECT_BUSY');
    await vi.waitFor(() =>
      expect(opaWorkSnapshot(f.store).tasks.find((t) => t.id === a.id)?.execution?.state).toBe(
        'completed',
      ),
    );
    expect(opaWorkSnapshot(f.store).tasks.find((t) => t.id === b.id)?.execution).toBeUndefined();
    expect(taskQueue(f.store, f.project).taskIds).toEqual(['b']);
    const restarted = f.restart();
    expect(taskQueue(restarted, f.project).taskIds).toEqual(['b']);
    expect(() => executeQueueCommand(restarted, start)).toThrow('QUEUE_START_ALREADY_RECORDED');
    expect(opaWorkSnapshot(restarted).tasks.find((t) => t.id === b.id)?.execution).toBeUndefined();
  });
  it('refuses paused, stale task, unavailable executor and bad reorder without consuming the head', () => {
    const f = fixture();
    const task = f.create('a');
    executeQueueCommand(
      f.store,
      f.command('enqueue', { taskId: task.id, expectedTaskRevision: task.revision }),
    );
    executeQueueCommand(f.store, f.command('pause'));
    const start = () =>
      f.command('start-next', { taskId: task.id, expectedTaskRevision: task.revision });
    expect(() => executeQueueCommand(f.store, start())).toThrow('QUEUE_PAUSED');
    executeQueueCommand(f.store, f.command('resume'));
    const changed = executeTaskCommand(f.store, {
      action: 'update',
      requestId: 'edit',
      taskId: task.id,
      projectPath: f.project,
      expectedRevision: task.revision,
      assignee: 'missing',
    });
    expect(() => executeQueueCommand(f.store, start())).toThrow('TASK_CONFLICT');
    expect(() =>
      executeQueueCommand(f.store, { ...start(), expectedTaskRevision: changed.revision }),
    ).toThrow('EXECUTOR_UNAVAILABLE');
    expect(() =>
      executeQueueCommand(f.store, f.command('reorder', { taskIds: ['missing'] })),
    ).toThrow('QUEUE_INVALID');
    expect(taskQueue(f.store, f.project).taskIds).toEqual([task.id]);
  });
  it('commits the reservation before spawn and rejects storage failure without launching', () => {
    const f = fixture();
    const task = f.create('a');
    executeQueueCommand(
      f.store,
      f.command('enqueue', { taskId: task.id, expectedTaskRevision: task.revision }),
    );
    f.save.mockImplementationOnce(() => {
      throw Error('disk fixture');
    });
    expect(() =>
      executeQueueCommand(
        f.store,
        f.command('start-next', { taskId: task.id, expectedTaskRevision: task.revision }),
      ),
    ).toThrow('STORAGE_FAILED');
    expect(opaWorkSnapshot(f.store).tasks[0].execution).toBeUndefined();
    expect(taskQueue(f.store, f.project).taskIds).toEqual([task.id]);
  });
  it('does not repeat a reservation when task persistence fails before spawn', () => {
    const f = fixture();
    const task = f.create('a');
    executeQueueCommand(
      f.store,
      f.command('enqueue', { taskId: task.id, expectedTaskRevision: task.revision }),
    );
    const persist = f.save.getMockImplementation()!;
    f.save.mockImplementationOnce(persist).mockImplementationOnce(() => {
      throw Error('crash-window fixture');
    });
    const start = f.command('start-next', { taskId: task.id, expectedTaskRevision: task.revision });
    expect(() => executeQueueCommand(f.store, start)).toThrow('STORAGE_FAILED');
    expect(taskQueue(f.store, f.project).taskIds).toEqual([]);
    expect(opaWorkSnapshot(f.store).tasks[0].execution).toBeUndefined();
    const restarted = f.restart();
    expect(() => executeQueueCommand(restarted, start)).toThrow('QUEUE_START_ALREADY_RECORDED');
    expect(opaWorkSnapshot(restarted).tasks[0].execution).toBeUndefined();
  });
  it('denies observer mutation, injected launch fields and cross-project queue access', () => {
    const f = fixture();
    const task = f.create('a');
    const command = f.command('enqueue', { taskId: task.id, expectedTaskRevision: task.revision });
    const send = vi.fn();
    handleClientMessage({ ...command, type: 'opaQueueCommand' }, send, {
      store: f.store,
      cache: null,
      privileged: false,
    });
    expect(send.mock.calls.some(([message]) => message.error === 'READ_ONLY')).toBe(true);
    expect(() => executeQueueCommand(f.store, { ...command, launch: true })).toThrow(
      'QUEUE_INVALID',
    );
    expect(() => executeQueueCommand(f.store, { ...command, projectPath: '/other' })).toThrow(
      'TASK_NOT_FOUND',
    );
    expect(taskQueue(f.store, f.project).taskIds).toEqual([]);
  });
  it('applies the HTTP authentication hook before queue mutation and returns conflicts', async () => {
    const f = fixture();
    const task = f.create('a');
    const app = Fastify();
    registerQueueRoute(app, f.store, async (request, reply) => {
      if (request.headers.authorization !== 'Bearer fixture-token')
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
    });
    const payload = f.command('enqueue', { taskId: task.id, expectedTaskRevision: task.revision });
    const anonymous = await app.inject({ method: 'POST', url: '/api/opa/queue', payload });
    expect(anonymous.statusCode).toBe(401);
    expect(taskQueue(f.store, f.project).taskIds).toEqual([]);
    const accepted = await app.inject({
      method: 'POST',
      url: '/api/opa/queue',
      payload,
      headers: { authorization: 'Bearer fixture-token' },
    });
    expect(accepted.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'POST',
      url: '/api/opa/queue',
      payload: { ...payload, requestId: 'stale' },
      headers: { authorization: 'Bearer fixture-token' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('QUEUE_CONFLICT');
    await app.close();
  });
  it('keeps malformed/unsupported persisted queues instead of resetting their contents', () => {
    const f = fixture();
    f.create('a');
    for (const patch of [
      { queueVersion: 2 },
      {
        queueVersion: 1,
        queues: [
          { projectPath: f.project, taskIds: ['a', 'a'], revision: 1, paused: false, receipts: [] },
        ],
      },
    ]) {
      const store = new AgentStateStore();
      const save = vi.fn();
      store.setAdapter({
        loadOpaWork: () => ({ tasks: [], usage: [], ...patch }),
        saveOpaWork: save,
      } as unknown as StateAdapter);
      expect(() => opaWorkSnapshot(store)).toThrow(
        patch.queueVersion === 2 ? 'QUEUE_VERSION_UNSUPPORTED' : 'QUEUE_HISTORY_INVALID',
      );
      expect(save).not.toHaveBeenCalled();
    }
  });
});
