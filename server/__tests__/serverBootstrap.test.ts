import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ home: '', create: vi.fn(), close: vi.fn() }));
vi.mock('os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => mocks.home,
}));
vi.mock('../src/httpServer.js', () => ({ createHttpServer: mocks.create }));
import { AgentStateStore } from '../src/agentStateStore.js';
import { PixelAgentsServer } from '../src/server.js';
const roots: string[] = [];
afterEach(() => {
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  vi.clearAllMocks();
});
describe('server store ownership', () => {
  it('constructs a valid isolated store when none is supplied and preserves an explicit store', async () => {
    mocks.home = mkdtempSync(join(tmpdir(), 'opa-bootstrap-fixture-'));
    roots.push(mocks.home);
    mocks.create.mockResolvedValue({
      app: { close: mocks.close.mockResolvedValue(undefined) },
      port: 32123,
    });
    const server = new PixelAgentsServer();
    await server.start();
    expect(mocks.create.mock.calls[0][0].store).toBeInstanceOf(AgentStateStore);
    server.stop();
    const explicit = new AgentStateStore();
    const next = new PixelAgentsServer();
    await next.start({ store: explicit });
    expect(mocks.create.mock.calls[1][0].store).toBe(explicit);
    next.stop();
  });
});
