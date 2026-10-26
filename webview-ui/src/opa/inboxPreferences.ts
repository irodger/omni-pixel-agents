import type { OpaAttentionItem, OpaAttentionSnapshot } from '../../../core/src/opa/attention.js';

export type InboxMark = { id: string; read?: boolean; dismissed?: boolean; snoozedUntil?: number };
export type InboxPreferences = { version: 1; marks: InboxMark[] };
export const emptyPreferences = (): InboxPreferences => ({ version: 1, marks: [] });
export const inboxStorageKey = (hostId: string) => 'opa.inbox.v2:' + hostId;
export function parsePreferences(raw: string | null): InboxPreferences {
  if (!raw) return emptyPreferences();
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('marks' in value) ||
    !Array.isArray(value.marks) ||
    value.marks.length > 2000
  )
    throw Error('INBOX_PREFERENCES_INVALID');
  const marks: InboxMark[] = [];
  for (const mark of value.marks) {
    if (
      !mark ||
      typeof mark !== 'object' ||
      typeof mark.id !== 'string' ||
      !mark.id ||
      mark.id.length > 16384 ||
      (mark.read !== undefined && typeof mark.read !== 'boolean') ||
      (mark.dismissed !== undefined && typeof mark.dismissed !== 'boolean') ||
      (mark.snoozedUntil !== undefined &&
        (!Number.isSafeInteger(mark.snoozedUntil) ||
          mark.snoozedUntil < 0 ||
          !Number.isFinite(new Date(mark.snoozedUntil).getTime())))
    )
      throw Error('INBOX_PREFERENCES_INVALID');
    marks.push({
      id: mark.id,
      read: mark.read,
      dismissed: mark.dismissed,
      snoozedUntil: mark.snoozedUntil,
    });
  }
  if (new Set(marks.map((mark) => mark.id)).size !== marks.length)
    throw Error('INBOX_PREFERENCES_INVALID');
  return { version: 1, marks };
}
export type InboxPresentationAction = 'read' | 'dismiss' | 'snooze' | 'restore';
export function updateInboxMark(
  preferences: InboxPreferences,
  item: OpaAttentionItem,
  action: InboxPresentationAction,
  now: number,
): InboxPreferences {
  if (
    item.fact.kind === 'blocked' &&
    item.activity === 'current' &&
    ['read', 'dismiss'].includes(action)
  )
    throw Error('INBOX_BLOCK_ACTIVE');
  const current = preferences.marks.find((mark) => mark.id === item.fact.id) ?? {
    id: item.fact.id,
  };
  const mark: InboxMark =
    action === 'restore'
      ? { id: current.id }
      : action === 'read'
        ? { ...current, read: true }
        : action === 'dismiss'
          ? { ...current, dismissed: true }
          : { ...current, snoozedUntil: now + 10 * 60 * 1000 };
  return {
    version: 1,
    marks: [...preferences.marks.filter((entry) => entry.id !== mark.id), mark].slice(-2000),
  };
}
export function inboxPresentation(
  item: OpaAttentionItem,
  preferences: InboxPreferences,
  now: number,
) {
  const mark = preferences.marks.find((entry) => entry.id === item.fact.id);
  const read = item.activity === 'current' && item.fact.kind === 'blocked' ? false : !!mark?.read;
  const dismissed =
    item.activity === 'current' && item.fact.kind === 'blocked' ? false : !!mark?.dismissed;
  const snoozed = !!mark?.snoozedUntil && mark.snoozedUntil > now;
  return {
    read,
    dismissed,
    snoozed,
    snoozedUntil: snoozed ? mark!.snoozedUntil : undefined,
    active:
      !read &&
      !dismissed &&
      !snoozed &&
      (item.fact.kind !== 'blocked' || item.activity === 'current'),
  };
}

export function matchingInboxItem(
  snapshot: OpaAttentionSnapshot | undefined,
  id: string,
  hostId: string,
  activity: string,
): OpaAttentionItem {
  const item = snapshot?.items.find((item) => item.fact.id === id);
  if (!snapshot || snapshot.hostId !== hostId || !item || item.activity !== activity)
    throw Error('INBOX_ITEM_STALE');
  return item;
}
