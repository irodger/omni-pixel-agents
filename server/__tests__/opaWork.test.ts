import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaEvent } from '../../core/src/opa/events.js';
import { isOpaEvent } from '../../core/src/opa/events.js';
import { OpaNormalizer } from '../../core/src/opa/normalize.js';
import type { OpaUsage, OpaWorkData } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer } from '../src/httpServer.js';
import { OpaOffice } from '../src/opa/office.js';
import { applyWorkEvent, changeTask, opaWorkSnapshot } from '../src/opa/work.js';

const usage = (patch: Partial<OpaUsage> = {}): OpaUsage => ({
  usageId: 'turn-1',
  projectPath: '/project',
  provider: 'codex',
  sessionId: 's',
  timestamp: '2026-10-25T10:00:00Z',
  inputTokens: 1000,
  cachedInputTokens: 800,
  outputTokens: 100,
  ...patch,
});
const usageEvent = (u = usage()): OpaEvent => ({
  specVersion: '0.2',
  id: 'event-1',
  streamId: 'stream',
  sequence: 0,
  provider: u.provider,
  sessionId: u.sessionId,
  agentId: 'a',
  timestamp: u.timestamp,
  type: 'usage.reported',
  usage: u,
});
function durable() {
  let data: OpaWorkData = { tasks: [], usage: [] };
  const adapter: StateAdapter = {
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_, v) => v,
    setSetting: () => {},
    loadOpaWork: () => data,
    saveOpaWork: (next) => {
      data = next;
    },
  };
  const store = new AgentStateStore();
  store.setAdapter(adapter);
  return { store, adapter };
}

describe('shared project tasks', () => {
  it('creates, assigns and completes tasks; rejects stale browser edits', () => {
    const { store } = durable();
    const command = {
      action: 'create',
      requestId: 'new',
      projectPath: '/project',
      title: ' Implement adapter ',
      assignee: 'Codex',
    };
    const task = changeTask(store, command, 100);
    expect(task).toMatchObject({
      title: 'Implement adapter',
      assignee: 'Codex',
      status: 'open',
      revision: 1,
    });
    expect(changeTask(store, command, 110)).toEqual(task);
    expect(opaWorkSnapshot(store).tasks).toHaveLength(1);
    const completed = changeTask(
      store,
      {
        action: 'update',
        requestId: 'change',
        projectPath: '/project',
        taskId: task.id,
        expectedRevision: 1,
        status: 'done',
      },
      200,
    );
    expect(completed).toMatchObject({ status: 'done', revision: 2, createdAt: 100 });
    expect(() =>
      changeTask(store, {
        action: 'update',
        requestId: 'stale',
        projectPath: '/project',
        taskId: task.id,
        expectedRevision: 1,
        title: 'Overwrite',
      }),
    ).toThrow('TASK_CONFLICT');
    expect(() => changeTask(store, { ...command, requestId: 'bad', title: '  ' })).toThrow(
      'TASK_INVALID',
    );
    expect(() => changeTask(store, { ...command, requestId: 'bad', taskId: 5 })).toThrow(
      'TASK_INVALID',
    );
  });
  it('survives restart and does not publish or acknowledge failed persistence', () => {
    const { store, adapter } = durable();
    changeTask(store, {
      action: 'create',
      requestId: 't',
      projectPath: '/project',
      title: 'Persist me',
    });
    const restarted = new AgentStateStore();
    restarted.setAdapter(adapter);
    expect(opaWorkSnapshot(restarted).tasks).toHaveLength(1);
    adapter.saveOpaWork = () => {
      throw new Error('Disk full');
    };
    expect(() =>
      changeTask(restarted, {
        action: 'create',
        requestId: 'lost',
        projectPath: '/project',
        title: 'Do not lose silently',
      }),
    ).toThrow('STORAGE_FAILED');
    expect(opaWorkSnapshot(restarted).tasks).toHaveLength(1);
  });
  it('replays task observations without replacing newer human edits', () => {
    const { store } = durable();
    const taskEvent: OpaEvent = {
      ...usageEvent(),
      type: 'task.upserted',
      cwd: '/project',
      taskId: 't',
      title: 'Agent task',
      status: 'open',
    };
    expect(applyWorkEvent(store, taskEvent)).toBe(true);
    expect(applyWorkEvent(store, taskEvent)).toBe(false);
    changeTask(
      store,
      {
        action: 'update',
        requestId: 'edit',
        projectPath: '/project',
        taskId: 't',
        expectedRevision: 1,
        title: 'Reviewed task',
      },
      Date.parse(taskEvent.timestamp) + 10000,
    );
    expect(applyWorkEvent(store, taskEvent)).toBe(false);
    expect(opaWorkSnapshot(store).tasks[0].title).toBe('Reviewed task');
  });
});

describe('durable usage ledger', () => {
  it('deduplicates normalized journals across restarts, and replaces a corrected observation', () => {
    const { store, adapter } = durable();
    const office = new OpaOffice(store);
    expect(office.accept(usageEvent())).toBe(true);
    expect(office.accept(usageEvent())).toBe(false);
    const restarted = new AgentStateStore();
    restarted.setAdapter(adapter);
    expect(new OpaOffice(restarted).accept(usageEvent())).toBe(false);
    const revised = usage({ outputTokens: 120, timestamp: '2026-10-25T10:01:00Z' });
    expect(applyWorkEvent(restarted, usageEvent(revised))).toBe(true);
    expect(opaWorkSnapshot(restarted).usage).toHaveLength(1);
    expect(opaWorkSnapshot(restarted).usage[0].outputTokens).toBe(120);
    expect(applyWorkEvent(restarted, usageEvent())).toBe(false);
  });
  it('validates version, identity, cache subsets and nonnegative finite cost', () => {
    expect(isOpaEvent(usageEvent())).toBe(true);
    expect(isOpaEvent({ ...usageEvent(), specVersion: '0.1' })).toBe(false);
    expect(isOpaEvent(usageEvent(usage({ cachedInputTokens: 1001 })))).toBe(false);
    expect(
      isOpaEvent(usageEvent(usage({ cost: { amount: -1, currency: 'USD', kind: 'estimated' } }))),
    ).toBe(false);
    expect(
      isOpaEvent(
        usageEvent(usage({ cost: { amount: Infinity, currency: 'USD', kind: 'reported' } })),
      ),
    ).toBe(false);
    expect(isOpaEvent({ ...usageEvent(), provider: 'other' })).toBe(false);
  });
  it('normalizes Codex usage without inventing a price and keeps identical separate turns', () => {
    const n = new OpaNormalizer('codex', '/project');
    n.normalize({ type: 'thread.started', thread_id: 's' });
    const raw = {
      type: 'turn.completed',
      usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 100 },
    };
    const first = n.normalize(raw).find((e) => e.type === 'usage.reported');
    const second = n.normalize(raw).find((e) => e.type === 'usage.reported');
    expect(first?.type).toBe('usage.reported');
    if (first?.type !== 'usage.reported' || second?.type !== 'usage.reported')
      throw Error('Missing usage');
    expect(first.usage.cost).toBeUndefined();
    expect(first.usage.usageId).not.toBe(second.usage.usageId);
    expect(first.usage.inputTokens).toBe(1000);
    expect(isOpaEvent(first)).toBe(true);
  });
  it('normalizes OpenCode completed-message counters using a stable message key', () => {
    const n = new OpaNormalizer('opencode', '/project');
    const raw = {
      type: 'message.updated',
      properties: {
        info: {
          id: 'm',
          sessionID: 's',
          role: 'assistant',
          providerID: 'test',
          modelID: 'model',
          time: { completed: 1792922400000 },
          cost: 0.015,
          tokens: { input: 100, output: 20, reasoning: 10, cache: { read: 800, write: 50 } },
        },
      },
    };
    const first = n.normalize(raw).find((e) => e.type === 'usage.reported');
    const second = n.normalize(raw).find((e) => e.type === 'usage.reported');
    if (first?.type !== 'usage.reported' || second?.type !== 'usage.reported')
      throw Error('Missing usage');
    expect(first.sessionId).toBe('s');
    expect(first.usage).toMatchObject({
      usageId: 'm',
      inputTokens: 950,
      outputTokens: 30,
      cost: { amount: 0.015, kind: 'estimated' },
    });
    expect(second.usage).toEqual(first.usage);
    expect(isOpaEvent(first)).toBe(true);
  });
});

describe('task API privileges', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });
  it('allows authenticated API updates and denies anonymous HTTP and WebSocket writes', async () => {
    const { store } = durable();
    const { app, port } = await createHttpServer({ embedded: false, token: 'test-token', store });
    const sockets: WebSocket[] = [];
    cleanup = async () => {
      sockets.forEach((s) => s.terminate());
      await app.close();
    };
    expect((await app.inject({ method: 'GET', url: '/api/opa/adapters' })).statusCode).toBe(401);
    const catalog = (
      await app.inject({
        method: 'GET',
        url: '/api/opa/adapters',
        headers: { authorization: 'Bearer test-token' },
      })
    ).json();
    expect(
      catalog.adapters.find((adapter: { id: string }) => adapter.id === 'claude'),
    ).toMatchObject({ status: 'observe_only', capabilities: { prompt: false } });
    expect(
      catalog.adapters.every(
        (adapter: Record<string, unknown>) => !('executable' in adapter) && !('command' in adapter),
      ),
    ).toBe(true);
    const payload = {
      action: 'create',
      requestId: 't',
      projectPath: '/project',
      title: 'API task',
    };
    expect((await app.inject({ method: 'POST', url: '/api/opa/tasks', payload })).statusCode).toBe(
      401,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/opa/tasks',
          payload,
          headers: { authorization: 'Bearer test-token' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/opa/tasks',
          headers: { authorization: 'Bearer test-token' },
        })
      ).json().tasks,
    ).toHaveLength(1);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const result = new Promise<Record<string, unknown>>((resolve) =>
      socket.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === 'opaTaskResult') resolve(msg);
      }),
    );
    socket.send(JSON.stringify({ ...payload, type: 'opaTaskCommand', requestId: 'anonymous' }));
    expect(await result).toMatchObject({ error: 'READ_ONLY' });
    expect(opaWorkSnapshot(store).tasks).toHaveLength(1);
  });
});
