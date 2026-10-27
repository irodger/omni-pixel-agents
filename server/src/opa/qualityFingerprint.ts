import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { observeGitContext } from './gitContext.js';

const fail = (): never => {
  throw new Error('QUALITY_SNAPSHOT_UNAVAILABLE');
};
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}
/** Bounded full bytes, no clean filters, textconv, shell or symlink traversal. */
export function fileDigest(path: string, limit = 256 * 1024 * 1024): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit) fail();
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(65536);
    let bytes = 0,
      n: number;
    while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += n;
      if (bytes > limit) fail();
      hash.update(buffer.subarray(0, n));
    }
    const after = fstatSync(fd);
    if (
      before.size !== bytes ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      fail();
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}
export function qualityFingerprint(cwd: string) {
  const context = observeGitContext(cwd);
  if (context.state !== 'available' || !context.root || !context.commonDir || !context.head) fail();
  const root = context.root!,
    hash = createHash('sha256');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  );
  env.GIT_OPTIONAL_LOCKS = '0';
  const git = (...args: string[]) => {
    const r = spawnSync(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        ...args,
      ],
      {
        cwd: root,
        env,
        encoding: 'utf8',
        shell: false,
        timeout: 2000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    );
    if (r.error || r.status !== 0 || r.stdout.includes('\ufffd')) fail();
    return r.stdout;
  };
  const index = git('ls-files', '--stage', '-z');
  const names = git('ls-files', '--cached', '--others', '--exclude-standard', '-z');
  const paths = [...new Set(names.split('\0').filter(Boolean))].sort();
  if (paths.length > 2048) fail();
  const stamp = (c: typeof context) =>
    JSON.stringify([c.cwd, c.root, c.commonDir, c.gitDir, c.head, c.branch]);
  hash.update(stamp(context));
  hash.update(index);
  let total = 0;
  const deadline = Date.now() + 5000;
  for (const path of paths) {
    if (
      isAbsolute(path) ||
      path.includes('\\') ||
      path.split('/').some((p) => p === '..' || p === '.') ||
      Date.now() > deadline
    )
      fail();
    const full = join(root, path);
    hash.update(JSON.stringify(path));
    let stat;
    try {
      stat = lstatSync(full);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        hash.update('missing');
        continue;
      }
      throw e;
    }
    if (!inside(root, realpathSync(dirname(full)))) fail();
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update('symlink:' + readlinkSync(full));
    else if (stat.isFile()) {
      total += stat.size;
      if (total > 128 * 1024 * 1024) fail();
      hash.update(fileDigest(full, 32 * 1024 * 1024));
    } else fail(); // Submodules/special files require a separate evidence model.
  }
  const after = observeGitContext(cwd);
  if (
    after.state !== 'available' ||
    stamp(after) !== stamp(context) ||
    git('ls-files', '--stage', '-z') !== index ||
    git('ls-files', '--cached', '--others', '--exclude-standard', '-z') !== names
  )
    fail();
  return { context, fingerprint: hash.digest('hex') };
}
