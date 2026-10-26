import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { attentionFactId, type OpaAttentionFact } from '../../core/src/opa/attention.js';
import type { OpaEvent } from '../../core/src/opa/events.js';
import type { OpaTask, OpaWorkData, TaskExecution } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { attentionSnapshot } from '../src/opa/attention.js';
import { registerAttentionRoute } from '../src/opa/attentionRoutes.js';
import { OpaOffice } from '../src/opa/office.js';
import { executeQueueCommand } from '../src/opa/queue.js';
import {
  attentionWorkInputs,
  changeTask,
  opaWorkSnapshot,
  taskQueue,
  updateTaskExecution,
} from '../src/opa/work.js';
function fixture(initial: OpaWorkData = { tasks: [], usage: [] }) {
  let saved = structuredClone(initial);
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
  let history: unknown;
  adapter.loadOpaHistory = () =>
    structuredClone(history) as ReturnType<NonNullable<StateAdapter['loadOpaHistory']>>;
  adapter.saveOpaHistory = (value) => {
    history = structuredClone(value);
  };
  const restart = () => {
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    return store;
  };
  const store = restart();
  const create = (id = 't', projectPath = '/fixture') =>
    changeTask(store, { action: 'create', requestId: id, projectPath, title: `Fixture ${id}` });
  return { store, restart, create, save, persisted: () => saved };
}
const execution = (
  runId: string,
  permissions: TaskExecution['permissions'] = [],
): TaskExecution => ({
  runId,
  state: 'running',
  startedAt: 1,
  journal: '/fixture/journal',
  permissions,
});
const event = (type: string, sequence: number, patch: Record<string, unknown> = {}): OpaEvent =>
  ({
    specVersion: '0.1',
    id: `${type}-${sequence}`,
    provider: 'fixture',
    sessionId: 's',
    agentId: 'a',
    streamId: 'stream',
    timestamp: new Date(1000 + sequence).toISOString(),
    sequence,
    type,
    ...patch,
  }) as OpaEvent;
function finish(store: AgentStateStore, task: OpaTask, runId: string) {
  updateTaskExecution(store, task, execution(runId), 'in_progress');
  updateTaskExecution(
    store,
    task,
    { ...execution(runId), permissions: undefined, state: 'completed', finishedAt: 10 },
    'done',
  );
}
describe('durable attention facts', () => {
  it('keeps host identity and terminal attempts across restart without exposing output or choices', () => {
    const f = fixture();
    const task = f.create();
    finish(f.store, task, 'first');
    const current = opaWorkSnapshot(f.store).tasks[0];
    updateTaskExecution(
      f.store,
      current,
      execution('second', [
        {
          id: 'p',
          title: 'Fixture permission',
          options: [{ optionId: 'secret-choice', name: 'choice', kind: 'allow_once' }],
        },
      ]),
      'in_progress',
    );
    const before = attentionSnapshot(f.store);
    const after = attentionSnapshot(f.restart());
    expect(after.hostId).toBe(before.hostId);
    expect(after.items.some((i) => i.fact.runId === 'first')).toBe(true);
    const block = after.items.find((i) => i.fact.permissionId === 'p')!;
    expect(block.activity).toBe('stale');
    expect(block.fact.runId).toBe('second');
    expect(JSON.stringify(after)).not.toContain('secret-choice');
    expect(JSON.stringify(after)).not.toContain('/fixture/journal');
    expect(f.persisted().attentionFacts).toHaveLength(1);
  });
  it('records only an exact permission decision and cannot resolve another attempt with reused request IDs', () => {
    const f = fixture();
    const task = f.create();
    const permissions = [{ id: 'p', title: 'Fixture permission', options: [] }];
    updateTaskExecution(f.store, task, execution('one', permissions), 'in_progress');
    const firstFact = attentionWorkInputs(f.store).facts[0];
    updateTaskExecution(f.store, task, execution('one', permissions), 'in_progress');
    expect(attentionWorkInputs(f.store).facts).toHaveLength(1);
    expect(() =>
      updateTaskExecution(f.store, task, execution('one'), 'in_progress', 'wrong'),
    ).toThrow('PERMISSION_STALE');
    updateTaskExecution(f.store, task, execution('one'), 'in_progress', 'p');
    expect(attentionSnapshot(f.store).items.find((i) => i.fact.id === firstFact.id)?.activity).toBe(
      'resolved',
    );
    updateTaskExecution(f.store, task, execution('two', permissions), 'in_progress');
    const items = attentionSnapshot(f.store).items;
    expect(items.find((i) => i.fact.runId === 'one' && i.fact.kind === 'blocked')?.activity).toBe(
      'resolved',
    );
    expect(items.find((i) => i.fact.runId === 'two' && i.fact.kind === 'blocked')?.activity).toBe(
      'stale',
    ); // no live host owner in this fixture
    expect(attentionWorkInputs(f.store).facts.find((fact) => fact.id === firstFact.id)).toEqual(
      firstFact,
    );
  });
  it('reconciles source resolutions only inside their stream and exposes replay gaps/fixture provenance', () => {
    const f = fixture();
    const office = new OpaOffice(f.store, () => 10000, { origin: 'fixture' });
    office.accept(event('session.started', 0, { cwd: '/fixture' }));
    office.accept(event('permission.requested', 1));
    office.accept(
      event('session.started', 0, { cwd: '/fixture', streamId: 'new', id: 'new-start' }),
    );
    office.accept(event('permission.requested', 1, { streamId: 'new', id: 'new-request' }));
    office.accept(event('permission.resolved', 2, { streamId: 'new', id: 'new-resolution' }));
    const items = attentionSnapshot(f.store).items;
    expect(items.find((i) => i.fact.eventId === 'permission.requested-1')?.activity).toBe('stale');
    expect(items.find((i) => i.fact.eventId === 'new-request')?.activity).toBe('resolved');
    expect(items.every((i) => i.fact.origin === 'fixture')).toBe(true);
    const ids = items.map((i) => i.fact.id);
    const restarted = f.restart();
    const replay = new OpaOffice(restarted, () => 10000, { origin: 'fixture' });
    replay.accept(event('session.started', 0, { cwd: '/fixture' }));
    replay.accept(event('permission.requested', 1));
    expect(
      attentionSnapshot(restarted)
        .items.map((i) => i.fact.id)
        .sort(),
    ).toEqual([...ids].sort());
  });
  it('retains queue preflight failures and consumes that request without dequeuing or launching', () => {
    const f = fixture();
    const task = f.create();
    executeQueueCommand(f.store, {
      action: 'enqueue',
      requestId: 'enq',
      projectPath: '/fixture',
      expectedRevision: 0,
      taskId: task.id,
      expectedTaskRevision: task.revision,
    });
    executeQueueCommand(f.store, {
      action: 'pause',
      requestId: 'pause',
      projectPath: '/fixture',
      expectedRevision: 1,
    });
    const command = {
      action: 'start-next',
      requestId: 'start',
      projectPath: '/fixture',
      expectedRevision: 2,
      taskId: task.id,
      expectedTaskRevision: task.revision,
    };
    expect(() => executeQueueCommand(f.store, command)).toThrow('QUEUE_PAUSED');
    expect(() => executeQueueCommand(f.store, command)).toThrow('QUEUE_START_ALREADY_RECORDED');
    expect(taskQueue(f.store, '/fixture').taskIds).toEqual([task.id]);
    const snapshot = attentionSnapshot(f.restart());
    expect(snapshot.items).toContainEqual(
      expect.objectContaining({
        fact: expect.objectContaining({
          kind: 'queue-error',
          code: 'QUEUE_PAUSED',
          taskId: task.id,
        }),
      }),
    );
    expect(opaWorkSnapshot(f.store).tasks[0].execution).toBeUndefined();
  });
  it('does not publish permission facts if the atomic task save fails', () => {
    const f = fixture();
    const task = f.create();
    f.save.mockImplementationOnce(() => {
      throw Error('disk fixture');
    });
    expect(() =>
      updateTaskExecution(
        f.store,
        task,
        execution('one', [{ id: 'p', title: 'Fixture permission', options: [] }]),
        'in_progress',
      ),
    ).toThrow('STORAGE_FAILED');
    expect(attentionSnapshot(f.restart()).items).toEqual([]);
  });
  it('bounds the metadata ledger, reports removal and keeps unrelated saves', () => {
    const facts: OpaAttentionFact[] = Array.from({ length: 2000 }, (_, index) => ({
      id: attentionFactId('fixture', String(index)),
      projectPath: '/fixture',
      kind: 'queue-error',
      title: 'Fixture failure',
      state: 'Start request failed',
      origin: 'fixture',
    }));
    const f = fixture({
      tasks: [],
      usage: [],
      attentionVersion: 1,
      attentionHostId: 'fixture-host',
      attentionFacts: facts,
      attentionDropped: 0,
    });
    const task = f.create();
    updateTaskExecution(
      f.store,
      task,
      execution('one', [{ id: 'p', title: 'Fixture request', options: [] }]),
      'in_progress',
    );
    const after = attentionSnapshot(f.restart());
    expect(attentionWorkInputs(f.store).facts).toHaveLength(2000);
    expect(after.droppedFacts).toBe(1);
    expect(after.items.some((i) => i.fact.id === facts[0].id)).toBe(false);
    expect(after.hostId).toBe('fixture-host');
  });
  it('rejects corrupt/unsupported metadata without replacing stored facts', () => {
    for (const patch of [
      { attentionVersion: 2 },
      { attentionVersion: 1, attentionHostId: 'host', attentionFacts: [{}] },
    ]) {
      const f = fixture({ tasks: [], usage: [], ...patch } as unknown as OpaWorkData);
      expect(() => attentionSnapshot(f.store)).toThrow(
        patch.attentionVersion === 2 ? 'ATTENTION_VERSION_UNSUPPORTED' : 'ATTENTION_INVALID',
      );
      expect(f.save).not.toHaveBeenCalled();
    }
  });
  it('keeps observer query passive and applies project/auth boundaries to HTTP', async () => {
    const f = fixture();
    finish(f.store, f.create(), 'run');
    finish(f.store, f.create('other', '/other'), 'other-run');
    const before = structuredClone(f.persisted());
    const send = vi.fn();
    handleClientMessage(
      {
        type: 'opaAttentionRequest',
        requestId: 'query',
        projectPath: '/fixture',
        action: 'start',
        launch: true,
      },
      send,
      { store: f.store, cache: null, privileged: false },
    );
    expect(
      send.mock.calls[0][0].items.every(
        (i: { fact: OpaAttentionFact }) => i.fact.projectPath === '/fixture',
      ),
    ).toBe(true);
    expect(f.persisted()).toEqual(before);
    const app = Fastify();
    registerAttentionRoute(app, f.store, async (request, reply) => {
      if (request.headers.authorization !== 'Bearer fixture')
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
    });
    expect((await app.inject({ url: '/api/opa/attention' })).statusCode).toBe(401);
    const response = await app.inject({
      url: '/api/opa/attention?projectPath=%2Ffixture',
      headers: { authorization: 'Bearer fixture' },
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .items.every((i: { fact: OpaAttentionFact }) => i.fact.projectPath === '/fixture'),
    ).toBe(true);
    await app.close();
  });
});
