import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaGitContext } from '../../core/src/opa/gitContext.js';
import type { OpaWorkData } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { validateTaskStart } from '../src/opa/execution.js';
import { observeGitContext } from '../src/opa/gitContext.js';
import { historyPage } from '../src/opa/history.js';
import { qualityReply, stopQualityChecks } from '../src/opa/quality.js';
import { qualityFingerprint } from '../src/opa/qualityFingerprint.js';
import { qualityData } from '../src/opa/work.js';
import { changeTask, updateTaskExecution } from '../src/opa/work.js';

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: ((
      file: string,
      args: readonly string[] = [],
      options: import('node:child_process').SpawnSyncOptions = {},
    ) => {
      const result = actual.spawnSync(file, args, {
        ...options,
        env:
          file === 'git'
            ? {
                ...options.env,
                GIT_CONFIG_NOSYSTEM: '1',
                GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
              }
            : options.env,
      });
      return result;
    }) as typeof actual.spawnSync,
  };
});
const roots: string[] = [];
const stores: AgentStateStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) stopQualityChecks(store);
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opa-quality-')));
  roots.push(root);
  const source = join(root, 'source');
  mkdirSync(source);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=' + join(root, 'no-hooks'),
        ...args,
      ],
      { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git('init', '-b', 'main');
  writeFileSync(join(source, 'file.txt'), 'base\n'.repeat(10));
  git('add', 'file.txt');
  git('commit', '-m', 'base');
  let saved: OpaWorkData = { tasks: [], usage: [] };
  const store = new AgentStateStore();
  store.setAdapter({
    loadOpaWork: () => structuredClone(saved),
    saveOpaWork: (v: OpaWorkData) => {
      saved = structuredClone(v);
    },
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_: string, fallback: unknown) => fallback,
    setSetting: () => {},
  } as StateAdapter);
  function record(
    id = 'task',
    cwd = source,
    start = observeGitContext(cwd),
    end: OpaGitContext | undefined = observeGitContext(cwd),
  ) {
    const task = changeTask(store, {
      action: 'create',
      requestId: id,
      projectPath: source,
      title: 'Fixture ' + id,
    });
    const execution = {
      runId: 'run-' + id,
      cwd,
      journal: '/fixture',
      startedAt: 1,
      gitContext: start,
    };
    updateTaskExecution(store, task, { ...execution, state: 'running' }, 'in_progress');
    updateTaskExecution(
      store,
      task,
      { ...execution, state: 'completed', finishedAt: 2, gitContextAfter: end },
      'done',
    );
    return { projectPath: source, taskId: id, runId: execution.runId, mode: 'committed' };
  }
  return { root, source, store, git, record, saved: () => structuredClone(saved) };
}
function setup(code = 'console.log("fixture: no tests reported")') {
  const f = fixture();
  stores.push(f.store);
  writeFileSync(join(f.source, 'check.cjs'), code);
  const q = f.record();
  const profile = {
    id: 'check',
    name: 'Fixture local check',
    executable: process.execPath,
    args: ['check.cjs'],
    timeoutMs: 5000,
  };
  const call = (action: string, extra: Record<string, unknown> = {}) =>
    qualityReply(f.store, { ...q, requestId: 'request', action, ...extra });
  expect(call('save', { expectedRevision: 0, checks: [profile] }).error).toBeUndefined();
  const prepare = () => {
    const r = call('prepare', { checkId: 'check' });
    expect(r.error).toBeUndefined();
    return r.plan!;
  };
  const run = () => {
    const p = prepare();
    const r = call('run', { planId: p.id, approved: true });
    expect(r.error).toBeUndefined();
    return r.checkRunId!;
  };
  const done = async () => {
    await vi.waitFor(() => expect(qualityData(f.store).runs.at(-1)?.state).not.toBe('running'), {
      timeout: 10000,
      interval: 20,
    });
    return qualityData(f.store).runs.at(-1)!;
  };
  return { ...f, q, profile, call, prepare, run, done };
}
describe('explicit host-owned quality checks (fixture processes)', () => {
  it('records observed exit zero, bounded logs, no invented tests, and consumes approval once', async () => {
    const f = setup(
      'console.log("<script>fixture</script>");process.stdout.write("x".repeat(9000));',
    );
    const p = f.prepare();
    expect(f.call('run', { planId: p.id }).error).toBe('QUALITY_APPROVAL_REQUIRED');
    expect(qualityData(f.store).runs).toHaveLength(0);
    expect(f.call('run', { planId: p.id, approved: true }).error).toBeUndefined();
    expect(f.call('run', { planId: p.id, approved: true }).error).toBe('QUALITY_APPROVAL_REQUIRED');
    const r = await f.done();
    const events = historyPage(f.store, {
      projectPath: f.source,
      runId: f.q.runId,
      provider: 'opa-quality',
    }).entries;
    expect(events.some((e) => e.event.type === 'tool.started')).toBe(true);
    expect(events.some((e) => e.event.type === 'tool.completed')).toBe(true);
    expect(events.every((e) => e.taskId === f.q.taskId && e.runId === f.q.runId)).toBe(true);
    expect(r.state).toBe('passed');
    expect(r.exitCode).toBe(0);
    expect(r.spawnedAt).toBeGreaterThan(0);
    expect(r.tests).toBe('unreported');
    expect(r.truncated).toBe(true);
    expect(r.stdout).toHaveLength(8192);
    expect(f.saved().attentionFacts?.some((x) => x.kind === 'check' && x.runId === f.q.runId)).toBe(
      true,
    );
    expect(f.call('query').runs?.[0].stale).toBe(false);
    writeFileSync(join(f.source, 'new.bin'), Buffer.from([0, 1, 2]));
    expect(f.call('query').runs?.[0].stale).toBe(true);
  });
  it('invalidates approvals on binary, script and config changes', () => {
    const f = setup();
    let p = f.prepare();
    writeFileSync(join(f.source, 'binary'), Buffer.from([0, 1]));
    expect(f.call('run', { planId: p.id, approved: true }).error).toBe('QUALITY_PLAN_STALE');
    p = f.prepare();
    writeFileSync(join(f.source, 'check.cjs'), 'process.exit(2)');
    expect(f.call('run', { planId: p.id, approved: true }).error).toBe('QUALITY_PLAN_STALE');
    p = f.prepare();
    f.call('save', {
      expectedRevision: 1,
      checks: [{ ...f.profile, args: ['-e', 'process.exit(0)'] }],
    });
    expect(f.call('run', { planId: p.id, approved: true }).error).toBe('QUALITY_APPROVAL_REQUIRED');
    expect(qualityData(f.store).runs).toHaveLength(0);
  });
  it('records nonzero and missing executables honestly', async () => {
    const f = setup('process.stderr.write("fixture failure");process.exit(7)');
    f.run();
    let r = await f.done();
    expect(r.state).toBe('failed');
    expect(r.exitCode).toBe(7);
    expect(r.stderr).toBe('fixture failure');
    f.call('save', {
      expectedRevision: 1,
      checks: [{ ...f.profile, executable: join(f.root, 'missing') }],
    });
    f.run();
    r = await f.done();
    expect(r.state).toBe('unknown');
    expect(r.exitCode).toBeUndefined();
    expect(r.spawnedAt).toBeUndefined();
    const events = historyPage(f.store, { projectPath: f.source, sessionId: r.checkRunId }).entries;
    expect(events.some((e) => e.event.type === 'tool.started')).toBe(false);
  });
  it('times out and cancels explicitly without retry', async () => {
    const f = setup('setInterval(()=>{},100)');
    f.call('save', { expectedRevision: 1, checks: [{ ...f.profile, timeoutMs: 100 }] });
    f.run();
    let r = await f.done();
    expect(r.state).toBe('failed');
    expect(r.reason).toBe('Timeout');
    f.call('save', { expectedRevision: 2, checks: [f.profile] });
    const id = f.run();
    expect(f.call('prepare', { checkId: 'check' }).error).toBe('PROJECT_BUSY');
    expect(f.call('cancel', { checkRunId: id }).error).toBeUndefined();
    r = await f.done();
    expect(r.state).toBe('unknown');
    expect(r.reason).toBe('Cancelled by user');
    expect(qualityData(f.store).runs).toHaveLength(2);
  });
  it('marks changed files stale even after exit zero', async () => {
    const f = setup('require("node:fs").writeFileSync("output.txt","fixture")');
    f.run();
    const r = await f.done();
    expect(r.exitCode).toBe(0);
    expect(r.stale).toBe(true);
  });
  it('skips without spawning and recovers lost ownership as unknown without resuming', async () => {
    const f = setup('setInterval(()=>{},100)');
    expect(f.call('skip', { checkId: 'check' }).runs?.[0].state).toBe('skipped');
    expect(qualityData(f.store).runs[0].spawnedAt).toBeUndefined();
    f.run();
    const saved = f.saved();
    const recovered = new AgentStateStore();
    recovered.setAdapter({
      ...f.store.getAdapter(),
      loadOpaWork: () => saved,
      saveOpaWork: () => {},
    } as StateAdapter);
    expect(qualityData(recovered).runs.at(-1)?.state).toBe('unknown');
    stopQualityChecks(f.store);
    await f.done();
  });
  it('refuses execution when persistence fails and preserves unknown storage versions', () => {
    const f = setup();
    const p = f.prepare();
    const adapter = f.store.getAdapter()!;
    adapter.saveOpaWork = () => {
      throw Error('fixture disk failure');
    };
    expect(f.call('run', { planId: p.id, approved: true }).error).toBe('STORAGE_FAILED');
    expect(qualityData(f.store).runs).toHaveLength(0);
    const bad = new AgentStateStore();
    bad.setAdapter({
      ...adapter,
      loadOpaWork: () => ({ ...f.saved(), quality: { version: 2 } }),
    } as unknown as StateAdapter);
    expect(() => qualityData(bad)).toThrow('QUALITY_HISTORY_INVALID');
  });
  it('hashes binary bytes and symlink text without reading external targets', () => {
    const f = setup();
    writeFileSync(join(f.root, 'outside'), 'one');
    if (process.platform !== 'win32') {
      symlinkSync(join(f.root, 'outside'), join(f.source, 'link'));
      const a = qualityFingerprint(f.source).fingerprint;
      writeFileSync(join(f.root, 'outside'), 'two');
      expect(qualityFingerprint(f.source).fingerprint).toBe(a);
    }
    const a = qualityFingerprint(f.source).fingerprint;
    writeFileSync(join(f.source, 'binary'), Buffer.from([0, 3]));
    expect(qualityFingerprint(f.source).fingerprint).not.toBe(a);
  });
  it('binds a check to the saved attempt worktree and blocks overlapping agent starts', async () => {
    const f = setup('console.log(process.cwd());setTimeout(()=>{},300)');
    const cwd = join(f.root, 'check-worktree');
    f.git('worktree', 'add', '-b', 'quality-fixture', cwd);
    writeFileSync(join(cwd, 'check.cjs'), 'console.log(process.cwd());setTimeout(()=>{},300)');
    const q = f.record('separate', cwd);
    const call = (action: string, extra: Record<string, unknown> = {}) =>
      qualityReply(f.store, { ...q, action, requestId: 'worktree-check', ...extra });
    const plan = call('prepare', { checkId: 'check' }).plan!;
    expect(plan.cwd).toBe(realpathSync(cwd));
    expect(call('run', { planId: plan.id, approved: true }).error).toBeUndefined();
    const task = f.saved().tasks.find((t) => t.id === f.q.taskId)!;
    expect(() => validateTaskStart(f.store, task, task.revision)).toThrow('PROJECT_BUSY');
    const r = await f.done();
    expect(r.stdout.trim()).toBe(realpathSync(cwd));
    expect(r.cwd).toBe(realpathSync(cwd));
    expect(r.taskId).toBe('separate');
  });
  it('expires confirmation and rejects relative executables without launching', () => {
    const f = setup();
    const plan = f.prepare();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60001);
    expect(f.call('run', { planId: plan.id, approved: true }).error).toBe(
      'QUALITY_APPROVAL_REQUIRED',
    );
    clock.mockRestore();
    expect(
      f.call('save', { expectedRevision: 1, checks: [{ ...f.profile, executable: 'node' }] }).error,
    ).toBe('QUALITY_CONFIG_INVALID');
    expect(qualityData(f.store).runs).toHaveLength(0);
  });
  it('denies anonymous command and log access', () => {
    const f = setup();
    const sent: Record<string, unknown>[] = [];
    handleClientMessage(
      { ...f.q, type: 'opaQualityCommand', requestId: 'private', action: 'query' },
      (m) => sent.push(m),
      { store: f.store, cache: null, privileged: false },
    );
    expect(sent).toContainEqual({
      type: 'opaQualityState',
      requestId: 'private',
      error: 'READ_ONLY',
    });
  });
});
