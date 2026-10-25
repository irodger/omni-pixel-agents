import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcpNormalizer, negotiateAcp } from '../../core/src/opa/adapters/acp.js';
import { nativeStream } from '../../core/src/opa/adapters/native.js';
import { isOpaEvent, type OpaEvent } from '../../core/src/opa/events.js';
import { AcpClient } from '../src/opa/adapters/acpClient.js';
import { discoverAdapters, parseAcpConfig } from '../src/opa/adapters/registry.js';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
});
describe('adapter discovery and fallback', () => {
  it('keeps builtins usable when a configured ACP executable fails probing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opa-discovery-'));
    dirs.push(dir);
    for (const name of ['codex', 'acp']) writeFileSync(join(dir, name), '', { mode: 0o755 });
    vi.stubEnv('PATH', dir);
    const definitions = parseAcpConfig({
      version: 1,
      agents: [{ id: 'test', name: 'Test ACP', command: join(dir, 'acp'), args: ['acp'] }],
    });
    const result = discoverAdapters(definitions, (path) => path.endsWith('/codex'));
    expect(result.executors.map((e) => e.id)).toEqual(['codex']);
    expect(result.adapters.find((a) => a.id === 'acp:test')).toMatchObject({
      status: 'unavailable',
      capabilities: { prompt: false, observe: true },
    });
    expect(result.adapters.find((a) => a.id === 'claude')).toMatchObject({
      status: 'observe_only',
      capabilities: { prompt: false },
    });
    expect(result.adapters.find((a) => a.id === 'gemini')).toMatchObject({
      status: 'planned',
      capabilities: { observe: false, prompt: false },
    });
  });
  it('rejects relative commands, duplicate IDs and malformed argument arrays', () => {
    const entry = { id: 'local', name: 'Local', command: '/bin/agent', args: [] };
    expect(() => parseAcpConfig({ version: 2, agents: [] })).toThrow();
    expect(() =>
      parseAcpConfig({ version: 1, agents: [{ ...entry, command: 'agent' }] }),
    ).toThrow();
    expect(() => parseAcpConfig({ version: 1, agents: [entry, entry] })).toThrow();
    expect(() => parseAcpConfig({ version: 1, agents: [{ ...entry, args: '--acp' }] })).toThrow();
    expect(parseAcpConfig({ version: 1, agents: [{ ...entry, id: 'codex' }] })[0].id).toBe(
      'acp:codex',
    );
  });
});
describe('OPA event normalization', () => {
  it('conservatively negotiates v1 capabilities and refuses the v2 draft', () => {
    expect(negotiateAcp({ protocolVersion: 1 }).capabilities).toMatchObject({
      prompt: true,
      loadSession: false,
    });
    expect(
      negotiateAcp({ protocolVersion: 1, agentCapabilities: { loadSession: 'yes' } }).capabilities
        .loadSession,
    ).toBe(false);
    expect(
      negotiateAcp({ protocolVersion: 1, agentCapabilities: { loadSession: true } }).capabilities
        .loadSession,
    ).toBe(true);
    expect(() => negotiateAcp({ protocolVersion: 2 })).toThrow('Unsupported ACP');
  });
  it('projects text and complete-only tools, without booking cumulative context usage', () => {
    const events: OpaEvent[] = [];
    const normalizer = new AcpNormalizer('acp:test', '/project', (e) => events.push(e));
    normalizer.session('s');
    normalizer.turn();
    const update = (value: unknown, sessionId = 's') =>
      normalizer.update({ sessionId, update: value });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } });
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'private' } });
    update(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'wrong' } },
      'other',
    );
    update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't',
      status: 'completed',
      kind: 'read',
    });
    update({
      sessionUpdate: 'usage_update',
      used: 100,
      size: 1000,
      cost: { amount: 99, currency: 'USD' },
    });
    normalizer.finish({ stopReason: 'end_turn' });
    expect(events.map((e) => e.type)).toEqual([
      'session.started',
      'turn.started',
      'message',
      'tool.started',
      'tool.completed',
      'turn.completed',
    ]);
    expect(events.every(isOpaEvent)).toBe(true);
    expect(events.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(JSON.stringify(events)).not.toContain('private');
  });
  it('does not call cancellation or token limits successful completion', () => {
    const events: OpaEvent[] = [];
    const n = new AcpNormalizer('acp:test', '/project', (e) => events.push(e));
    n.session('s');
    n.turn();
    n.finish({ stopReason: 'cancelled' });
    expect(events.at(-1)?.type).toBe('turn.failed');
  });
  it('normalizes native OpenCode run text independently of plugin events', () => {
    const events: OpaEvent[] = [];
    const receive = nativeStream('opencode', '/project', {
      event: (e) => events.push(e),
      permission: async () => null,
    });
    receive({ type: 'text', sessionID: 's', part: { type: 'text', text: 'Native result' } });
    expect(events.map((e) => e.type)).toEqual(['session.started', 'message']);
    expect(events.every(isOpaEvent)).toBe(true);
  });
});
function peer(
  options: { version?: number; permission?: (request: unknown) => Promise<string | null> } = {},
) {
  const sent: Record<string, unknown>[] = [];
  const events: OpaEvent[] = [];
  let client: AcpClient;
  let promptId: unknown;
  client = new AcpClient(
    (message) => {
      sent.push(message);
      const respond = (result: unknown) =>
        queueMicrotask(() => client.receive({ jsonrpc: '2.0', id: message.id, result }));
      if (message.method === 'initialize')
        respond({ protocolVersion: options.version ?? 1, agentCapabilities: {} });
      if (message.method === 'session/new') respond({ sessionId: 's' });
      if (message.method === 'session/prompt') {
        promptId = message.id;
        queueMicrotask(() =>
          client.receive({
            jsonrpc: '2.0',
            id: 'permission',
            method: 'session/request_permission',
            params: {
              sessionId: 's',
              toolCall: { title: 'Write file?' },
              options: [
                { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'no', name: 'Reject once', kind: 'reject_once' },
              ],
            },
          }),
        );
      }
      if (message.id === 'permission' && 'result' in message)
        queueMicrotask(() =>
          client.receive({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } }),
        );
    },
    { event: (e) => events.push(e), permission: options.permission ?? (async () => null) },
    'acp:test',
    '/project',
    100,
  );
  return { client, sent, events };
}
describe('ACP bidirectional peer', () => {
  it('initializes before prompting and returns only the explicit permission decision', async () => {
    let resolve!: (v: string | null) => void;
    const request = vi.fn(
      () =>
        new Promise<string | null>((r) => {
          resolve = r;
        }),
    );
    const { client, sent, events } = peer({ permission: request });
    const run = client.run('Do work');
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(sent.some((m) => m.id === 'permission')).toBe(false);
    resolve('yes');
    expect(await run).toBe(true);
    expect(sent.find((m) => m.id === 'permission')).toMatchObject({
      result: { outcome: { outcome: 'selected', optionId: 'yes' } },
    });
    expect(events.map((e) => e.type)).toContain('permission.resolved');
    expect(sent[0]).toMatchObject({
      method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
    client.close();
  });
  it('cancels rather than accepting a forged option', async () => {
    const { client, sent } = peer({ permission: async () => 'not-advertised' });
    await client.run('work');
    expect(sent.find((m) => m.id === 'permission')).toMatchObject({
      result: { outcome: { outcome: 'cancelled' } },
    });
    client.close();
  });
  it('rejects unsupported peer versions before session or prompt; never silently reruns native', async () => {
    const { client, sent } = peer({ version: 2 });
    await expect(client.run('work')).rejects.toThrow('Unsupported ACP');
    expect(sent.map((m) => m.method)).toEqual(['initialize']);
    client.close();
  });
  it('denies unadvertised filesystem reverse methods', () => {
    const { client, sent } = peer();
    client.receive({
      jsonrpc: '2.0',
      id: 'fs',
      method: 'fs/write_text_file',
      params: { path: '/secret', content: 'no' },
    });
    expect(sent.at(-1)).toMatchObject({ id: 'fs', error: { code: -32601 } });
    client.close();
  });
  it('times out requests and rejects pending requests when a transport closes', async () => {
    const client = new AcpClient(
      () => {},
      { event: () => {}, permission: async () => null },
      'acp:test',
      '/project',
      10,
    );
    await expect(client.run('work')).rejects.toThrow('timed out');
    const pending = client.run('work');
    client.close();
    await expect(pending).rejects.toThrow('closed');
  });
  it('sends cancellation without inventing a user approval', async () => {
    let resolve!: (value: string | null) => void;
    const { client, sent } = peer({
      permission: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const run = client.run('work');
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    client.cancel();
    resolve('yes');
    await run;
    expect(sent.some((m) => m.method === 'session/cancel')).toBe(true);
    expect(sent.find((m) => m.id === 'permission')).toMatchObject({
      result: { outcome: { outcome: 'cancelled' } },
    });
    client.close();
  });
});
