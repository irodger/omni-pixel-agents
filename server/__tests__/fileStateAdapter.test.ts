import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistedAgent } from '../../core/src/schemas.js';

// Mock os.homedir() so the adapter resolves to an isolated temp dir on every
// platform. Overriding process.env.HOME is not portable: os.homedir() reads
// USERPROFILE on Windows, so a HOME-only override would still hit the real
// home directory.
let tempHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tempHome };
});

// Must import AFTER mock setup.
const { FileStateAdapter } = await import('../src/fileStateAdapter.js');
const { getHooksEnabled, setHooksEnabled } = await import('../src/configPersistence.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { OpaOffice } = await import('../src/opa/office.js');
const { opaCampusSnapshot } = await import('../src/opa/campus.js');
const { OpaNormalizer } = await import('../../core/src/opa/normalize.js');
const { changeTask, opaWorkSnapshot, taskRunsPage, updateTaskExecution } =
  await import('../src/opa/work.js');

describe('FileStateAdapter', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-adapter-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('preserves run history while other adapter state is saved and across host restart', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const task = changeTask(store, {
      action: 'create',
      requestId: 't',
      projectPath: tempHome,
      title: 'Fixture history',
    });
    updateTaskExecution(
      store,
      task,
      { runId: 'r1', state: 'running', journal: '/fixture', startedAt: 1 },
      'in_progress',
    );
    updateTaskExecution(
      store,
      task,
      {
        runId: 'r1',
        state: 'completed',
        journal: '/fixture',
        startedAt: 1,
        finishedAt: 2,
        output: 'First attempt',
      },
      'done',
    );
    updateTaskExecution(
      store,
      task,
      { runId: 'r2', state: 'running', journal: '/fixture', startedAt: 3 },
      'in_progress',
    );
    adapter.saveSeats({ 1: { seatId: 'seat' } });
    adapter.saveOpaProjects([tempHome]);
    const restored = new AgentStateStore();
    restored.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
    const history = taskRunsPage(restored, { projectPath: task.projectPath, taskId: task.id }).runs;
    expect(history.map((r) => r.execution.state)).toEqual(['interrupted', 'completed']);
    expect(
      taskRunsPage(restored, { projectPath: task.projectPath, taskId: task.id, runId: 'r1' })
        .runs[0].execution.output,
    ).toBe('First attempt');
    expect(adapter.loadSeats()).toEqual({ 1: { seatId: 'seat' } });
    expect(adapter.loadOpaProjects()).toEqual([tempHome]);
    expect(adapter.loadOpaWork().runs).toHaveLength(2);
  });

  it('preserves event checkpoints across reload/other saves and refuses to overwrite an unreadable state file', async () => {
    const { recordHistory, historyPage } = await import('../src/opa/history.js');
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const source = new OpaNormalizer('codex', tempHome);
    const start = source.normalize({ type: 'thread.started', thread_id: 'fixture-history' })[0];
    recordHistory(store, start, { origin: 'fixture' });
    adapter.saveSeats({ 1: { seatId: 'retained' } });
    adapter.saveOpaWork({ tasks: [], usage: [] });
    const restored = new AgentStateStore();
    restored.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
    expect(recordHistory(restored, start)).toBe(false);
    expect(historyPage(restored, { projectPath: tempHome }).entries).toHaveLength(1);
    const stateFile = path.join(tempHome, '.pixel-agents', 'standalone-state.json');
    fs.writeFileSync(stateFile, '{unfinished');
    const broken = new AgentStateStore();
    broken.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
    expect(() => historyPage(broken, { projectPath: tempHome })).toThrow(
      'EVENT_HISTORY_STORAGE_FAILED',
    );
    adapter.saveSeats({});
    expect(fs.readFileSync(stateFile, 'utf8')).toBe('{unfinished');
  });

  it('isolates project layouts, survives restart and rejects stale edits after reset', async () => {
    const { registerOpaProject } = await import('../src/opa/campus.js');
    const { saveProjectLayout } = await import('../src/opa/projectLayouts.js');
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const a = path.join(tempHome, 'a', 'same');
    const b = path.join(tempHome, 'b', 'same');
    registerOpaProject(store, a);
    registerOpaProject(store, b);
    const layout = { version: 1, cols: 1, rows: 1, tiles: [0], furniture: [] };
    const save = (projectPath: string, expectedRevision: number, reset = false) =>
      saveProjectLayout(store, {
        type: 'saveLayout',
        projectPath,
        expectedRevision,
        layout,
        reset,
      });
    save(a, 0);
    save(b, 0);
    save(a, 1, true);
    expect(() => save(a, 1)).toThrow('LAYOUT_CONFLICT');
    adapter.saveSeats({ '1': { palette: 2 } });
    adapter.saveAgents([]);
    const next = new AgentStateStore();
    next.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
    const projects = opaCampusSnapshot(next).projects;
    expect(projects.find((p) => p.id === a)).toMatchObject({ layoutVersion: 2 });
    expect(projects.find((p) => p.id === a)?.layout).toBeUndefined();
    expect(projects.find((p) => p.id === b)?.layout).toEqual(layout);
    expect(fs.existsSync(path.join(tempHome, '.pixel-agents', 'layout.json'))).toBe(false);
    expect(() =>
      saveProjectLayout(store, {
        type: 'saveLayout',
        projectPath: b,
        expectedRevision: 1,
        layout: {},
      }),
    ).toThrow('LAYOUT_INVALID');
    expect(adapter.loadProjectLayouts()[b].revision).toBe(1);
  });

  // ── Settings (shared config.json, per-namespace section) ────

  it('persists tasks and usage observations alongside seats and project paths', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const cwd = path.join(tempHome, 'work');
    changeTask(store, {
      action: 'create',
      requestId: 'task',
      projectPath: cwd,
      title: 'Shared task',
    });
    const normalizer = new OpaNormalizer('codex', cwd);
    const office = new OpaOffice(store);
    for (const e of normalizer.normalize({ type: 'thread.started', thread_id: 's' }))
      office.accept(e);
    for (const e of normalizer.normalize({
      type: 'turn.completed',
      usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80 },
    }))
      office.accept(e);
    adapter.saveSeats({ '1': { palette: 1 } });
    store.persist();
    const next = new AgentStateStore();
    next.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
    expect(opaWorkSnapshot(next).tasks[0].title).toBe('Shared task');
    expect(opaWorkSnapshot(next).usage[0]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(next.getAdapter()?.loadOpaProjects?.()).toContain(cwd);
  });

  it('restores the OPA project registry from disk after other state writes', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    const office = new OpaOffice(store);
    const cwd = path.join(tempHome, 'project');
    const normalizer = new OpaNormalizer('codex', cwd);
    for (const event of normalizer.normalize({ type: 'thread.started', thread_id: 's' }))
      office.accept(event);
    store.persist();
    adapter.saveSeats({ '1': { palette: 2 } });
    const restoredAdapter = new FileStateAdapter({ namespace: 'standalone' });
    const restored = new AgentStateStore();
    restored.setAdapter(restoredAdapter);
    expect(opaCampusSnapshot(restored).projects).toEqual([
      { id: cwd, path: cwd, name: 'project', agents: [] },
    ]);
    expect(restoredAdapter.loadAgents()).toEqual([]);
    expect(restoredAdapter.loadSeats()).toEqual({ '1': { palette: 2 } });
    expect(new FileStateAdapter({ namespace: 'vscode' }).loadOpaProjects()).toEqual([]);
  });

  it('returns defaults when config file does not exist', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    expect(adapter.getSetting('pixel-agents.soundEnabled', false)).toBe(true);
    expect(adapter.getSetting('pixel-agents.watchAllSessions', true)).toBe(false);
    expect(adapter.getSetting('pixel-agents.lastSeenVersion', 'x')).toBe('');
  });

  it('round-trips each namespaced setting key (hooksEnabled moved to the per-provider map)', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });

    adapter.setSetting('pixel-agents.soundEnabled', false);
    adapter.setSetting('pixel-agents.lastSeenVersion', '1.3');
    adapter.setSetting('pixel-agents.alwaysShowLabels', true);
    adapter.setSetting('pixel-agents.watchAllSessions', true);
    adapter.setSetting('pixel-agents.hooksInfoShown', true);
    adapter.setSetting('pixel-agents.bypassPermissions', true);

    expect(adapter.getSetting('pixel-agents.soundEnabled', true)).toBe(false);
    expect(adapter.getSetting('pixel-agents.lastSeenVersion', '')).toBe('1.3');
    expect(adapter.getSetting('pixel-agents.alwaysShowLabels', false)).toBe(true);
    expect(adapter.getSetting('pixel-agents.watchAllSessions', false)).toBe(true);
    expect(adapter.getSetting('pixel-agents.hooksInfoShown', false)).toBe(true);

    // hooksEnabled is deliberately NOT an adapter key any more: it is
    // per-provider and machine-global, so the adapter ignores it and the
    // per-provider accessors own it.
    adapter.setSetting('pixel-agents.hooksEnabled', false);
    expect(adapter.getSetting('pixel-agents.hooksEnabled', true)).toBe(true);
    setHooksEnabled('claude', false);
    expect(getHooksEnabled('claude')).toBe(false);
    expect(adapter.getSetting('pixel-agents.bypassPermissions', false)).toBe(true);
  });

  it('defaults bypassPermissions to off and keeps it per-namespace', () => {
    const vscode = new FileStateAdapter({ namespace: 'vscode' });
    const standalone = new FileStateAdapter({ namespace: 'standalone' });

    expect(standalone.getSetting('pixel-agents.bypassPermissions', true)).toBe(false);

    standalone.setSetting('pixel-agents.bypassPermissions', true);

    expect(standalone.getSetting('pixel-agents.bypassPermissions', false)).toBe(true);
    expect(vscode.getSetting('pixel-agents.bypassPermissions', true)).toBe(false);
  });

  it('vscode and standalone namespaces are isolated in config.json', () => {
    const vscode = new FileStateAdapter({ namespace: 'vscode' });
    const standalone = new FileStateAdapter({ namespace: 'standalone' });

    vscode.setSetting('pixel-agents.watchAllSessions', true);
    standalone.setSetting('pixel-agents.watchAllSessions', false);

    expect(vscode.getSetting('pixel-agents.watchAllSessions', null)).toBe(true);
    expect(standalone.getSetting('pixel-agents.watchAllSessions', null)).toBe(false);

    const configPath = path.join(tempHome, '.pixel-agents', 'config.json');
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed.vscode.watchAllSessions).toBe(true);
    expect(parsed.standalone.watchAllSessions).toBe(false);
  });

  it('ignores unknown setting keys (returns default, does not write)', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    expect(adapter.getSetting('pixel-agents.unknownKey', 'fallback')).toBe('fallback');
    adapter.setSetting('pixel-agents.unknownKey', 'ignored');
    const configPath = path.join(tempHome, '.pixel-agents', 'config.json');
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it('accepts setting keys with or without the pixel-agents. prefix', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    adapter.setSetting('pixel-agents.soundEnabled', false);
    expect(adapter.getSetting('soundEnabled', true)).toBe(false);
    adapter.setSetting('lastSeenVersion', '1.0');
    expect(adapter.getSetting('pixel-agents.lastSeenVersion', '')).toBe('1.0');
  });

  it('persists settings under namespace in config.json with clean field names', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    adapter.setSetting('pixel-agents.soundEnabled', false);
    const configPath = path.join(tempHome, '.pixel-agents', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    expect(parsed.standalone.soundEnabled).toBe(false);
    expect(parsed.standalone['pixel-agents.soundEnabled']).toBeUndefined();
  });

  // ── Per-namespace state file (agents + seats) ───────────────

  it('returns empty arrays/objects when state file does not exist', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    expect(adapter.loadAgents()).toEqual([]);
    expect(adapter.loadSeats()).toEqual({});
  });

  it('round-trips agents to the namespace-specific state file', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    const agents: PersistedAgent[] = [
      {
        id: 1,
        sessionId: 'sess-1',
        terminalName: 'Claude Code #1',
        jsonlFile: '/tmp/sess-1.jsonl',
        projectDir: '/tmp/proj',
      },
    ];
    adapter.saveAgents(agents);
    expect(adapter.loadAgents()).toEqual(agents);
  });

  it('writes state at ~/.pixel-agents/<namespace>-state.json', () => {
    const adapter = new FileStateAdapter({ namespace: 'vscode' });
    adapter.saveSeats({ '1': { palette: 2, hueShift: 45 } });
    const stateFile = path.join(tempHome, '.pixel-agents', 'vscode-state.json');
    expect(fs.existsSync(stateFile)).toBe(true);
  });

  it('vscode and standalone state files are independent', () => {
    const vscode = new FileStateAdapter({ namespace: 'vscode' });
    const standalone = new FileStateAdapter({ namespace: 'standalone' });
    const agentVs: PersistedAgent[] = [
      { id: 1, terminalName: 'A', jsonlFile: '/a.jsonl', projectDir: '/proj' },
    ];
    const agentSa: PersistedAgent[] = [
      { id: 9, terminalName: '', jsonlFile: '/b.jsonl', projectDir: '/proj' },
    ];
    vscode.saveAgents(agentVs);
    standalone.saveAgents(agentSa);
    expect(vscode.loadAgents()).toEqual(agentVs);
    expect(standalone.loadAgents()).toEqual(agentSa);
  });

  it('preserves seats when saving agents (and vice versa)', () => {
    const adapter = new FileStateAdapter({ namespace: 'standalone' });
    adapter.saveSeats({ '1': { palette: 3 } });
    adapter.saveAgents([{ id: 1, terminalName: 'x', jsonlFile: '/x.jsonl', projectDir: '/tmp' }]);
    expect(adapter.loadSeats()).toEqual({ '1': { palette: 3 } });
    expect(adapter.loadAgents()).toHaveLength(1);
  });
});
