import { afterEach, describe, expect, it } from 'vitest';

import { isOpaEvent } from '../../core/src/opa/events.js';
import { OpaNormalizer } from '../../core/src/opa/normalize.js';
import { resendAgentActivity } from '../src/agentActivityResend.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer } from '../src/httpServer.js';
import { OpaOffice } from '../src/opa/office.js';

const codex = () => new OpaNormalizer('codex', '/workspace');
const start = (n: OpaNormalizer) =>
  n.normalize({ type: 'thread.started', thread_id: 'same-id' })[0];

describe('portable history', () => {
  it('normalizes Codex lifecycle, parallel tools, completion-only patches and errors', () => {
    const n = codex();
    expect(isOpaEvent(start(n))).toBe(true);
    const patch = n.normalize({
      type: 'item.completed',
      item: { id: 'patch', type: 'file_change', status: 'completed' },
    });
    expect(patch.map((e) => e.type)).toEqual(['tool.started', 'tool.completed']);
    expect(patch.every(isOpaEvent)).toBe(true);
    expect(n.normalize({ type: 'turn.failed', error: { message: 'offline' } })[0]).toMatchObject({
      type: 'turn.failed',
      message: 'offline',
    });
    expect(n.normalize({ type: 'future.event' })).toEqual([]);
  });

  it('projects concurrent tools and restores their actual ids to reconnecting clients', () => {
    const n = codex();
    const store = new AgentStateStore();
    const office = new OpaOffice(store);
    office.accept(start(n));
    for (const id of ['a', 'b'])
      for (const e of n.normalize({
        type: 'item.started',
        item: { id, type: 'command_execution' },
      }))
        office.accept(e);
    const agent = [...store.values()][0];
    expect([...agent.activeToolIds]).toEqual(['a', 'b']);
    for (const e of n.normalize({
      type: 'item.completed',
      item: { id: 'a', type: 'command_execution' },
    }))
      office.accept(e);
    expect([...agent.activeToolIds]).toEqual(['b']);
    const replayed: Record<string, unknown>[] = [];
    resendAgentActivity((m) => replayed.push(m), store);
    expect(replayed).toContainEqual(
      expect.objectContaining({ type: 'agentToolStart', toolId: 'b' }),
    );
    for (const e of n.normalize({ type: 'turn.completed' })) office.accept(e);
    expect(agent.activeToolIds.size).toBe(0);
    expect(agent.isWaiting).toBe(true);
  });

  it('deduplicates replay and isolates providers while allowing producer restarts', () => {
    const store = new AgentStateStore();
    const office = new OpaOffice(store);
    const n = codex();
    const e = start(n);
    expect(office.accept(e)).toBe(true);
    expect(office.accept(e)).toBe(false);
    const restarted = start(codex());
    expect(restarted.streamId).not.toBe(e.streamId);
    expect(office.accept(restarted)).toBe(true);
    expect(store.size).toBe(1);
    office.accept({ ...e, provider: 'opencode' });
    expect(store.size).toBe(2);
  });

  it('normalizes OpenCode tool, permission and session lifecycle without raw arguments', () => {
    const n = new OpaNormalizer('opencode', '/workspace');
    const events = n.normalize({
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          sessionID: 's',
          callID: 'call',
          tool: 'read',
          state: { status: 'running', input: { secret: 'omitted' } },
        },
      },
    });
    expect(events.map((e) => e.type)).toEqual(['session.started', 'tool.started']);
    expect(events[1]).toMatchObject({ toolId: 'call', activity: 'read' });
    expect(JSON.stringify(events)).not.toContain('omitted');
    expect(n.normalize({ type: 'permission.asked', properties: { sessionID: 's' } })[0].type).toBe(
      'permission.requested',
    );
    expect(n.normalize({ type: 'session.idle', properties: { sessionID: 's' } })[0].type).toBe(
      'turn.completed',
    );
    expect(
      n.normalize({ type: 'session.deleted', properties: { info: { id: 's' } } })[0].type,
    ).toBe('session.ended');
  });

  it('restores an approval bubble after browser reconnect and clears it on resolution', () => {
    const n = new OpaNormalizer('opencode', '/workspace');
    const store = new AgentStateStore();
    const office = new OpaOffice(store);
    for (const e of n.normalize({ type: 'permission.asked', properties: { sessionID: 's' } }))
      office.accept(e);
    const messages: Record<string, unknown>[] = [];
    resendAgentActivity((m) => messages.push(m), store);
    expect(messages).toContainEqual({ type: 'agentToolPermission', id: 1 });
    for (const e of n.normalize({ type: 'permission.replied', properties: { sessionID: 's' } }))
      office.accept(e);
    expect(store.get(1)?.permissionSent).toBe(false);
  });

  it('rejects malformed versions, timestamps, ids and sequences', () => {
    const e = start(codex());
    for (const patch of [
      { specVersion: '2' },
      { timestamp: 'yesterday' },
      { agentId: '' },
      { sequence: -1 },
      { sequence: 0.5 },
      { type: 'tool.started' },
    ]) {
      expect(isOpaEvent({ ...e, ...patch })).toBe(false);
    }
  });
});

describe('OPA HTTP ingress', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
  });
  it('requires auth, validates input, rejects missing starts and accepts a replayed stream', async () => {
    const store = new AgentStateStore();
    const { app } = await createHttpServer({ embedded: true, token: 'test-token', store });
    close = () => app.close();
    const n = codex();
    const e = start(n);
    const headers = { authorization: 'Bearer test-token' };
    expect(
      (await app.inject({ method: 'POST', url: '/api/opa/events', payload: e })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/api/opa/events', headers, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/opa/events',
          headers,
          payload: { ...e, type: 'turn.started' },
        })
      ).statusCode,
    ).toBe(409);
    const send = () => app.inject({ method: 'POST', url: '/api/opa/events', headers, payload: e });
    expect((await send()).json()).toEqual({ accepted: true });
    expect((await send()).json()).toEqual({ accepted: false });
    expect(store.size).toBe(1);
  });
});
