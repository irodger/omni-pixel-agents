export interface OpaDiffFile {
  path: string;
  oldPath?: string;
  added?: number;
  deleted?: number;
  binary: boolean;
  untracked?: boolean;
  openPath?: string;
}
export interface OpaDiffSnapshot {
  version: 1;
  projectPath: string;
  taskId: string;
  runId: string;
  mode: 'committed' | 'working';
  cwd: string;
  base: string;
  head: string;
  observedHead: string;
  observedAt: number;
  snapshot: string;
  stale: boolean;
  filtersDisabled: boolean;
  historicalDirtyUnavailable: true;
  limited: boolean;
  files: OpaDiffFile[];
  path?: string;
  patch?: string;
  truncated?: boolean;
}
export function isDiffSnapshot(value: unknown): value is OpaDiffSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const text = (x: unknown, max: number) =>
    typeof x === 'string' && x.length > 0 && x.length <= max && !x.includes('\0');
  const sha = (x: unknown) => typeof x === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x);
  return (
    v.version === 1 &&
    ['projectPath', 'cwd'].every((k) => text(v[k], 8192)) &&
    ['taskId', 'runId'].every((k) => text(v[k], 200)) &&
    typeof v.mode === 'string' &&
    ['committed', 'working'].includes(v.mode) &&
    ['base', 'head', 'observedHead'].every((k) => sha(v[k])) &&
    Number.isSafeInteger(v.observedAt) &&
    Number(v.observedAt) >= 0 &&
    typeof v.snapshot === 'string' &&
    /^[a-f0-9]{64}$/.test(v.snapshot) &&
    ['stale', 'filtersDisabled', 'limited'].every((k) => typeof v[k] === 'boolean') &&
    v.historicalDirtyUnavailable === true &&
    (v.path === undefined || text(v.path, 8192)) &&
    (v.patch === undefined || (typeof v.patch === 'string' && v.patch.length <= 131072)) &&
    (v.truncated === undefined || typeof v.truncated === 'boolean') &&
    Array.isArray(v.files) &&
    v.files.length <= 200 &&
    new Set(v.files.map((f) => (f as OpaDiffFile)?.path)).size === v.files.length &&
    v.files.every((f) => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
      const r = f as Record<string, unknown>;
      return (
        text(r.path, 8192) &&
        ['oldPath', 'openPath'].every((k) => r[k] === undefined || text(r[k], 8192)) &&
        typeof r.binary === 'boolean' &&
        (r.untracked === undefined || typeof r.untracked === 'boolean') &&
        ['added', 'deleted'].every(
          (k) => r[k] === undefined || (Number.isSafeInteger(r[k]) && Number(r[k]) >= 0),
        )
      );
    })
  );
}
