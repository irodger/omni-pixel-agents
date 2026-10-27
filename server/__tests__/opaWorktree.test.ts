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
import type { OpaWorkData } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { observeGitContext } from '../src/opa/gitContext.js';
import { executeQueueCommand } from '../src/opa/queue.js';
import { applyWorkEvent, changeTask, opaWorkSnapshot, taskQueue } from '../src/opa/work.js';
import { executeWorktreeCommand, resolveTaskDirectory } from '../src/opa/worktree.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'opa-worktree-')));
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
  writeFileSync(join(source, 'file'), 'base');
  git('add', 'file');
  git('commit', '-m', 'fixture');
  let data: OpaWorkData = { tasks: [], usage: [] },
    fail = false;
  const adapter = {
    loadOpaWork: () => structuredClone(data),
    saveOpaWork: (v: OpaWorkData) => {
      if (fail) throw Error('fixture storage');
      data = structuredClone(v);
    },
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_: string, fallback: unknown) => fallback,
    setSetting: () => {},
  } as StateAdapter;
  const restart = () => {
    const s = new AgentStateStore();
    s.setAdapter(adapter);
    return s;
  };
  const store = restart();
  const task = changeTask(store, {
    action: 'create',
    requestId: 'task',
    projectPath: source,
    title: 'fixture',
  });
  const target = join(root, 'isolated'),
    head = git('rev-parse', 'HEAD');
  const command = {
    action: 'create',
    requestId: 'bind',
    taskId: task.id,
    projectPath: source,
    expectedRevision: task.revision,
    path: target,
    branch: 'opa/task',
    expectedHead: head,
  };
  return {
    root,
    source,
    target,
    git,
    head,
    store,
    task,
    command,
    restart,
    fail: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
    corruptBinding: () => {
      (data.tasks[0].worktree as unknown as { version: number }).version = 2;
    },
    current: () => opaWorkSnapshot(store).tasks[0],
  };
}
describe('explicit worktree setup', () => {
  it('fails on an unsupported saved binding without overwriting history or removing files', () => {
    const f = fixture();
    executeWorktreeCommand(f.store, f.command);
    f.corruptBinding();
    expect(() => opaWorkSnapshot(f.restart())).toThrow('WORKTREE_HISTORY_INVALID');
    expect(readFileSync(join(f.target, 'file'), 'utf8')).toBe('base');
  });

  it('keeps conflicted files and attached identity across host restart', () => {
    const f = fixture();
    f.git('worktree', 'add', '-b', 'conflict', f.target, f.head);
    f.git('-C', f.target, 'checkout', '-b', 'other');
    writeFileSync(join(f.target, 'file'), 'other');
    f.git('-C', f.target, 'commit', '-am', 'other');
    f.git('-C', f.target, 'checkout', 'conflict');
    writeFileSync(join(f.target, 'file'), 'ours');
    f.git('-C', f.target, 'commit', '-am', 'ours');
    expect(() => f.git('-C', f.target, 'merge', 'other')).toThrow();
    const conflict = readFileSync(join(f.target, 'file'), 'utf8'),
      head = f.git('-C', f.target, 'rev-parse', 'HEAD');
    const { branch: _, ...attach } = f.command;
    void _;
    executeWorktreeCommand(f.store, { ...attach, action: 'attach', expectedHead: head });
    const restored = opaWorkSnapshot(f.restart()).tasks[0];
    expect(resolveTaskDirectory(restored).gitContext).toMatchObject({
      conflicted: true,
      dirty: true,
    });
    expect(readFileSync(join(f.target, 'file'), 'utf8')).toBe(conflict);
  });

  it('creates a branch/worktree without launching, preserves dirty source and persists binding across restart', () => {
    const f = fixture();
    writeFileSync(join(f.source, 'file'), 'keep source');
    executeWorktreeCommand(f.store, f.command);
    const bound = f.current();
    expect(bound.execution).toBeUndefined();
    expect(bound.worktree).toMatchObject({
      cwd: f.target,
      branch: 'opa/task',
      baseCommit: f.head,
      created: true,
    });
    expect(readFileSync(join(f.source, 'file'), 'utf8')).toBe('keep source');
    expect(readFileSync(join(f.target, 'file'), 'utf8')).toBe('base');
    expect(opaWorkSnapshot(f.restart()).tasks[0].worktree).toEqual(bound.worktree);
    applyWorkEvent(f.store, {
      specVersion: '0.2',
      id: 'observed-edit',
      streamId: 'fixture',
      sequence: 0,
      provider: 'fixture',
      sessionId: 'fixture',
      agentId: 'fixture',
      timestamp: new Date(Date.now() + 1000).toISOString(),
      type: 'task.upserted',
      cwd: f.source,
      taskId: f.task.id,
      title: 'observed title',
      status: 'open',
    });
    expect(f.current().worktree).toEqual(bound.worktree);

    expect(() => executeWorktreeCommand(f.store, f.command)).toThrow('TASK_CONFLICT');
  });
  it('attaches dirty detached work without modification, rejects shared binding and detaches without cleanup', () => {
    const f = fixture();
    f.git('worktree', 'add', '--detach', f.target, f.head);
    writeFileSync(join(f.target, 'file'), 'keep target');
    const { branch: _, ...attach } = f.command;
    void _;
    executeWorktreeCommand(f.store, { ...attach, action: 'attach' });
    expect(f.current().worktree).toMatchObject({
      created: false,
      branch: undefined,
      cwd: f.target,
    });
    expect(resolveTaskDirectory(f.current()).cwd).toBe(f.target);
    const second = changeTask(f.store, {
      action: 'create',
      requestId: 'second',
      projectPath: f.source,
      title: 'second',
    });
    expect(() =>
      executeWorktreeCommand(f.store, {
        ...attach,
        action: 'attach',
        taskId: second.id,
        expectedRevision: second.revision,
      }),
    ).toThrow('WORKTREE_IN_USE');
    executeWorktreeCommand(f.store, {
      action: 'detach',
      requestId: 'detach',
      projectPath: f.source,
      taskId: f.task.id,
      expectedRevision: f.current().revision,
    });
    expect(f.current().worktree).toBeUndefined();
    expect(readFileSync(join(f.target, 'file'), 'utf8')).toBe('keep target');
    expect(f.git('worktree', 'list').replaceAll('\\', '/')).toContain(
      f.target.replaceAll('\\', '/'),
    );
  });
  it('rejects foreign repos, nested cwd, stale commits, changed branch and deleted worktrees', () => {
    const f = fixture();
    expect(() =>
      executeWorktreeCommand(f.store, { ...f.command, expectedHead: 'a'.repeat(40) }),
    ).toThrow('WORKTREE_CHANGED');
    executeWorktreeCommand(f.store, f.command);
    const bound = f.current();
    f.git('-C', f.target, 'checkout', '-b', 'changed');
    expect(() => resolveTaskDirectory(bound)).toThrow('WORKTREE_CHANGED');
    executeQueueCommand(f.store, {
      action: 'enqueue',
      requestId: 'q',
      projectPath: f.source,
      taskId: f.task.id,
      expectedRevision: 0,
      expectedTaskRevision: bound.revision,
    });
    expect(() =>
      executeQueueCommand(f.store, {
        action: 'start-next',
        requestId: 's',
        projectPath: f.source,
        taskId: f.task.id,
        expectedRevision: 1,
        expectedTaskRevision: bound.revision,
      }),
    ).toThrow('WORKTREE_CHANGED');
    expect(taskQueue(f.store, f.source).taskIds).toEqual([f.task.id]);
    f.git('-C', f.target, 'checkout', 'opa/task');
    mkdirSync(join(f.target, 'nested'));
    const { branch: _, ...attach } = f.command;
    void _;
    expect(() =>
      executeWorktreeCommand(f.store, {
        ...attach,
        action: 'attach',
        expectedRevision: bound.revision,
        path: join(f.target, 'nested'),
      }),
    ).toThrow('WORKTREE_IDENTITY_INVALID');
    const fake = join(f.root, 'fake');
    mkdirSync(fake);
    writeFileSync(join(fake, '.git'), readFileSync(join(f.target, '.git')));
    expect(() =>
      executeWorktreeCommand(f.store, {
        ...attach,
        action: 'attach',
        expectedRevision: bound.revision,
        path: fake,
      }),
    ).toThrow('WORKTREE_IDENTITY_INVALID');
    const foreign = join(f.root, 'foreign');
    mkdirSync(foreign);
    f.git('-C', foreign, 'init');
    expect(() =>
      executeWorktreeCommand(f.store, {
        ...attach,
        action: 'attach',
        expectedRevision: bound.revision,
        path: foreign,
      }),
    ).toThrow('WORKTREE_IDENTITY_INVALID');
    rmSync(f.target, { recursive: true, force: true });
    expect(() => resolveTaskDirectory(bound)).toThrow('WORKTREE_CHANGED');
  });
  it('never overwrites occupied paths, accepts no branch collision, and disables checkout hooks', () => {
    const f = fixture();
    mkdirSync(f.target);
    writeFileSync(join(f.target, 'keep'), 'keep');
    expect(() => executeWorktreeCommand(f.store, f.command)).toThrow('WORKTREE_PATH_EXISTS');
    expect(readFileSync(join(f.target, 'keep'), 'utf8')).toBe('keep');
    const marker = join(f.root, 'hook-ran');
    const hooks = join(f.root, 'hooks');
    mkdirSync(hooks);
    writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    f.git('config', 'core.hooksPath', hooks);
    executeWorktreeCommand(f.store, { ...f.command, path: join(f.root, 'new') });
    expect(() => readFileSync(marker)).toThrow();
    const second = changeTask(f.store, {
      action: 'create',
      requestId: 'second',
      projectPath: f.source,
      title: 'second',
    });
    expect(() =>
      executeWorktreeCommand(f.store, {
        ...f.command,
        taskId: second.id,
        expectedRevision: 1,
        path: join(f.root, 'collision'),
      }),
    ).toThrow('WORKTREE_CREATE_UNCERTAIN');
  });
  it('keeps newly created data on persistence failure, rejects automatic repeat and permits explicit later attachment', () => {
    const f = fixture();
    f.fail();
    expect(() => executeWorktreeCommand(f.store, f.command)).toThrow('WORKTREE_CREATED_NOT_BOUND');
    expect(f.current().worktree).toBeUndefined();
    expect(observeGitContext(f.target)).toMatchObject({ state: 'available', head: f.head });
    expect(() => executeWorktreeCommand(f.store, f.command)).toThrow('WORKTREE_PATH_EXISTS');
    f.recover();
    const { branch: _, ...attach } = f.command;
    void _;
    executeWorktreeCommand(f.store, { ...attach, action: 'attach' });
    expect(f.current().worktree?.cwd).toBe(f.target);
  });
  it('does not execute configured checkout filters and cannot mutate through observer access', () => {
    const f = fixture();
    f.git('config', 'filter.fixture.smudge', 'touch ' + join(f.root, 'filter-ran'));
    expect(() => executeWorktreeCommand(f.store, f.command)).toThrow(
      'WORKTREE_FILTERS_UNSUPPORTED',
    );
    const send = vi.fn();
    handleClientMessage({ type: 'opaWorktreeCommand', ...f.command }, send, {
      store: f.store,
      cache: null,
      privileged: false,
    });
    expect(send.mock.calls[0][0]).toMatchObject({ error: 'READ_ONLY' });
    expect(() => readFileSync(f.target)).toThrow();
  });
  it('rejects symlink retargeting to another worktree before launch', () => {
    const f = fixture();
    f.git('worktree', 'add', '--detach', f.target, f.head);
    const alias = join(f.root, 'alias');
    symlinkSync(f.target, alias, 'junction');
    const { branch: _, ...attach } = f.command;
    void _;
    executeWorktreeCommand(f.store, { ...attach, action: 'attach', path: alias });
    const bound = f.current();
    expect(bound.worktree?.cwd).toBe(f.target);
    // The binding pins the canonical target, so changing the alias cannot change launch cwd.
    rmSync(alias);
    symlinkSync(f.source, alias, 'junction');
    expect(resolveTaskDirectory(bound).cwd).toBe(f.target);
  });
});

// Fixture repositories must not inherit runner Git LFS or user-global filters.
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: ((
      file: string,
      args: readonly string[] = [],
      options: import('node:child_process').SpawnSyncOptions = {},
    ) =>
      actual.spawnSync(file, args, {
        ...options,
        env:
          file === 'git'
            ? {
                ...options.env,
                GIT_CONFIG_NOSYSTEM: '1',
                GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
              }
            : options.env,
      })) as typeof actual.spawnSync,
  };
});
