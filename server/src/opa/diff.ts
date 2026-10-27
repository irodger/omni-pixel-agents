import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import type { OpaDiffFile, OpaDiffSnapshot } from '../../../core/src/opa/diff.js';
import type { OpaGitContext } from '../../../core/src/opa/gitContext.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { observeGitContext } from './gitContext.js';
import { taskRunsPage } from './work.js';

function fail(code: string): never {
  throw new Error(code);
}
const safePath = (path: string) =>
  !!path &&
  path.length <= 8192 &&
  !isAbsolute(path) &&
  !path.includes('\0') &&
  !path.includes('\ufffd') &&
  !path.split(/[\\/]/).some((p) => p === '..' || p === '.') &&
  !/^[a-z]:/i.test(path);
const identity = (c: OpaGitContext) => JSON.stringify([c.cwd, c.root, c.commonDir, c.gitDir]);
const stamp = (c: OpaGitContext) => JSON.stringify([identity(c), c.head, c.branch]);
function openPath(root: string, path: string): string | undefined {
  try {
    const resolved = realpathSync(join(root, path)),
      rel = relative(root, resolved);
    if (process.platform !== 'win32' && resolved.includes('\\')) return undefined;
    if (
      !rel ||
      rel === '..' ||
      rel.startsWith('..' + sep) ||
      isAbsolute(rel) ||
      !statSync(resolved).isFile()
    )
      return undefined;
    return resolved;
  } catch {
    return undefined;
  }
}
function reader(cwd: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  env.LC_ALL = 'C';
  const overrides: string[] = [];
  const deadline = Date.now() + 8000;
  const call = (args: string[], maxBuffer = 2 * 1024 * 1024) =>
    spawnSync(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '-c',
        `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
        ...overrides,
        ...args,
      ],
      {
        cwd,
        env,
        shell: false,
        encoding: 'utf8',
        timeout: Math.max(1, Math.min(2000, deadline - Date.now())),
        maxBuffer,
        windowsHide: true,
      },
    );
  const filters = call([
    'config',
    '--null',
    '--name-only',
    '--get-regexp',
    '^filter\\..*\\.(clean|process|required)$',
  ]);
  if (filters.error || ![0, 1].includes(filters.status ?? -1)) fail('DIFF_UNAVAILABLE');
  const keys = [...new Set(filters.stdout.split('\0').filter(Boolean))];
  if (keys.length > 256) fail('DIFF_UNAVAILABLE');
  for (const k of keys) {
    if (!/^filter\..+\.(clean|process|required)$/.test(k)) fail('DIFF_UNAVAILABLE');
    overrides.push('-c', `${k}=${k.endsWith('.required') ? 'false' : ''}`);
  }
  return {
    call,
    filtersDisabled: keys.length > 0,
    read(args: string[]) {
      const r = call(args);
      if (r.error || r.status !== 0)
        fail(
          (r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOBUFS'
            ? 'DIFF_TOO_LARGE'
            : 'DIFF_UNAVAILABLE',
        );
      return r.stdout;
    },
  };
}
const diffOptions = [
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--ignore-submodules=all',
  '--find-renames=50%',
  '-l100',
];
/** Privileged read: immutable commit range or explicitly current, mutable tracked changes. */
export function diffSnapshot(
  store: AgentStateStore,
  raw: Record<string, unknown>,
): OpaDiffSnapshot {
  const text = (v: unknown, max: number): v is string =>
    typeof v === 'string' && !!v && v.length <= max && !v.includes('\0');
  if (
    !text(raw.projectPath, 8192) ||
    !text(raw.taskId, 200) ||
    !text(raw.runId, 200) ||
    typeof raw.mode !== 'string' ||
    !['committed', 'working'].includes(raw.mode) ||
    (raw.path !== undefined && (!text(raw.path, 8192) || !safePath(raw.path))) ||
    (raw.expectedSnapshot !== undefined &&
      (!text(raw.expectedSnapshot, 64) || !/^[a-f0-9]{64}$/.test(raw.expectedSnapshot))) ||
    (raw.path !== undefined && raw.expectedSnapshot === undefined)
  )
    fail('DIFF_QUERY_INVALID');
  const projectPath = toPathKey(raw.projectPath);
  const run = taskRunsPage(store, { projectPath, taskId: raw.taskId, runId: raw.runId }).runs[0];
  if (!run) fail('RUN_NOT_FOUND');
  const start = run.execution.gitContext,
    end = run.execution.gitContextAfter;
  if (
    start?.state !== 'available' ||
    !start.head ||
    !start.root ||
    !start.gitDir ||
    !start.commonDir
  )
    fail('DIFF_CONTEXT_UNAVAILABLE');
  const mode = raw.mode as 'committed' | 'working';
  if (
    mode === 'committed' &&
    (end?.state !== 'available' || !end.head || identity(start) !== identity(end))
  )
    fail('DIFF_END_CONTEXT_UNAVAILABLE');
  const reference = end?.state === 'available' ? end : start;
  const cwd = run.execution.cwd ?? start.cwd;
  const before = observeGitContext(cwd);
  if (before.state !== 'available' || !before.head || identity(before) !== identity(start))
    fail('DIFF_CONTEXT_UNAVAILABLE');
  const git = reader(before.root!);
  const base = mode === 'committed' ? start.head : before.head;
  const head = mode === 'committed' ? end!.head! : before.head;
  // Hex commit IDs are taken only from recorded/observed context; no arbitrary refs or revisions.
  git.read(['cat-file', '-e', base + '^{commit}']);
  git.read(['cat-file', '-e', head + '^{commit}']);
  const refs = mode === 'committed' ? [base, head] : [head];
  const stats = git.read([...diffOptions, '--numstat', '-z', ...refs, '--']);
  const files: OpaDiffFile[] = [];
  const parts = stats.split('\0');
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(parts[i]);
    if (!m) fail('DIFF_UNAVAILABLE');
    let path = m[3],
      oldPath: string | undefined;
    if (!path) {
      oldPath = parts[++i];
      path = parts[++i];
    }
    if (!safePath(path) || (oldPath !== undefined && !safePath(oldPath))) fail('DIFF_PATH_INVALID');
    files.push({
      path,
      oldPath,
      binary: m[1] === '-' || m[2] === '-',
      added: m[1] === '-' ? undefined : Number(m[1]),
      deleted: m[2] === '-' ? undefined : Number(m[2]),
      openPath: openPath(before.root!, path),
    });
    if (files.length > 200) fail('DIFF_TOO_MANY_FILES');
  }
  const untracked =
    mode === 'working' ? git.read(['ls-files', '--others', '--exclude-standard', '-z']) : '';
  for (const path of untracked.split('\0').filter(Boolean)) {
    if (!safePath(path)) fail('DIFF_PATH_INVALID');
    files.push({ path, binary: false, untracked: true, openPath: openPath(before.root!, path) });
    if (files.length > 200) fail('DIFF_TOO_MANY_FILES');
  }
  // Full bounded textual projection fingerprints dirty edits. Binary bytes and untracked contents are not captured.
  const full = git.read([...diffOptions, ...refs, '--']);
  const snapshot = createHash('sha256')
    .update(
      JSON.stringify([
        projectPath,
        raw.taskId,
        raw.runId,
        mode,
        base,
        head,
        stamp(before),
        stats,
        untracked,
        full,
      ]),
    )
    .digest('hex');
  if (raw.expectedSnapshot !== undefined && snapshot !== raw.expectedSnapshot) fail('DIFF_STALE');
  let patch: string | undefined,
    truncated = false;
  if (raw.path !== undefined) {
    const selected = files.find((f) => f.path === raw.path);
    if (!selected) fail('DIFF_PATH_INVALID');
    if (!selected.binary && !selected.untracked) {
      const content = git.read([
        ...diffOptions,
        ...refs,
        '--',
        ...(selected.oldPath ? [':(literal)' + selected.oldPath] : []),
        ':(literal)' + selected.path,
      ]);
      if (content.includes('\0')) {
        selected.binary = true;
        selected.added = undefined;
        selected.deleted = undefined;
      } else {
        patch = content.slice(0, 131072);
        truncated = patch.length < content.length;
      }
    }
  }
  if (
    mode === 'working' &&
    (git.read([...diffOptions, ...refs, '--']) !== full ||
      git.read(['ls-files', '--others', '--exclude-standard', '-z']) !== untracked)
  )
    fail('DIFF_CONTEXT_CHANGED');
  const after = observeGitContext(cwd);
  if (after.state !== 'available' || stamp(after) !== stamp(before)) fail('DIFF_CONTEXT_CHANGED');
  return {
    version: 1,
    projectPath,
    taskId: run.taskId,
    runId: run.execution.runId,
    mode,
    cwd,
    base,
    head,
    observedHead: before.head,
    observedAt: Date.now(),
    snapshot,
    stale: before.head !== reference.head || before.branch !== reference.branch,
    filtersDisabled: git.filtersDisabled,
    historicalDirtyUnavailable: true,
    limited: false,
    files,
    path: raw.path as string | undefined,
    patch,
    truncated,
  };
}
export function diffReply(store: AgentStateStore, raw: Record<string, unknown>) {
  const requestId =
    typeof raw.requestId === 'string' && raw.requestId.length <= 200 ? raw.requestId : '';
  try {
    if (!requestId) fail('DIFF_QUERY_INVALID');
    return { type: 'opaDiffState' as const, requestId, result: diffSnapshot(store, raw) };
  } catch (e) {
    return {
      type: 'opaDiffState' as const,
      requestId,
      error: e instanceof Error ? e.message : 'DIFF_UNAVAILABLE',
    };
  }
}
