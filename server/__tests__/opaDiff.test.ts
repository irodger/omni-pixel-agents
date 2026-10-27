import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaGitContext } from '../../core/src/opa/gitContext.js';
import type { OpaWorkData } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { diffSnapshot } from '../src/opa/diff.js';
import { observeGitContext } from '../src/opa/gitContext.js';
import { changeTask, updateTaskExecution } from '../src/opa/work.js';

const race = vi.hoisted(() => ({ act: undefined as (() => void) | undefined }));
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
      if (file === 'git' && args.includes('diff') && !args.includes('--numstat') && race.act) {
        const fn = race.act;
        race.act = undefined;
        fn();
      }
      return result;
    }) as typeof actual.spawnSync,
  };
});
const roots: string[] = [];
afterEach(() => {
  race.act = undefined;
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opa-diff-')));
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
  return { root, source, store, git, record };
}
describe('bounded read-only run diffs', () => {
  it('bounds file lists and treats forced-text NUL content as binary on preview', () => {
    const f = fixture(),
      q = { ...f.record(), mode: 'working' };
    writeFileSync(join(f.source, '.gitattributes'), 'nul.bin diff\n');
    writeFileSync(join(f.source, 'nul.bin'), Buffer.from([0, 60, 115, 99, 114, 105, 112, 116, 62]));
    f.git('add', 'nul.bin');
    const first = diffSnapshot(f.store, q),
      selected = diffSnapshot(f.store, { ...q, path: 'nul.bin', expectedSnapshot: first.snapshot });
    expect(selected.files.find((x) => x.path === 'nul.bin')?.binary).toBe(true);
    expect(selected.patch).toBeUndefined();
    for (let i = 0; i < 201; i++) writeFileSync(join(f.source, 'new-' + i), 'metadata only');
    expect(() => diffSnapshot(f.store, q)).toThrow('DIFF_TOO_MANY_FILES');
  });

  it('anchors committed renames and stats to captured commits even after HEAD moves', () => {
    const f = fixture(),
      start = observeGitContext(f.source);
    f.git('mv', 'file.txt', 'renamed.txt');
    writeFileSync(join(f.source, 'renamed.txt'), 'base\n'.repeat(10) + 'added\n');
    f.git('commit', '-am', 'run change');
    const query = f.record('task', f.source, start),
      initial = diffSnapshot(f.store, query);
    expect(initial.files[0]).toMatchObject({
      path: 'renamed.txt',
      oldPath: 'file.txt',
      added: 1,
      binary: false,
    });
    const selected = diffSnapshot(f.store, {
      ...query,
      path: 'renamed.txt',
      expectedSnapshot: initial.snapshot,
    });
    expect(selected.patch).toContain('+added');
    expect(selected.files[0].openPath).toBe(join(f.source, 'renamed.txt'));
    writeFileSync(join(f.source, 'later'), 'outside run');
    f.git('add', 'later');
    f.git('commit', '-m', 'later');
    const later = diffSnapshot(f.store, query);
    expect(later.stale).toBe(true);
    expect(later.files.some((x) => x.path === 'later')).toBe(false);
    expect(() =>
      diffSnapshot(f.store, { ...query, path: 'renamed.txt', expectedSnapshot: initial.snapshot }),
    ).toThrow('DIFF_STALE');
  });
  it('keeps two worktrees separate and rejects changed text snapshots and literal-path injection', () => {
    const f = fixture(),
      a = join(f.root, 'a'),
      b = join(f.root, 'b');
    f.git('worktree', 'add', '--detach', a, 'HEAD');
    f.git('worktree', 'add', '--detach', b, 'HEAD');
    const qa = { ...f.record('a', a), mode: 'working' },
      qb = { ...f.record('b', b), mode: 'working' };
    writeFileSync(join(a, 'file.txt'), 'only-a\n');
    writeFileSync(join(b, 'file.txt'), 'only-b\n');
    const sa = diffSnapshot(f.store, qa),
      sb = diffSnapshot(f.store, qb);
    expect(
      diffSnapshot(f.store, { ...qa, path: 'file.txt', expectedSnapshot: sa.snapshot }).patch,
    ).toContain('only-a');
    expect(
      diffSnapshot(f.store, { ...qb, path: 'file.txt', expectedSnapshot: sb.snapshot }).patch,
    ).toContain('only-b');
    writeFileSync(join(a, 'file.txt'), 'changed-a\n');
    expect(() =>
      diffSnapshot(f.store, { ...qa, path: 'file.txt', expectedSnapshot: sa.snapshot }),
    ).toThrow('DIFF_STALE');
    expect(() =>
      diffSnapshot(f.store, { ...qa, path: '../outside', expectedSnapshot: sa.snapshot }),
    ).toThrow('DIFF_QUERY_INVALID');
    expect(() =>
      diffSnapshot(f.store, { ...qa, path: ':(glob)*', expectedSnapshot: sa.snapshot }),
    ).toThrow('DIFF_STALE');
    writeFileSync(join(a, 'literal[1].txt'), 'literal only');
    f.git('-C', a, '--literal-pathspecs', 'add', '--', 'literal[1].txt');
    const literal = diffSnapshot(f.store, qa);
    const patch = diffSnapshot(f.store, {
      ...qa,
      path: 'literal[1].txt',
      expectedSnapshot: literal.snapshot,
    }).patch;
    expect(patch).toContain('literal only');
    expect(patch).not.toContain('changed-a');
  });
  it('does not invent historical dirty contents, missing end commits or deleted worktrees', () => {
    const f = fixture(),
      path = join(f.root, 'worktree');
    f.git('worktree', 'add', '--detach', path, 'HEAD');
    const q = f.record('saved', path);
    writeFileSync(join(path, 'file.txt'), 'today, not historical');
    const current = diffSnapshot(f.store, { ...q, mode: 'working' });
    expect(current.historicalDirtyUnavailable).toBe(true);
    expect(current.mode).toBe('working');
    const missing = f.record('missing', f.source, observeGitContext(f.source), {
      version: 1,
      observedAt: 1,
      cwd: f.source,
      state: 'unavailable',
    });
    expect(() => diffSnapshot(f.store, missing)).toThrow('DIFF_END_CONTEXT_UNAVAILABLE');
    rmSync(path, { recursive: true, force: true });
    expect(() => diffSnapshot(f.store, q)).toThrow('DIFF_CONTEXT_UNAVAILABLE');
  });
  it('degrades binary/untracked files and keeps IDE links inside the real root', () => {
    const f = fixture(),
      q = { ...f.record(), mode: 'working' };
    writeFileSync(join(f.source, 'binary'), Buffer.from([0, 1, 2, 3]));
    f.git('add', 'binary');
    writeFileSync(join(f.root, 'secret'), 'secret bytes');
    symlinkSync(join(f.root, 'secret'), join(f.source, 'outside'));
    const s = diffSnapshot(f.store, q);
    expect(s.files.find((x) => x.path === 'binary')).toMatchObject({ binary: true });
    expect(s.files.find((x) => x.path === 'outside')).toMatchObject({
      untracked: true,
      openPath: undefined,
    });
    expect(
      diffSnapshot(f.store, { ...q, path: 'binary', expectedSnapshot: s.snapshot }).patch,
    ).toBeUndefined();
    expect(
      diffSnapshot(f.store, { ...q, path: 'outside', expectedSnapshot: s.snapshot }).patch,
    ).toBeUndefined();
  });
  it('bounds patches and fails visibly for an excessive aggregate diff', () => {
    const f = fixture(),
      q = { ...f.record(), mode: 'working' };
    writeFileSync(join(f.source, 'file.txt'), 'x'.repeat(150000));
    const s = diffSnapshot(f.store, q),
      p = diffSnapshot(f.store, { ...q, path: 'file.txt', expectedSnapshot: s.snapshot });
    expect(p.truncated).toBe(true);
    expect(p.patch?.length).toBe(131072);
    writeFileSync(join(f.source, 'file.txt'), 'x'.repeat(3 * 1024 * 1024));
    expect(() => diffSnapshot(f.store, q)).toThrow('DIFF_TOO_LARGE');
  });
  it('disables filters, textconv and external diff, preserving index bytes and files', () => {
    const f = fixture(),
      q = { ...f.record(), mode: 'working' },
      marker = join(f.root, 'executed'),
      script = join(f.root, 'command.sh');
    writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o700 });
    f.git('config', 'filter.fixture.clean', script);
    f.git('config', 'diff.external', script);
    f.git('config', 'diff.fixture.textconv', script);
    writeFileSync(join(f.source, '.gitattributes'), '*.txt filter=fixture diff=fixture\n');
    writeFileSync(join(f.source, 'file.txt'), 'safe raw diff\n');
    const index = readFileSync(join(f.source, '.git/index'));
    const s = diffSnapshot(f.store, q);
    expect(s.filtersDisabled).toBe(true);
    expect(
      diffSnapshot(f.store, { ...q, path: 'file.txt', expectedSnapshot: s.snapshot }).patch,
    ).toContain('safe raw diff');
    expect(() => readFileSync(marker)).toThrow();
    expect(readFileSync(join(f.source, '.git/index'))).toEqual(index);
  });
  it('rejects read-only clients and detects edits racing with a working diff', () => {
    const f = fixture(),
      q = { ...f.record(), mode: 'working' },
      send = vi.fn();
    handleClientMessage({ type: 'opaDiffRequest', requestId: 'read', ...q }, send, {
      store: f.store,
      cache: null,
      privileged: false,
    });
    expect(send.mock.calls[0][0]).toMatchObject({ type: 'opaDiffState', error: 'READ_ONLY' });
    race.act = () => writeFileSync(join(f.source, 'file.txt'), 'racing\n');
    expect(() => diffSnapshot(f.store, q)).toThrow('DIFF_CONTEXT_CHANGED');
  });
});
