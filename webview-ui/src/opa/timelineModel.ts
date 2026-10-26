import type { OpaEventHistoryPage, OpaEventHistoryRequest } from '../../../core/src/messages.js';
import { isOpaEvent } from '../../../core/src/opa/events.js';
import type { OpaHistoryEntry } from '../../../core/src/opa/history.js';
import type { CampusRoute } from './deepLinks.js';

export function timelineQuery(
  route: CampusRoute,
  before?: number,
): Omit<OpaEventHistoryRequest, 'type' | 'requestId'> {
  return {
    projectPath: route.project!,
    taskId: route.task,
    runId: route.run,
    provider: route.provider,
    sessionId: route.session,
    eventType: route.eventType,
    before: before ?? (route.event ? Number(route.event) + 1 : undefined),
    limit: 20,
  };
}

/** Server ordinals are observation order, never a claim of causality across streams. */
export function mergeTimeline(
  current: OpaHistoryEntry[],
  page: OpaEventHistoryPage,
  project: string,
): OpaHistoryEntry[] {
  if (
    !Number.isSafeInteger(page.droppedThrough) ||
    page.droppedThrough! < 0 ||
    page.entries.length > 50 ||
    (page.nextCursor !== undefined &&
      (!Number.isSafeInteger(page.nextCursor) ||
        page.nextCursor < 1 ||
        !page.entries.length ||
        page.nextCursor !== page.entries.at(-1)?.ordinal)) ||
    page.entries.some(
      (e) =>
        e.projectPath !== project ||
        !Number.isSafeInteger(e.ordinal) ||
        e.ordinal < 1 ||
        !Number.isSafeInteger(e.observedAt) ||
        !Number.isFinite(new Date(e.observedAt).getTime()) ||
        !['fixture', 'ingestion', 'task-journal'].includes(e.origin) ||
        !isOpaEvent(e.event),
    )
  )
    throw new Error('EVENT_HISTORY_INVALID');
  const byOrdinal = new Map(current.map((e) => [e.ordinal, e]));
  for (const entry of page.entries) byOrdinal.set(entry.ordinal, entry as OpaHistoryEntry);
  return [...byOrdinal.values()].sort((a, b) => b.ordinal - a.ordinal).slice(0, 2000);
}

export function timelineTaskId(entry: OpaHistoryEntry): string | undefined {
  return entry.taskId ?? (entry.event.type === 'task.upserted' ? entry.event.taskId : undefined);
}
export function timelineExcerpt(entry: OpaHistoryEntry): string | undefined {
  const event = entry.event;
  switch (event.type) {
    case 'message':
      return event.text;
    case 'turn.failed':
      return event.message;
    case 'tool.started':
      return event.name;
    case 'task.upserted':
      return event.title;
    case 'session.started':
      return event.name;
    default:
      return undefined;
  }
}
export function timelineError(code: string): string {
  switch (code) {
    case 'EVENT_HISTORY_CURSOR_EXPIRED':
      return 'Older events were removed by retention. Refresh the timeline.';
    case 'EVENT_HISTORY_VERSION':
      return 'This host cannot read the saved event history version.';
    case 'EVENT_HISTORY_INVALID':
      return 'Event history could not be read. Stored data has been kept.';
    case 'EVENT_HISTORY_QUERY_INVALID':
      return 'This timeline link or cursor is unavailable on this host.';
    default:
      return 'Event history is unavailable. Check the connection and host storage.';
  }
}
