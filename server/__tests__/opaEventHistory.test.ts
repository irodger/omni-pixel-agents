import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaEvent } from '../../core/src/opa/events.js';
import type { OpaEventHistory } from '../../core/src/opa/history.js';
import { JsonlReader } from '../../core/src/opa/jsonl.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { HISTORY_LIMITS, historyJsonl, historyPage, recordHistory } from '../src/opa/history.js';
import { registerEventHistoryRoute } from '../src/opa/historyRoutes.js';
import { OpaOffice } from '../src/opa/office.js';

function fixture(initial?: OpaEventHistory) {
  let data = initial && structuredClone(initial);
  const save = vi.fn((next: OpaEventHistory) => {
    data = structuredClone(next);
  });
  const adapter = {
    loadOpaHistory: () => data,
    saveOpaHistory: save,
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
    return store;
  };
  return { store: restart(), restart, save, data: () => data };
}
function event(sequence: number, patch: Partial<OpaEvent> = {}): OpaEvent {
  return {
    specVersion: '0.1',
    id: `fixture-${sequence}`,
    streamId: 'stream',
    provider: 'fixture',
    sessionId: 's',
    agentId: 'a',
    timestamp: '2026-10-26T00:00:00Z',
    sequence,
    ...(sequence === 0 ? { type: 'session.started', cwd: '/fixture' } : { type: 'turn.started' }),
    ...patch,
  } as OpaEvent;
}
const query = { projectPath: '/fixture' };
describe('bounded persisted OPA observation index', () => {
  it('deduplicates normalized replay across host and producer restarts without blocking ephemeral restore', () => {
    const f = fixture();
    const events = [event(0), event(1), event(2, { type: 'turn.completed' })];
    const office = new OpaOffice(f.store, Date.now, { origin: 'fixture' });
    events.forEach((e) => office.accept(e));
    events.forEach((e) => office.accept(e));
    expect(historyPage(f.store, query).entries).toHaveLength(3);
    const restored = f.restart();
    const replay = new OpaOffice(restored);
    events.forEach((e) => replay.accept(e));
    expect(historyPage(restored, query).entries).toHaveLength(3);
    expect(restored.size).toBe(1);
    replay.accept(event(0, { id: 'restarted', streamId: 'new-stream' }));
    expect(historyPage(restored, query).entries).toHaveLength(4);
    expect(
      new OpaOffice(restored).accept(event(0, { id: 'restarted', streamId: 'new-stream' })),
    ).toBe(false);
    expect(restored.size).toBe(1);
  });
  it('retains high-water marks beyond the window, exposes gaps and rejects expired cursors', () => {
    const f = fixture();
    const limits = { ...HISTORY_LIMITS, events: 2 };
    for (let n = 0; n < 5; n++) recordHistory(f.store, event(n), { origin: 'fixture' }, n, limits);
    expect(historyPage(f.store, query)).toMatchObject({
      droppedThrough: 3,
      entries: [{ ordinal: 5 }, { ordinal: 4 }],
    });
    expect(() => historyPage(f.store, { ...query, before: 2 })).toThrow(
      'EVENT_HISTORY_CURSOR_EXPIRED',
    );
    const restored = f.restart();
    for (let n = 0; n < 5; n++) expect(recordHistory(restored, event(n))).toBe(false);
    expect(historyPage(restored, query).entries).toHaveLength(2);
    const cap = fixture();
    recordHistory(cap.store, event(0), { origin: 'fixture' }, 1, { ...HISTORY_LIMITS, streams: 1 });
    expect(() =>
      recordHistory(
        cap.store,
        event(0, { id: 'other', streamId: 'other' }),
        { origin: 'fixture' },
        2,
        { ...HISTORY_LIMITS, streams: 1 },
      ),
    ).toThrow('EVENT_HISTORY_CAPACITY');
    expect(cap.data()?.entries).toHaveLength(1);
  });
  it('scopes filtering and pagination, orders by observation and exports explicit fixture provenance', () => {
    const f = fixture();
    recordHistory(f.store, event(0), { origin: 'fixture', taskId: 'task', runId: 'run' }, 10);
    recordHistory(
      f.store,
      event(1, { timestamp: '2025-01-01T00:00:00Z' }),
      { origin: 'fixture', taskId: 'task', runId: 'run' },
      11,
    );
    recordHistory(
      f.store,
      event(0, {
        id: 'other-project',
        streamId: 'other',
        sessionId: 'other',
        cwd: '/other',
        type: 'session.started',
      }),
    );
    const page = historyPage(f.store, { ...query, limit: 1 });
    expect(page.entries[0]).toMatchObject({ ordinal: 2, observedAt: 11 });
    expect(historyPage(f.store, { ...query, before: page.nextCursor }).entries[0].ordinal).toBe(1);
    expect(historyPage(f.store, { ...query, runId: 'missing' }).entries).toHaveLength(0);
    expect(
      historyPage(f.store, { ...query, taskId: 'task', runId: 'run', provider: 'fixture' }).entries,
    ).toHaveLength(2);
    expect(historyPage(f.store, { projectPath: '/other' }).entries).toHaveLength(1);
    const exported = historyJsonl(historyPage(f.store, query))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(exported.map((e) => e.sequence)).toEqual([0, 1]);
    expect(exported.every((e) => e.opaHistory.origin === 'fixture')).toBe(true);
    page.entries[0].event.id = 'caller mutation';
    expect(historyPage(f.store, query).entries[0].event.id).toBe('fixture-1');
  });
  it('drops unknown payloads, labels excerpts, preserves checkpoint consistency on write failure', () => {
    const f = fixture();
    recordHistory(f.store, event(0));
    const raw = {
      ...event(1),
      type: 'message',
      role: 'assistant',
      text: 'x'.repeat(5000),
      rawToolArguments: 'secret',
      reasoning: 'secret',
    } as unknown as OpaEvent;
    recordHistory(f.store, raw);
    const entry = historyPage(f.store, query).entries[0];
    expect(entry.truncatedFields).toEqual(['text']);
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(entry.event.type === 'message' && entry.event.text.length).toBe(4096);
    f.save.mockImplementationOnce(() => {
      throw Error('disk');
    });
    expect(() => recordHistory(f.store, event(2))).toThrow('EVENT_HISTORY_STORAGE_FAILED');
    expect(historyPage(f.store, query).entries).toHaveLength(2);
    expect(recordHistory(f.store, event(2))).toBe(true);
  });
  it('keeps bad versions/records and command-like observer requests from changing durable state', () => {
    const unsupported = fixture({ version: 2 } as unknown as OpaEventHistory);
    expect(() => historyPage(unsupported.store, query)).toThrow('EVENT_HISTORY_VERSION');
    expect(unsupported.save).not.toHaveBeenCalled();
    const f = fixture();
    recordHistory(f.store, event(0));
    const before = structuredClone(f.data());
    const send = vi.fn();
    handleClientMessage(
      {
        type: 'opaEventHistoryRequest',
        requestId: 'read',
        ...query,
        launch: true,
        action: 'permission',
      },
      send,
      { store: f.store, cache: null, privileged: false },
    );
    expect(send.mock.calls[0][0]).toMatchObject({
      type: 'opaEventHistoryPage',
      requestId: 'read',
      entries: [{ event: { id: 'fixture-0' } }],
    });
    expect(f.data()).toEqual(before);
    expect(() =>
      recordHistory(f.store, event(3, { type: 'session.started', cwd: '/different' })),
    ).toThrow('EVENT_HISTORY_PROJECT_CONFLICT');
    expect(() => historyPage(f.store, { ...query, limit: 51 })).toThrow(
      'EVENT_HISTORY_QUERY_INVALID',
    );
  });
});

describe('streaming normalized JSONL replay reader', () => {
  it('handles chunk boundaries, CRLF, blank lines and a complete nonterminated final record', () => {
    const reader = new JsonlReader();
    expect(reader.push('{"a":')).toEqual([]);
    expect(reader.push('1}\r\n\n{"b":2}')).toEqual([{ line: 1, value: { a: 1 } }]);
    expect(reader.finish()).toEqual([{ line: 3, value: { b: 2 } }]);
  });
  it('fails malformed complete lines and strict tails; only explicit tail mode ignores the final fragment', () => {
    const strict = new JsonlReader();
    strict.push('{"event":');
    expect(() => strict.finish()).toThrow('line 1');
    const tail = new JsonlReader();
    tail.push('{"event":');
    expect(tail.finish(true)).toEqual([]);
    expect(tail.incompleteTail).toBe(true);
    expect(() => new JsonlReader().push('{}\nnot-json\n')).toThrow('line 2');
    expect(() => new JsonlReader(4).push('12345')).toThrow('size limit');
  });
});

describe('event history HTTP route (in-process)', () => {
  it('enforces auth, bounded filters, JSONL export and visible retention gaps without a listener', async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++)
      recordHistory(f.store, event(n), { origin: 'fixture' }, n, { ...HISTORY_LIMITS, events: 2 });
    const app = Fastify({ logger: false });
    registerEventHistoryRoute(app, f.store, async (request, reply) => {
      if (request.headers.authorization !== 'Bearer fixture') reply.code(401).send('unauthorized');
    });
    try {
      const url = '/api/opa/history?projectPath=%2Ffixture';
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      const headers = { authorization: 'Bearer fixture' };
      const page = await app.inject({ method: 'GET', url, headers });
      expect(page.json()).toMatchObject({
        droppedThrough: 2,
        entries: [{ ordinal: 4 }, { ordinal: 3 }],
      });
      expect(
        (await app.inject({ method: 'GET', url: url + '&before=1', headers })).statusCode,
      ).toBe(409);
      expect(
        (await app.inject({ method: 'GET', url: url + '&limit=51', headers })).statusCode,
      ).toBe(400);
      expect(
        (await app.inject({ method: 'GET', url: url + '&format=zip', headers })).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({ method: 'GET', url: '/api/opa/history?projectPath=%2Fother', headers })
        ).json().entries,
      ).toEqual([]);
      const exported = await app.inject({ method: 'GET', url: url + '&format=jsonl', headers });
      expect(exported.headers['content-type']).toContain('application/x-ndjson');
      expect(JSON.parse(exported.body.trim().split('\n')[0]).opaHistory.origin).toBe('fixture');
    } finally {
      await app.close();
    }
  });
});

describe('replay bridge tail handling (fixture stdin, no network)', () => {
  it('keeps strict replay errors explicit and only skips an unfinished final fragment on request', () => {
    const args = ['--import', 'tsx', resolve('src/opa/bridge.ts'), 'replay'];
    const input = JSON.stringify(event(0)) + '\n{"specVersion":';
    const strict = spawnSync(process.execPath, args, { input, encoding: 'utf8' });
    expect(strict.status).toBe(1);
    expect(strict.stderr).toContain('line 2');
    const tail = spawnSync(process.execPath, [...args, '--allow-incomplete-tail'], {
      input,
      encoding: 'utf8',
    });
    expect(tail.status).toBe(0);
    expect(tail.stderr).toContain('explicit replay tail mode');
    expect(tail.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(tail.stdout).id).toBe('fixture-0');
    const invalid = spawnSync(process.execPath, [...args, '--allow-incomplete-tail'], {
      input: '{}',
      encoding: 'utf8',
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Invalid OPA event');
  });
});
