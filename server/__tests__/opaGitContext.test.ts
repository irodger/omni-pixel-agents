import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import { isGitContext } from '../../core/src/opa/gitContext.js';
import type { OpaWorkData } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { gitContextReply, observeGitContext } from '../src/opa/gitContext.js';
import { changeTask, taskRunsPage, updateTaskExecution } from '../src/opa/work.js';

const temporary: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'opa-git-context-'));
  temporary.push(dir);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=OPA fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'core.hooksPath=' + join(dir, 'no-hooks'),
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git('init', '-b', 'main');
  return {
    dir: realpathSync(dir),
    git,
    commit() {
      writeFileSync(join(dir, 'file.txt'), 'base\n');
      git('add', 'file.txt');
      git('commit', '-m', 'fixture');
      return git('rev-parse', 'HEAD');
    },
  };
}
describe('read-only Git observations', () => {
  it('records canonical nested cwd, clean HEAD and branch without refreshing index or invoking fsmonitor', () => {
    const f = fixture();
    f.commit();
    expect(observeGitContext(f.dir)).toMatchObject({ state: 'available', dirty: false });
    mkdirSync(join(f.dir, 'nested'));
    const marker = join(f.dir, 'monitor-ran');
    const monitor = join(f.dir, 'monitor.sh');
    writeFileSync(monitor, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    const filter = join(f.dir, '.git', 'clean-filter.sh');
    writeFileSync(filter, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o700 });
    writeFileSync(join(f.dir, '.gitattributes'), 'file.txt filter=fixture\n');
    f.git('add', '.gitattributes');
    f.git('config', 'filter.fixture.required', 'false');
    f.git('commit', '-m', 'attributes fixture');
    f.git('config', 'filter.fixture.clean', filter);
    f.git('config', 'filter.fixture.required', 'true');

    const head = f.git('rev-parse', 'HEAD');
    f.git('config', 'core.fsmonitor', monitor);
    // Ignore fixture helper files so only the intended worktree state is measured.
    writeFileSync(join(f.dir, '.git/info/exclude'), 'monitor.sh\n');
    const index = join(f.dir, '.git/index'),
      original = readFileSync(index),
      mtime = statSync(index).mtimeMs;
    vi.stubEnv('GIT_DIR', join(f.dir, 'wrong-git-dir'));
    const result = observeGitContext(join(f.dir, 'nested'));
    expect(result).toMatchObject({
      state: 'available',
      cwd: join(f.dir, 'nested'),
      root: f.dir,
      head,
      branch: 'main',
      detached: false,
      dirty: undefined,
      filtersDisabled: true,
      conflicted: false,
      submodule: false,
    });
    expect(isGitContext(result)).toBe(true);
    expect(readFileSync(index)).toEqual(original);
    expect(statSync(index).mtimeMs).toBe(mtime);
    expect(() => statSync(marker)).toThrow();
    writeFileSync(join(f.dir, 'file.txt'), 'dirty\n');
    expect(observeGitContext(f.dir)).toMatchObject({
      dirty: undefined,
      filtersDisabled: true,
      head,
    });
    expect(readFileSync(join(f.dir, 'file.txt'), 'utf8')).toBe('dirty\n');
    expect(() => statSync(marker)).toThrow();
  });
  it('distinguishes unborn, detached, non-Git, bare and deleted worktrees', () => {
    const f = fixture();
    expect(observeGitContext(f.dir)).toMatchObject({
      state: 'available',
      branch: 'main',
      detached: false,
      head: undefined,
    });
    const head = f.commit();
    f.git('checkout', '--detach', head);
    expect(observeGitContext(f.dir)).toMatchObject({
      state: 'available',
      detached: true,
      head,
      branch: undefined,
    });
    const plain = join(f.dir, 'plain');
    mkdirSync(plain);
    // A directory outside the repo, not a nested directory inheriting its repository.
    const outside = mkdtempSync(join(tmpdir(), 'opa-non-git-'));
    temporary.push(outside);
    expect(observeGitContext(outside).state).toBe('not-git');
    const bare = join(outside, 'bare');
    f.git('init', '--bare', bare);
    expect(observeGitContext(bare).state).toBe('unavailable');
    expect(observeGitContext(join(outside, 'missing')).state).toBe('unavailable');
    expect(observeGitContext('relative').state).toBe('unavailable');
  });
  it('separates linked worktrees by gitDir with a common repo and canonical symlink paths', () => {
    const f = fixture(),
      head = f.commit();
    const linked = join(f.dir, 'linked');
    f.git('worktree', 'add', '-b', 'task-fixture', linked);
    const main = observeGitContext(f.dir),
      work = observeGitContext(linked);
    expect(work).toMatchObject({
      state: 'available',
      root: linked,
      head,
      branch: 'task-fixture',
      commonDir: main.commonDir,
    });
    expect(work.gitDir).not.toBe(main.gitDir);
    const alias = join(f.dir, 'alias');
    symlinkSync(linked, alias, 'junction');
    expect(observeGitContext(alias)).toMatchObject({
      cwd: linked,
      root: linked,
      gitDir: work.gitDir,
    });
    rmSync(linked, { recursive: true, force: true });
    expect(observeGitContext(alias).state).toBe('unavailable');
  });
  it('retains conflicting and untracked work unchanged while reporting conflicts', () => {
    const f = fixture();
    f.commit();
    f.git('checkout', '-b', 'other');
    writeFileSync(join(f.dir, 'file.txt'), 'other\n');
    f.git('commit', '-am', 'other');
    f.git('checkout', 'main');
    writeFileSync(join(f.dir, 'file.txt'), 'main\n');
    f.git('commit', '-am', 'main');
    expect(() => f.git('merge', 'other')).toThrow();
    writeFileSync(join(f.dir, 'untracked.txt'), 'keep me');
    const conflict = readFileSync(join(f.dir, 'file.txt'), 'utf8');
    expect(observeGitContext(f.dir)).toMatchObject({
      state: 'available',
      dirty: true,
      conflicted: true,
    });
    expect(readFileSync(join(f.dir, 'file.txt'), 'utf8')).toBe(conflict);
    expect(readFileSync(join(f.dir, 'untracked.txt'), 'utf8')).toBe('keep me');
  });
  it('queries only known task projects, persists immutable snapshots through restart, rejects malformed evidence', () => {
    const f = fixture();
    f.commit();
    let saved: OpaWorkData = { tasks: [], usage: [] };
    const adapter = {
      loadOpaWork: () => structuredClone(saved),
      saveOpaWork: (data: OpaWorkData) => {
        saved = structuredClone(data);
      },
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
    const store = restart();
    expect(gitContextReply(store, { requestId: 'r', projectPath: f.dir })).toMatchObject({
      error: 'PROJECT_NOT_FOUND',
    });
    const task = changeTask(store, {
      action: 'create',
      requestId: 'task',
      projectPath: f.dir,
      title: 'fixture',
    });
    const context = observeGitContext(f.dir);
    updateTaskExecution(
      store,
      task,
      { runId: 'run', state: 'running', journal: '/fixture', startedAt: 1, gitContext: context },
      'in_progress',
    );
    updateTaskExecution(
      store,
      task,
      {
        runId: 'run',
        state: 'cancelled',
        journal: '/fixture',
        startedAt: 1,
        finishedAt: 2,
        gitContext: context,
      },
      'cancelled',
    );
    writeFileSync(join(f.dir, 'file.txt'), 'later change');
    expect(gitContextReply(store, { requestId: 'r', projectPath: f.dir })).toMatchObject({
      context: { dirty: true },
    });
    const before = structuredClone(saved),
      send = vi.fn();
    handleClientMessage(
      {
        type: 'opaGitContextRequest',
        requestId: 'passive',
        projectPath: f.dir,
        action: 'start',
        launch: true,
      },
      send,
      { store, cache: null, privileged: false },
    );
    expect(send.mock.calls[0][0]).toMatchObject({
      type: 'opaGitContextState',
      context: { dirty: true },
    });
    expect(saved).toEqual(before);
    expect(
      taskRunsPage(restart(), { projectPath: f.dir, taskId: task.id }).runs[0].execution.gitContext,
    ).toEqual(context);
    expect(isGitContext({ ...context, version: 2 })).toBe(false);
    expect(isGitContext({ ...context, head: 'invented' })).toBe(false);
    expect(isGitContext({ ...context, dirty: undefined })).toBe(false);
  });
});
