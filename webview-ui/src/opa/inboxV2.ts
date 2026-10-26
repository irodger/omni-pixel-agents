import type { OpaAttentionItem, OpaAttentionSnapshot } from '../../../core/src/opa/attention.js';
import { isAttentionFact } from '../../../core/src/opa/attention.js';
import type { CampusRoute } from './deepLinks.js';
import type { InboxItem } from './inbox.js';
import { type InboxPreferences, inboxPresentation } from './inboxPreferences.js';

export function isAttentionSnapshot(value: unknown): value is OpaAttentionSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as OpaAttentionSnapshot;
  return (
    v.version === 1 &&
    typeof v.hostId === 'string' &&
    !!v.hostId &&
    v.hostId.length <= 200 &&
    Array.isArray(v.items) &&
    v.items.length <= 2000 &&
    v.items.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        isAttentionFact(item.fact) &&
        ['recorded', 'current', 'resolved', 'stale'].includes(item.activity) &&
        (item.relatedIds === undefined ||
          (Array.isArray(item.relatedIds) &&
            item.relatedIds.length <= 16 &&
            item.relatedIds.every((id) => typeof id === 'string' && id.length <= 16384))),
    ) &&
    new Set(v.items.map((i) => i.fact.id)).size === v.items.length &&
    typeof v.limited === 'boolean' &&
    Number.isSafeInteger(v.droppedFacts) &&
    v.droppedFacts >= 0 &&
    Number.isSafeInteger(v.droppedEventsThrough) &&
    v.droppedEventsThrough >= 0
  );
}
export function attentionRoute(item: OpaAttentionItem): CampusRoute {
  const f = item.fact;
  // Recorded permission facts navigate to a saved attempt, never directly to an approval form.
  if (f.taskId)
    return {
      view: 'tasks',
      project: f.projectPath,
      task: f.taskId,
      run: f.kind === 'queue-error' ? undefined : f.runId,
    };
  if (f.eventOrdinal)
    return { view: 'timeline', project: f.projectPath, event: String(f.eventOrdinal) };
  if (f.provider && f.sessionId && f.agentId)
    return {
      view: 'overview',
      project: f.projectPath,
      provider: f.provider,
      session: f.sessionId,
      agent: f.agentId,
    };
  return { view: 'overview', project: f.projectPath };
}
export function activeInboxItems(
  items: OpaAttentionItem[],
  preferences: InboxPreferences,
  now: number,
): InboxItem[] {
  return items
    .filter((item) => inboxPresentation(item, preferences, now).active)
    .map((item) => ({
      id: item.fact.id,
      project: item.fact.projectPath,
      title: item.fact.title,
      kind:
        item.fact.kind === 'blocked'
          ? 'blocked'
          : ['error', 'queue-error'].includes(item.fact.kind)
            ? 'error'
            : 'result',
      state: item.fact.state,
      since: item.fact.observedAt,
      readId:
        item.fact.kind === 'blocked' && item.activity === 'current' ? undefined : item.fact.id,
      route: attentionRoute(item),
    }));
}
