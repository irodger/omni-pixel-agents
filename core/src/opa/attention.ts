/** Immutable metadata only: no raw tool arguments, permission choices, callbacks or execution commands. */
export interface OpaAttentionFact {
  id: string;
  projectPath: string;
  kind: 'blocked' | 'error' | 'result' | 'queue-error' | 'resolution' | 'check';
  title: string;
  titleFromLegacyTask?: boolean;
  state: string;
  origin:
    'task-run' | 'task-permission' | 'queue' | 'ingestion' | 'task-journal' | 'fixture' | 'live';
  observedAt?: number;
  sourceTime?: string;
  taskId?: string;
  runId?: string;
  permissionId?: string;
  provider?: string;
  sessionId?: string;
  agentId?: string;
  streamId?: string;
  eventId?: string;
  eventOrdinal?: number;
  relatedFactId?: string;
  code?: string;
}
export interface OpaAttentionItem {
  fact: OpaAttentionFact;
  activity: 'recorded' | 'current' | 'resolved' | 'stale';
  relatedIds?: string[];
}
export interface OpaAttentionSnapshot {
  version: 1;
  hostId: string;
  items: OpaAttentionItem[];
  limited: boolean;
  droppedFacts: number;
  droppedEventsThrough: number;
}
export const attentionFactId = (...parts: string[]) => 'opa:attention:' + JSON.stringify(parts);
export function isAttentionFact(value: unknown): value is OpaAttentionFact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const text = (key: string, max: number) =>
    typeof v[key] === 'string' && (v[key] as string).length > 0 && (v[key] as string).length <= max;
  return (
    text('id', 16384) &&
    text('projectPath', 8192) &&
    text('title', 500) &&
    (v.titleFromLegacyTask === undefined || typeof v.titleFromLegacyTask === 'boolean') &&
    text('state', 100) &&
    typeof v.kind === 'string' &&
    ['blocked', 'error', 'result', 'queue-error', 'resolution', 'check'].includes(v.kind) &&
    [
      'task-run',
      'task-permission',
      'queue',
      'ingestion',
      'task-journal',
      'fixture',
      'live',
    ].includes(typeof v.origin === 'string' ? v.origin : '') &&
    (v.observedAt === undefined ||
      (Number.isSafeInteger(v.observedAt) &&
        Number(v.observedAt) >= 0 &&
        Number.isFinite(new Date(Number(v.observedAt)).getTime()))) &&
    (v.eventOrdinal === undefined ||
      (Number.isSafeInteger(v.eventOrdinal) && Number(v.eventOrdinal) > 0)) &&
    (v.sourceTime === undefined ||
      (typeof v.sourceTime === 'string' && Number.isFinite(Date.parse(v.sourceTime)))) &&
    [
      'taskId',
      'runId',
      'permissionId',
      'provider',
      'sessionId',
      'agentId',
      'streamId',
      'eventId',
      'code',
      'relatedFactId',
    ].every((key) => v[key] === undefined || text(key, key === 'relatedFactId' ? 16384 : 512))
  );
}

/** PR11 producer contract only. PR8 does not execute checks or synthesize results. */
export type OpaCheckObservation = {
  checkId: string;
  projectPath: string;
  taskId: string;
  runId: string;
  worktreePath: string;
  headCommit: string;
  origin: 'process' | 'fixture';
  startedAt: number;
} & (
  | { state: 'passed'; finishedAt: number; exitCode: 0 }
  | { state: 'failed'; finishedAt: number; exitCode?: number; reason: string }
  | { state: 'skipped' | 'unknown' | 'stale'; finishedAt?: number; exitCode?: number }
);
