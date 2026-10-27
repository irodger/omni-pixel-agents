/** Host-owned local commands. Repository content never configures these implicitly. */
export interface QualityProfile {
  id: string;
  name: string;
  executable: string;
  args: string[];
  timeoutMs: number;
}
export interface QualityConfig {
  projectPath: string;
  revision: number;
  checks: QualityProfile[];
}
export interface QualityPlan {
  id: string;
  expiresAt: number;
  projectPath: string;
  taskId: string;
  runId: string;
  cwd: string;
  repoId: string;
  base: string;
  head: string;
  fingerprint: string;
  program: string;
  configDigest: string;
  check: QualityProfile;
}
export interface QualityRun extends QualityPlan {
  checkRunId: string;
  state: 'running' | 'passed' | 'failed' | 'unknown' | 'skipped';
  reason?: string;
  startedAt: number;
  spawnedAt?: number;
  finishedAt?: number;
  exitCode?: number;
  signal?: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
  stale?: boolean;
  /** Exit zero alone is never evidence of test execution or a test count. */
  tests: 'unreported';
}
export interface QualityData {
  version: 1;
  configs: QualityConfig[];
  runs: QualityRun[];
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, n = 8192): v is string =>
  typeof v === 'string' && !!v && v.length <= n && !v.includes('\0');
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function isQualityProfile(v: unknown): v is QualityProfile {
  return (
    obj(v) &&
    text(v.id, 200) &&
    text(v.name, 200) &&
    text(v.executable) &&
    Array.isArray(v.args) &&
    v.args.length <= 100 &&
    v.args.reduce((n: number, a: unknown) => n + (typeof a === 'string' ? a.length : 0), 0) <=
      16384 &&
    v.args.every((a) => typeof a === 'string' && a.length <= 8192 && !a.includes('\0')) &&
    count(v.timeoutMs) &&
    v.timeoutMs >= 100 &&
    v.timeoutMs <= 600000
  );
}
export function isQualityPlan(v: unknown): v is QualityPlan {
  return (
    obj(v) &&
    text(v.id, 200) &&
    count(v.expiresAt) &&
    text(v.projectPath) &&
    text(v.taskId, 200) &&
    text(v.runId, 200) &&
    text(v.cwd) &&
    text(v.repoId) &&
    text(v.base, 64) &&
    text(v.head, 64) &&
    hash(v.fingerprint) &&
    text(v.program, 128) &&
    hash(v.configDigest) &&
    isQualityProfile(v.check)
  );
}
export function isQualityRun(v: unknown): v is QualityRun {
  return (
    isQualityPlan(v) &&
    obj(v) &&
    text(v.checkRunId, 200) &&
    ['running', 'passed', 'failed', 'unknown', 'skipped'].includes(String(v.state)) &&
    count(v.startedAt) &&
    (v.spawnedAt === undefined || count(v.spawnedAt)) &&
    (v.finishedAt === undefined || count(v.finishedAt)) &&
    (v.exitCode === undefined || Number.isSafeInteger(v.exitCode)) &&
    (v.reason === undefined || text(v.reason, 500)) &&
    (v.signal === undefined || text(v.signal, 100)) &&
    typeof v.stdout === 'string' &&
    v.stdout.length <= 8192 &&
    typeof v.stderr === 'string' &&
    v.stderr.length <= 8192 &&
    typeof v.truncated === 'boolean' &&
    (v.stale === undefined || typeof v.stale === 'boolean') &&
    v.tests === 'unreported' &&
    (v.state !== 'passed' || (v.exitCode === 0 && count(v.spawnedAt) && count(v.finishedAt)))
  );
}
export function isQualityData(v: unknown): v is QualityData {
  return (
    obj(v) &&
    v.version === 1 &&
    Array.isArray(v.configs) &&
    v.configs.length <= 100 &&
    v.configs.every(
      (c) =>
        obj(c) &&
        text(c.projectPath) &&
        count(c.revision) &&
        Array.isArray(c.checks) &&
        c.checks.length <= 20 &&
        c.checks.every(isQualityProfile) &&
        new Set(c.checks.map((p) => p.id)).size === c.checks.length,
    ) &&
    new Set(v.configs.map((c) => c.projectPath)).size === v.configs.length &&
    Array.isArray(v.runs) &&
    v.runs.length <= 200 &&
    v.runs.every(isQualityRun) &&
    new Set(v.runs.map((r) => r.checkRunId)).size === v.runs.length
  );
}
