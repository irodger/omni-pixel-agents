import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { OpaGitContext } from '../../../core/src/opa/gitContext.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { opaCampusSnapshot } from './campus.js';
import { attentionWorkInputs } from './work.js';

/** Fixed read-only argv, bounded output/time, no shell, hooks or fsmonitor. */
export function observeGitContext(path: string): OpaGitContext {
  const base: OpaGitContext = {
    version: 1,
    observedAt: Date.now(),
    cwd: path,
    state: 'unavailable',
  };
  try {
    if (!isAbsolute(path) || path.includes('\0') || path.length > 8192) return base;
    const cwd = realpathSync(path);
    base.cwd = cwd;
    // Do not inherit Git routing/config injection from the process that launched OPA.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
    );
    env.GIT_OPTIONAL_LOCKS = '0';
    env.GIT_TERMINAL_PROMPT = '0';
    env.LC_ALL = 'C';
    const deadline = Date.now() + 2000;
    const filterOverrides: string[] = [];
    const git = (...args: string[]) =>
      spawnSync(
        'git',
        [
          '--no-optional-locks',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.untrackedCache=false',
          ...filterOverrides,
          ...args,
        ],
        {
          cwd,
          env,
          shell: false,
          encoding: 'utf8',
          timeout: Math.max(1, deadline - Date.now()),
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        },
      );
    const inside = git('rev-parse', '--is-inside-work-tree');
    if (inside.error) return base;
    if (inside.status !== 0) {
      // Only the explicit non-repository diagnostic is absence; permissions/safe.directory stay unknown.
      return {
        ...base,
        state: inside.stderr.startsWith('fatal: not a git repository') ? 'not-git' : 'unavailable',
      };
    }
    if (inside.stdout.trim() !== 'true') return base;
    // Status may run clean/process filters while comparing changed files. Disable every
    // configured filter before reading the index; unknown attribute filters have no command.
    const filters = git(
      'config',
      '--null',
      '--name-only',
      '--get-regexp',
      '^filter\\..*\\.(clean|process|required)$',
    );
    if (filters.error || ![0, 1].includes(filters.status ?? -1)) return base;
    const keys = [...new Set(filters.stdout.split('\0').filter(Boolean))];
    if (keys.length > 256) return base;
    for (const key of keys) {
      if (!/^filter\..+\.(clean|process|required)$/.test(key)) return base;
      filterOverrides.push('-c', `${key}=${key.endsWith('.required') ? 'false' : ''}`);
    }

    const read = (...args: string[]) => {
      const result = git(...args);
      if (result.error || result.status !== 0) throw Error('GIT_UNAVAILABLE');
      return result.stdout.replace(/\r?\n$/, '');
    };
    const identity = () =>
      read(
        'rev-parse',
        '--path-format=absolute',
        '--show-toplevel',
        '--git-common-dir',
        '--absolute-git-dir',
      );
    const beforeIdentity = identity();
    const [root, commonDir, gitDir, ...extra] = beforeIdentity.split('\n');
    if (extra.length || ![root, commonDir, gitDir].every((p) => p && isAbsolute(p))) return base;
    const head = () => {
      const result = git('rev-parse', '--verify', 'HEAD');
      if (
        !result.error &&
        result.status === 0 &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})\s*$/.test(result.stdout)
      )
        return result.stdout.trim();
      // An unborn branch has no commit. Other failures cannot be represented as a clean repo.
      if (result.error || result.status !== 128) throw Error('GIT_UNAVAILABLE');
      const symbolic = git('symbolic-ref', '--quiet', 'HEAD');
      if (symbolic.error || symbolic.status !== 0) throw Error('GIT_UNAVAILABLE');
      const exists = git('show-ref', '--verify', '--quiet', symbolic.stdout.trim());
      if (exists.error || exists.status !== 1) throw Error('GIT_UNAVAILABLE');
      return undefined;
    };
    const branch = () => {
      const result = git('symbolic-ref', '--quiet', '--short', 'HEAD');
      if (result.error || ![0, 1].includes(result.status ?? -1)) throw Error('GIT_UNAVAILABLE');
      return result.status === 0 ? result.stdout.replace(/\r?\n$/, '') : undefined;
    };
    const beforeHead = head(),
      beforeBranch = branch();
    const status = read(
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=normal',
      '--ignore-submodules=all',
    );
    const submodule = !!read('rev-parse', '--show-superproject-working-tree');
    if (identity() !== beforeIdentity || head() !== beforeHead || branch() !== beforeBranch)
      return { ...base, state: 'unstable' };
    // NUL records may include rename destinations. Only XY prefixes denote statuses.
    const records = status.split('\0');
    let conflicted = false;
    for (let i = 0; i < records.length; i++) {
      const xy = records[i].slice(0, 2);
      if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(xy)) conflicted = true;
      if (xy.includes('R') || xy.includes('C')) i++;
    }
    return {
      ...base,
      state: 'available',
      root: realpathSync(root),
      commonDir: realpathSync(commonDir),
      gitDir: realpathSync(gitDir),
      head: beforeHead,
      branch: beforeBranch,
      detached: beforeBranch === undefined,
      dirty: keys.length ? undefined : status.length > 0,
      filtersDisabled: keys.length > 0,
      conflicted,
      submodule,
    };
  } catch {
    return base;
  }
}

/** Observer visibility matches known office/task projects; never an arbitrary directory browser. */
export function gitContextReply(store: AgentStateStore, raw: Record<string, unknown>) {
  const requestId =
    typeof raw.requestId === 'string' && raw.requestId.length <= 200 ? raw.requestId : '';
  const reply = { type: 'opaGitContextState' as const, requestId };
  if (
    !requestId ||
    typeof raw.projectPath !== 'string' ||
    !isAbsolute(raw.projectPath) ||
    raw.projectPath.includes('\0') ||
    raw.projectPath.length > 8192
  )
    return { ...reply, error: 'GIT_QUERY_INVALID' };
  const project = toPathKey(raw.projectPath);
  try {
    const known =
      opaCampusSnapshot(store).projects.some((p) => p.id === project) ||
      attentionWorkInputs(store).tasks.some((t) => t.projectPath === project);
    if (!known) return { ...reply, error: 'PROJECT_NOT_FOUND' };
    const task =
      raw.taskId === undefined
        ? undefined
        : attentionWorkInputs(store).tasks.find(
            (t) => t.projectPath === project && t.id === raw.taskId,
          );
    if (raw.taskId !== undefined && (!task || typeof raw.taskId !== 'string'))
      return { ...reply, error: 'TASK_NOT_FOUND' };
    return {
      ...reply,
      projectPath: project,
      context: observeGitContext(task?.worktree?.cwd ?? project),
    };
  } catch {
    return { ...reply, error: 'GIT_CONTEXT_UNAVAILABLE' };
  }
}
