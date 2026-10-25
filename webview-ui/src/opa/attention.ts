import type { OpaAgentSnapshot, OpaProjectSnapshot } from '../../../core/src/messages.js';
import type { Language } from '../i18n/catalog.js';
import { translate } from '../i18n/catalog.js';

export const ATTENTION_DELAY_MS = 120_000;
export const MAX_SEEN_EVENTS = 2000;
export type SeenEvents = string[];

export function needsAttention(agent: OpaAgentSnapshot, seen: SeenEvents): boolean {
  return (
    agent.status === 'blocked' ||
    ((agent.status === 'done' || agent.status === 'error') &&
      !!agent.attentionId &&
      !seen.includes(agent.attentionId))
  );
}

export function markSeen(seen: SeenEvents, agent: OpaAgentSnapshot): SeenEvents {
  return agent.attentionId
    ? [...seen.filter((id) => id !== agent.attentionId), agent.attentionId].slice(-MAX_SEEN_EVENTS)
    : seen;
}

export function attentionRows(projects: OpaProjectSnapshot[], seen: SeenEvents) {
  return projects
    .flatMap((project) =>
      project.agents
        .filter((agent) => needsAttention(agent, seen))
        .map((agent) => ({ project, agent })),
    )
    .sort((a, b) => {
      const priority = (a: OpaAgentSnapshot) =>
        a.status === 'blocked' ? 0 : a.status === 'error' ? 1 : 2;
      return (
        priority(a.agent) - priority(b.agent) ||
        (a.agent.blockedSince ?? a.agent.completedAt ?? 0) -
          (b.agent.blockedSince ?? b.agent.completedAt ?? 0)
      );
    });
}

export function waitingLabel(
  since: number | undefined,
  now: number,
  language: Language = 'en',
): string {
  if (since === undefined) return translate('Waiting for permission', language);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return seconds < 60
    ? translate('Waiting {value}s', language, { value: seconds })
    : seconds < 3600
      ? translate('Waiting {value}m', language, { value: Math.floor(seconds / 60) })
      : translate('Waiting {value}h', language, { value: Math.floor(seconds / 3600) });
}
