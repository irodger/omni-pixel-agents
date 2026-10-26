import type { OpaEvent } from '../../../core/src/opa/events.js';
import { isOpaEvent } from '../../../core/src/opa/events.js';
import type {
  OpaEventHistory,
  OpaHistoryEntry,
  OpaHistoryPage,
} from '../../../core/src/opa/history.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';

export class HistoryError extends Error {}
export const HISTORY_LIMITS = {
  events: 2000,
  bytes: 4 * 1024 * 1024,
  streams: 4096,
  entryBytes: 32768,
};
export type HistoryContext = Pick<OpaHistoryEntry, 'origin' | 'taskId' | 'runId'>;
const states = new WeakMap<AgentStateStore, OpaEventHistory>();
const sessionKey = (e: OpaEvent) => JSON.stringify([e.provider, e.sessionId, e.agentId]);
const streamKey = (e: OpaEvent) => JSON.stringify([e.provider, e.sessionId, e.agentId, e.streamId]);
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const text = (v: unknown, max = 8192): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function state(store: AgentStateStore): OpaEventHistory {
  let data = states.get(store);
  if (data) return data;
  let raw: OpaEventHistory | undefined;
  try {
    raw = store.getAdapter()?.loadOpaHistory?.();
  } catch {
    throw new HistoryError('EVENT_HISTORY_STORAGE_FAILED');
  }
  if (raw === undefined)
    data = {
      version: 1,
      nextOrdinal: 1,
      droppedThrough: 0,
      entries: [],
      streams: {},
      projects: {},
    };
  else {
    if (!object(raw) || raw.version !== 1) throw new HistoryError('EVENT_HISTORY_VERSION');
    if (
      !count(raw.nextOrdinal) ||
      !count(raw.droppedThrough) ||
      raw.nextOrdinal < 1 ||
      raw.droppedThrough >= raw.nextOrdinal ||
      !Array.isArray(raw.entries) ||
      !object(raw.streams) ||
      !object(raw.projects) ||
      Object.values(raw.streams).some((n) => !count(n)) ||
      Object.values(raw.projects).some((p) => !text(p)) ||
      raw.entries.length > HISTORY_LIMITS.events ||
      Object.keys(raw.streams).length > HISTORY_LIMITS.streams ||
      Object.keys(raw.projects).length > HISTORY_LIMITS.streams ||
      Buffer.byteLength(JSON.stringify(raw.entries)) > HISTORY_LIMITS.bytes
    )
      throw new HistoryError('EVENT_HISTORY_INVALID');
    let previous = raw.droppedThrough;
    for (const entry of raw.entries) {
      if (
        !object(entry) ||
        !count(entry.ordinal) ||
        entry.ordinal !== previous + 1 ||
        entry.ordinal >= raw.nextOrdinal ||
        !count(entry.observedAt) ||
        !text(entry.projectPath) ||
        !['ingestion', 'task-journal', 'fixture'].includes(entry.origin as string) ||
        !isOpaEvent(entry.event)
      )
        throw new HistoryError('EVENT_HISTORY_INVALID');
      if (
        raw.streams[streamKey(entry.event)] === undefined ||
        raw.streams[streamKey(entry.event)] < entry.event.sequence ||
        Buffer.byteLength(JSON.stringify(entry)) > HISTORY_LIMITS.entryBytes
      )
        throw new HistoryError('EVENT_HISTORY_INVALID');
      previous = entry.ordinal;
    }
    if (previous !== raw.nextOrdinal - 1) throw new HistoryError('EVENT_HISTORY_INVALID');
    data = structuredClone(raw) as unknown as OpaEventHistory;
  }
  states.set(store, data);
  return data;
}
/** Keep the existing OPA envelope; only explicitly retained payload fields enter the index. */
function retainedEvent(event: OpaEvent): { event: OpaEvent; truncatedFields?: string[] } {
  const fields = [
    'specVersion',
    'id',
    'streamId',
    'timestamp',
    'provider',
    'sessionId',
    'agentId',
    'sequence',
    'type',
  ];
  const payload: Record<string, string[]> = {
    'session.started': ['cwd', 'name', 'role', 'parentAgentId'],
    'task.upserted': ['cwd', 'taskId', 'title', 'status', 'assignee'],
    'usage.reported': ['usage'],
    'tool.started': ['toolId', 'name', 'activity'],
    'tool.completed': ['toolId', 'failed'],
    'turn.failed': ['message'],
    message: ['role', 'text'],
  };
  const raw = event as unknown as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const truncatedFields: string[] = [];
  for (const key of [...fields, ...(payload[event.type] ?? [])])
    if (raw[key] !== undefined) output[key] = structuredClone(raw[key]);
  for (const key of ['text', 'message', 'name', 'role', 'title'])
    if (typeof output[key] === 'string' && (output[key] as string).length > 4096) {
      output[key] = (output[key] as string).slice(0, 4096);
      truncatedFields.push(key);
    }
  if (output.usage) {
    const usage: Record<string, unknown> = {};
    for (const key of [
      'usageId',
      'projectPath',
      'provider',
      'sessionId',
      'timestamp',
      'model',
      'inputTokens',
      'outputTokens',
      'cachedInputTokens',
      'cacheWriteTokens',
      'reasoningTokens',
      'cost',
    ])
      if (
        event.type === 'usage.reported' &&
        event.usage[key as keyof typeof event.usage] !== undefined
      )
        usage[key] = structuredClone(event.usage[key as keyof typeof event.usage]);
    if (object(usage.cost))
      usage.cost = {
        amount: usage.cost.amount,
        currency: usage.cost.currency,
        kind: usage.cost.kind,
      };
    output.usage = usage;
  }
  return { event: output as OpaEvent, ...(truncatedFields.length ? { truncatedFields } : {}) };
}
/** Synchronous single-host commit before projection. No command API is reachable from here. */
export function recordHistory(
  store: AgentStateStore,
  event: OpaEvent,
  context: HistoryContext = { origin: 'ingestion' },
  now = Date.now(),
  limits = HISTORY_LIMITS,
): boolean {
  if (
    !isOpaEvent(event) ||
    ![event.id, event.streamId, event.provider, event.sessionId, event.agentId].every((s) =>
      text(s, 256),
    )
  )
    throw new HistoryError('EVENT_HISTORY_EVENT_INVALID');
  if (
    !count(now) ||
    !['ingestion', 'task-journal', 'fixture'].includes(context.origin) ||
    [context.taskId, context.runId].some((v) => v !== undefined && !text(v, 200))
  )
    throw new HistoryError('EVENT_HISTORY_EVENT_INVALID');
  const data = state(store);
  if (!Number.isSafeInteger(data.nextOrdinal + 1)) throw new HistoryError('EVENT_HISTORY_CAPACITY');
  const key = streamKey(event);
  if (event.sequence <= (data.streams[key] ?? -1)) return false;
  if (!(key in data.streams) && Object.keys(data.streams).length >= limits.streams)
    throw new HistoryError('EVENT_HISTORY_CAPACITY');
  const normalized = retainedEvent(event);
  const duplicate = data.entries.find(
    (entry) => entry.event.id === event.id && sessionKey(entry.event) === sessionKey(event),
  );
  if (duplicate) throw new HistoryError('EVENT_HISTORY_ID_CONFLICT');
  const session = sessionKey(event);
  const project =
    event.type === 'session.started' || event.type === 'task.upserted'
      ? toPathKey(event.cwd)
      : event.type === 'usage.reported'
        ? toPathKey(event.usage.projectPath)
        : data.projects[session];
  if (!project || !text(project)) throw new HistoryError('EVENT_HISTORY_SESSION_REQUIRED');
  if (
    event.type === 'session.started' &&
    data.projects[session] &&
    data.projects[session] !== project
  )
    throw new HistoryError('EVENT_HISTORY_PROJECT_CONFLICT');
  const entry: OpaHistoryEntry = {
    ordinal: data.nextOrdinal,
    observedAt: now,
    projectPath: project,
    ...context,
    ...normalized,
  };
  if (Buffer.byteLength(JSON.stringify(entry)) > limits.entryBytes)
    throw new HistoryError('EVENT_HISTORY_EVENT_TOO_LARGE');
  const next: OpaEventHistory = {
    ...data,
    nextOrdinal: data.nextOrdinal + 1,
    entries: [...data.entries, entry],
    streams: { ...data.streams, [key]: event.sequence },
    projects:
      event.type === 'session.started' ? { ...data.projects, [session]: project } : data.projects,
  };
  while (
    next.entries.length > 0 &&
    (next.entries.length > limits.events ||
      Buffer.byteLength(JSON.stringify(next.entries)) > limits.bytes)
  )
    next.droppedThrough = next.entries.shift()!.ordinal;
  try {
    store.getAdapter()?.saveOpaHistory?.(next);
  } catch {
    throw new HistoryError('EVENT_HISTORY_STORAGE_FAILED');
  }
  states.set(store, next);
  return true;
}
export function historyPage(store: AgentStateStore, raw: Record<string, unknown>): OpaHistoryPage {
  if (
    !text(raw.projectPath) ||
    (raw.limit !== undefined && (!count(raw.limit) || raw.limit < 1 || raw.limit > 50)) ||
    (raw.before !== undefined && (!count(raw.before) || raw.before < 1)) ||
    ['taskId', 'runId', 'provider', 'sessionId', 'eventType'].some(
      (k) => raw[k] !== undefined && !text(raw[k], 256),
    )
  )
    throw new HistoryError('EVENT_HISTORY_QUERY_INVALID');
  const data = state(store);
  if (raw.before !== undefined && raw.before > data.nextOrdinal)
    throw new HistoryError('EVENT_HISTORY_QUERY_INVALID');
  if (raw.before !== undefined && (raw.before as number) <= data.droppedThrough)
    throw new HistoryError('EVENT_HISTORY_CURSOR_EXPIRED');
  const project = toPathKey(raw.projectPath);
  const matching = data.entries
    .filter(
      (entry) =>
        entry.projectPath === project &&
        (raw.before === undefined || entry.ordinal < (raw.before as number)) &&
        (raw.taskId === undefined ||
          entry.taskId === raw.taskId ||
          (entry.event.type === 'task.upserted' && entry.event.taskId === raw.taskId)) &&
        (raw.runId === undefined || entry.runId === raw.runId) &&
        (raw.provider === undefined || entry.event.provider === raw.provider) &&
        (raw.sessionId === undefined || entry.event.sessionId === raw.sessionId) &&
        (raw.eventType === undefined || entry.event.type === raw.eventType),
    )
    .reverse();
  const entries = matching.slice(0, (raw.limit as number | undefined) ?? 20);
  return {
    entries: structuredClone(entries),
    nextCursor: matching.length > entries.length ? entries.at(-1)!.ordinal : undefined,
    droppedThrough: data.droppedThrough,
  };
}
export function historyJsonl(page: OpaHistoryPage): string {
  return (
    [...page.entries]
      .reverse()
      .map(({ event, ...metadata }) =>
        JSON.stringify({
          ...event,
          opaHistory: metadata,
          opaHistoryDroppedThrough: page.droppedThrough,
        }),
      )
      .join('\n') + (page.entries.length ? '\n' : '')
  );
}
export function historyReply(store: AgentStateStore, raw: Record<string, unknown>) {
  const requestId = text(raw.requestId, 200) ? raw.requestId : '';
  try {
    if (!requestId) throw new HistoryError('EVENT_HISTORY_QUERY_INVALID');
    return { type: 'opaEventHistoryPage' as const, requestId, ...historyPage(store, raw) };
  } catch (error) {
    return {
      type: 'opaEventHistoryPage' as const,
      requestId,
      entries: [],
      error: error instanceof HistoryError ? error.message : 'EVENT_HISTORY_QUERY_INVALID',
    };
  }
}

/** Passive bounded metadata source for attention reconciliation. */
export function attentionHistoryInputs(store: AgentStateStore) {
  const data = state(store);
  return { entries: structuredClone(data.entries), droppedThrough: data.droppedThrough };
}
