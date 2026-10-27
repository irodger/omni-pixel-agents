export interface OpaWorktreeBinding {
  version: 1;
  cwd: string;
  sourceCwd: string;
  sourceRoot: string;
  commonDir: string;
  gitDir: string;
  baseCommit: string;
  branch?: string;
  created: boolean;
}
export interface OpaWorktreeCommand {
  requestId: string;
  projectPath: string;
  taskId: string;
  expectedRevision: number;
  action: 'create' | 'attach' | 'detach';
  path?: string;
  branch?: string;
  expectedHead?: string;
}
export const gitCommitId = (v: unknown): v is string =>
  typeof v === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
export function isWorktreeBinding(v: unknown): v is OpaWorktreeBinding {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.created === 'boolean' &&
    gitCommitId(r.baseCommit) &&
    ['cwd', 'sourceCwd', 'sourceRoot', 'commonDir', 'gitDir'].every(
      (k) =>
        typeof r[k] === 'string' &&
        !!r[k] &&
        (r[k] as string).length <= 8192 &&
        !(r[k] as string).includes('\0'),
    ) &&
    (r.branch === undefined ||
      (typeof r.branch === 'string' && r.branch.length > 0 && r.branch.length <= 512))
  );
}
