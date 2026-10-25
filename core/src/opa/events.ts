import type { OpaUsage, TaskStatus } from './work.js';
import { isUsage, taskStatuses } from './work.js';

/** OPA v0.2 adds durable usage/task observations; v0.1 remains readable. */
export type OpaData =
  | { type: 'usage.reported'; usage: OpaUsage }
  | {
      type: 'task.upserted';
      cwd: string;
      taskId: string;
      title: string;
      status: TaskStatus;
      assignee?: string;
    }
  | { type: 'session.started'; cwd: string; name?: string; role?: string; parentAgentId?: string }
  | { type: 'session.ended' }
  | { type: 'turn.started' }
  | { type: 'turn.completed' }
  | { type: 'turn.failed'; message: string }
  | { type: 'tool.started'; toolId: string; name: string; activity: 'read' | 'write' | 'execute' }
  | { type: 'tool.completed'; toolId: string; failed?: boolean }
  | { type: 'permission.requested' }
  | { type: 'permission.resolved' }
  | { type: 'message'; role: 'user' | 'assistant'; text: string };

export type OpaEvent = {
  specVersion: '0.1' | '0.2';
  id: string;
  streamId: string;
  timestamp: string;
  provider: string;
  sessionId: string;
  agentId: string;
  sequence: number;
} & OpaData;

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validate untrusted files and HTTP payloads at the same boundary. */
export function isOpaEvent(v: unknown): v is OpaEvent {
  if (!record(v) || !['0.1', '0.2'].includes(v.specVersion as string)) return false;
  if (!['id', 'streamId', 'provider', 'sessionId', 'agentId'].every((k) => nonempty(v[k])))
    return false;
  if (
    typeof v.timestamp !== 'string' ||
    !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v.timestamp) ||
    !Number.isFinite(Date.parse(v.timestamp))
  )
    return false;
  if (!Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0) return false;
  switch (v.type) {
    case 'usage.reported':
      return (
        v.specVersion === '0.2' &&
        isUsage(v.usage) &&
        v.usage.provider === v.provider &&
        v.usage.sessionId === v.sessionId &&
        v.usage.timestamp === v.timestamp
      );
    case 'task.upserted':
      return (
        v.specVersion === '0.2' &&
        nonempty(v.cwd) &&
        nonempty(v.taskId) &&
        v.taskId.trim().length > 0 &&
        v.taskId.length <= 200 &&
        nonempty(v.title) &&
        v.title.trim().length > 0 &&
        v.title.length <= 2000 &&
        taskStatuses.includes(v.status as TaskStatus) &&
        (v.assignee === undefined || (typeof v.assignee === 'string' && v.assignee.length <= 200))
      );
    case 'session.started':
      return (
        nonempty(v.cwd) &&
        ['name', 'role', 'parentAgentId'].every((k) => v[k] === undefined || nonempty(v[k]))
      );
    case 'tool.started':
      return (
        nonempty(v.toolId) &&
        nonempty(v.name) &&
        ['read', 'write', 'execute'].includes(v.activity as string)
      );
    case 'tool.completed':
      return nonempty(v.toolId) && (v.failed === undefined || typeof v.failed === 'boolean');
    case 'turn.failed':
      return typeof v.message === 'string';
    case 'message':
      return ['user', 'assistant'].includes(v.role as string) && typeof v.text === 'string';
    case 'session.ended':
    case 'turn.started':
    case 'turn.completed':
    case 'permission.requested':
    case 'permission.resolved':
      return true;
    default:
      return false;
  }
}
