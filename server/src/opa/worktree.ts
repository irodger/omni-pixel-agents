import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

import type { OpaGitContext } from '../../../core/src/opa/gitContext.js';
import type { OpaTask } from '../../../core/src/opa/work.js';
import {
  gitCommitId,
  type OpaWorktreeBinding,
  type OpaWorktreeCommand,
} from '../../../core/src/opa/worktree.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { isTaskRunning } from './execution.js';
import { observeGitContext } from './gitContext.js';
import { bindTaskWorktree, opaWorkSnapshot, WorkError } from './work.js';

const same = (a: string, b: string) => toPathKey(a) === toPathKey(b);
const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return !r || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r));
};
function git(cwd: string, ...args: string[]) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  env.GIT_TERMINAL_PROMPT = '0';
  env.LC_ALL = 'C';
  return spawnSync(
    'git',
    [
      '-c',
      `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
      '-c',
      'core.fsmonitor=false',
      ...args,
    ],
    {
      cwd,
      env,
      shell: false,
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
}
function registeredWorktree(source: string, context: OpaGitContext): boolean {
  const result = git(source, 'worktree', 'list', '--porcelain', '-z');
  if (result.error || result.status !== 0) return false;
  let record: Record<string, string> = {};
  const matches = () => {
    try {
      return (
        !!record.worktree &&
        same(realpathSync(record.worktree), context.cwd) &&
        record.HEAD === context.head &&
        (record.branch
          ? record.branch === 'refs/heads/' + context.branch
          : context.detached === true)
      );
    } catch {
      return false;
    }
  };
  for (const field of result.stdout.split('\0')) {
    if (!field) {
      if (matches()) return true;
      record = {};
      continue;
    }
    const split = field.indexOf(' ');
    record[split < 0 ? field : field.slice(0, split)] = split < 0 ? '' : field.slice(split + 1);
  }
  return matches();
}
export function resolveTaskDirectory(task: OpaTask) {
  let cwd: string;
  try {
    cwd = realpathSync(task.projectPath);
  } catch {
    throw new WorkError('PROJECT_UNAVAILABLE');
  }
  const source = observeGitContext(cwd),
    binding = task.worktree;
  if (!binding) return { cwd, gitContext: source, projectCwd: source.cwd };
  const context = observeGitContext(binding.cwd);
  if (
    source.state !== 'available' ||
    context.state !== 'available' ||
    !same(source.cwd, binding.sourceCwd) ||
    !same(source.root!, binding.sourceRoot) ||
    !same(source.commonDir!, binding.commonDir) ||
    !same(context.cwd, binding.cwd) ||
    !same(context.root!, binding.cwd) ||
    !same(context.commonDir!, binding.commonDir) ||
    !same(context.gitDir!, binding.gitDir) ||
    context.branch !== binding.branch ||
    context.head !== binding.baseCommit ||
    context.submodule ||
    same(context.gitDir!, source.gitDir!) ||
    !registeredWorktree(source.cwd, context)
  )
    throw new WorkError('WORKTREE_CHANGED');
  return {
    cwd: context.cwd,
    gitContext: context,
    projectCwd: source.cwd,
    worktree: structuredClone(binding),
  };
}

/** Explicit authenticated setup only. It never dispatches an executor or removes Git data. */
export function executeWorktreeCommand(store: AgentStateStore, raw: Record<string, unknown>): void {
  const text = (v: unknown, max: number): v is string =>
    typeof v === 'string' && !!v.trim() && v.length <= max && !v.includes('\0');
  if (
    !text(raw.requestId, 200) ||
    !text(raw.projectPath, 8192) ||
    !text(raw.taskId, 200) ||
    !Number.isSafeInteger(raw.expectedRevision) ||
    !['create', 'attach', 'detach'].includes(String(raw.action)) ||
    Object.keys(raw).some(
      (k) =>
        ![
          'type',
          'requestId',
          'projectPath',
          'taskId',
          'expectedRevision',
          'action',
          'path',
          'branch',
          'expectedHead',
        ].includes(k),
    )
  )
    throw new WorkError('WORKTREE_INVALID');
  const command = raw as unknown as OpaWorktreeCommand;
  const tasks = opaWorkSnapshot(store).tasks;
  const task = tasks.find(
    (t) => t.projectPath === toPathKey(command.projectPath) && t.id === command.taskId,
  );
  if (!task) throw new WorkError('TASK_NOT_FOUND');
  if (task.revision !== command.expectedRevision) throw new WorkError('TASK_CONFLICT');
  if (isTaskRunning(store, task)) throw new WorkError('TASK_RUNNING');
  if (command.action === 'detach') {
    if (
      command.path !== undefined ||
      command.branch !== undefined ||
      command.expectedHead !== undefined
    )
      throw new WorkError('WORKTREE_INVALID');
    bindTaskWorktree(store, task, undefined);
    return;
  }
  if (
    !text(command.path, 8192) ||
    !isAbsolute(command.path) ||
    !gitCommitId(command.expectedHead) ||
    (command.action === 'attach' && command.branch !== undefined)
  )
    throw new WorkError('WORKTREE_INVALID');
  const source = observeGitContext(task.projectPath);
  if (source.state !== 'available' || !source.head || source.submodule)
    throw new WorkError('WORKTREE_REPO_UNAVAILABLE');
  let created = false,
    target = command.path;
  if (command.action === 'create') {
    if (task.worktree) throw new WorkError('WORKTREE_ALREADY_BOUND');
    if (source.filtersDisabled) throw new WorkError('WORKTREE_FILTERS_UNSUPPORTED');
    if (!text(command.branch, 150) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(command.branch))
      throw new WorkError('WORKTREE_BRANCH_INVALID');
    if (source.head !== command.expectedHead) throw new WorkError('WORKTREE_CHANGED');
    try {
      lstatSync(target);
      throw new WorkError('WORKTREE_PATH_EXISTS');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    try {
      target = join(realpathSync(dirname(target)), basename(target));
    } catch {
      throw new WorkError('WORKTREE_PARENT_UNAVAILABLE');
    }
    if (inside(source.root!, target) || observeGitContext(dirname(target)).state !== 'not-git')
      throw new WorkError('WORKTREE_LOCATION_INVALID');
    const filters = git(
      source.cwd,
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^filter\\..*\\.(smudge|process)$',
    );
    if (filters.error || ![0, 1].includes(filters.status ?? -1) || filters.stdout.length)
      throw new WorkError('WORKTREE_FILTERS_UNSUPPORTED');
    const ref = git(source.cwd, 'check-ref-format', '--branch', command.branch!);
    if (ref.error || ref.status !== 0) throw new WorkError('WORKTREE_BRANCH_INVALID');
    const result = git(
      source.cwd,
      'worktree',
      'add',
      '-b',
      command.branch!,
      target,
      command.expectedHead!,
    );
    if (result.error || result.status !== 0) throw new WorkError('WORKTREE_CREATE_UNCERTAIN');
    created = true;
  }
  const context = observeGitContext(target);
  if (
    context.state !== 'available' ||
    !context.head ||
    context.head !== command.expectedHead ||
    !same(context.cwd, context.root!) ||
    !same(context.commonDir!, source.commonDir!) ||
    same(context.gitDir!, source.gitDir!) ||
    context.submodule ||
    !registeredWorktree(source.cwd, context) ||
    (command.action === 'create' && (context.branch !== command.branch || context.dirty !== false))
  )
    throw new WorkError(created ? 'WORKTREE_CREATED_NOT_BOUND' : 'WORKTREE_IDENTITY_INVALID');
  if (
    tasks.some(
      (t) =>
        !(t.id === task.id && t.projectPath === task.projectPath) &&
        t.worktree &&
        same(t.worktree.gitDir, context.gitDir!),
    )
  )
    throw new WorkError('WORKTREE_IN_USE');
  const binding: OpaWorktreeBinding = {
    version: 1,
    cwd: context.cwd,
    sourceCwd: source.cwd,
    sourceRoot: source.root!,
    commonDir: source.commonDir!,
    gitDir: context.gitDir!,
    baseCommit: context.head,
    branch: context.branch,
    created,
  };
  try {
    bindTaskWorktree(store, task, binding);
  } catch (e) {
    if (created) throw new WorkError('WORKTREE_CREATED_NOT_BOUND');
    throw e;
  }
}
