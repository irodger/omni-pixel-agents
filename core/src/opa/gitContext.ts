/** An observation, never authority to create, clean, commit or merge. */
export interface OpaGitContext {
  version: 1;
  observedAt: number;
  cwd: string;
  state: 'available' | 'not-git' | 'unavailable' | 'unstable';
  root?: string;
  commonDir?: string;
  gitDir?: string;
  head?: string;
  branch?: string;
  detached?: boolean;
  dirty?: boolean;
  filtersDisabled?: boolean;
  conflicted?: boolean;
  submodule?: boolean;
}
export function isGitContext(value: unknown): value is OpaGitContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const path = (k: string) => typeof v[k] === 'string' && !!v[k] && (v[k] as string).length <= 8192;
  return (
    v.version === 1 &&
    Number.isSafeInteger(v.observedAt) &&
    Number(v.observedAt) >= 0 &&
    path('cwd') &&
    typeof v.state === 'string' &&
    ['available', 'not-git', 'unavailable', 'unstable'].includes(v.state) &&
    ['root', 'commonDir', 'gitDir', 'branch'].every((k) => v[k] === undefined || path(k)) &&
    (v.head === undefined ||
      (typeof v.head === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.head))) &&
    ['detached', 'dirty', 'conflicted', 'submodule', 'filtersDisabled'].every(
      (k) => v[k] === undefined || typeof v[k] === 'boolean',
    ) &&
    (v.state !== 'available' ||
      (path('root') &&
        path('commonDir') &&
        path('gitDir') &&
        (typeof v.dirty === 'boolean' || v.filtersDisabled === true) &&
        typeof v.conflicted === 'boolean' &&
        typeof v.detached === 'boolean'))
  );
}
