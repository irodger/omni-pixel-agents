import type { PermissionRequest } from './adapters/types.js';

/** Durable project work; independent of any agent process or renderer. */
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export interface OpaTask {
  id: string;
  projectPath: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  execution?: {
    runId: string;
    executorId?: string;
    provider?: string;
    sessionId?: string;
    sourceAgentId?: string;
    usage?: OpaUsage[];
    outputTruncated?: boolean;
    state: string;
    journal: string;
    startedAt: number;
    finishedAt?: number;
    output?: string;
    error?: string;
    permissions?: PermissionRequest[];
  };
  createdAt: number;
  updatedAt: number;
  revision: number;
}
export interface OpaUsage {
  usageId: string;
  projectPath: string;
  provider: string;
  sessionId: string;
  timestamp: string;
  model?: string;
  /** Includes cache reads/writes. Output includes reasoning when reported. */
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Absence means unknown; never convert unknown cost to zero. */
  cost?: { amount: number; currency: 'USD'; kind: 'reported' | 'estimated' };
}
export interface OpaWorkData {
  tasks: OpaTask[];
  usage: OpaUsage[];
}
export type OpaTaskCommand = {
  requestId: string;
  projectPath: string;
  action: 'create' | 'update' | 'permission' | 'move';
  taskId?: string;
  title?: string;
  status?: TaskStatus;
  assignee?: string;
  expectedRevision?: number;
  launch?: boolean;
  runId?: string;
  permissionId?: string;
  optionId?: string;
};

export const taskStatuses: readonly TaskStatus[] = ['open', 'in_progress', 'done', 'cancelled'];
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
export const validCount = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0;
export function isUsage(v: unknown): v is OpaUsage {
  if (
    !record(v) ||
    !['usageId', 'projectPath', 'provider', 'sessionId'].every(
      (k) => typeof v[k] === 'string' && (v[k] as string).length > 0,
    )
  )
    return false;
  if (typeof v.timestamp !== 'string' || !Number.isFinite(Date.parse(v.timestamp))) return false;
  if (!validCount(v.inputTokens) || !validCount(v.outputTokens)) return false;
  if (
    !['cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens'].every(
      (k) => v[k] === undefined || validCount(v[k]),
    )
  )
    return false;
  if (
    ((v.cachedInputTokens as number) ?? 0) + ((v.cacheWriteTokens as number) ?? 0) >
      v.inputTokens ||
    ((v.reasoningTokens as number) ?? 0) > v.outputTokens
  )
    return false;
  if (v.model !== undefined && typeof v.model !== 'string') return false;
  if (v.cost !== undefined) {
    if (
      !record(v.cost) ||
      typeof v.cost.amount !== 'number' ||
      !Number.isFinite(v.cost.amount) ||
      v.cost.amount < 0 ||
      v.cost.currency !== 'USD' ||
      !['reported', 'estimated'].includes(v.cost.kind as string)
    )
      return false;
  }
  return true;
}
export function isTask(v: unknown): v is OpaTask {
  return (
    record(v) &&
    ['id', 'projectPath', 'title'].every(
      (k) => typeof v[k] === 'string' && (v[k] as string).trim().length > 0,
    ) &&
    taskStatuses.includes(v.status as TaskStatus) &&
    (v.assignee === undefined || typeof v.assignee === 'string') &&
    validCount(v.createdAt) &&
    validCount(v.updatedAt) &&
    Number.isSafeInteger(v.revision) &&
    (v.revision as number) > 0
  );
}
