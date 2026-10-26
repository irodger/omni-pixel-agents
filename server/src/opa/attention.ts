import {
  attentionFactId,
  type OpaAttentionFact,
  type OpaAttentionItem,
  type OpaAttentionSnapshot,
} from '../../../core/src/opa/attention.js';
import type { OpaHistoryEntry } from '../../../core/src/opa/history.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { opaCampusSnapshot } from './campus.js';
import { attentionHistoryInputs } from './history.js';
import { attentionWorkInputs } from './work.js';

const sourceId = (entry: OpaHistoryEntry) =>
  attentionFactId(
    'event',
    entry.projectPath,
    entry.event.provider,
    entry.event.sessionId,
    entry.event.agentId,
    entry.event.streamId,
    entry.event.id,
  );
const episode = (entry: OpaHistoryEntry) =>
  JSON.stringify([
    entry.projectPath,
    entry.event.provider,
    entry.event.sessionId,
    entry.event.agentId,
    entry.event.streamId,
    entry.taskId,
    entry.runId,
  ]);
const priority = (item: OpaAttentionItem) =>
  item.activity === 'current' && item.fact.kind === 'blocked'
    ? 0
    : ['error', 'queue-error'].includes(item.fact.kind)
      ? 1
      : 2;

/** A read model of durable facts and current liveness; never an execution/permission interface. */
export function attentionSnapshot(
  store: AgentStateStore,
  projectPath?: string,
): OpaAttentionSnapshot {
  const work = attentionWorkInputs(store);
  const history = attentionHistoryInputs(store);
  const tasks = work.tasks;
  const projects = opaCampusSnapshot(store).projects;
  const items: OpaAttentionItem[] = [];
  const resolutions = new Set(
    work.facts.filter((f) => f.kind === 'resolution').map((f) => f.relatedFactId),
  );
  for (const fact of work.facts) {
    if (fact.kind === 'resolution') continue;
    const task = tasks.find((t) => t.projectPath === fact.projectPath && t.id === fact.taskId);
    const current =
      fact.kind === 'blocked' &&
      !!task?.execution &&
      task.execution.runId === fact.runId &&
      task.execution.state === 'running' &&
      !!task.execution.permissions?.some((p) => p.id === fact.permissionId);
    items.push({
      fact,
      activity:
        fact.kind !== 'blocked'
          ? 'recorded'
          : resolutions.has(fact.id)
            ? 'resolved'
            : current
              ? 'current'
              : 'stale',
    });
  }
  // Retention must not silently erase a still-owned pending permission.
  for (const task of tasks)
    if (task.execution?.state === 'running')
      for (const permission of task.execution.permissions ?? []) {
        const id = attentionFactId(
          'permission',
          task.projectPath,
          task.id,
          task.execution.runId,
          permission.id,
        );
        if (!items.some((item) => item.fact.id === id))
          items.push({
            fact: {
              id,
              projectPath: task.projectPath,
              kind: 'blocked',
              title: permission.title || 'Permission requested',
              state: 'Needs permission',
              origin: 'live',
              taskId: task.id,
              runId: task.execution.runId,
              permissionId: permission.id,
            },
            activity: 'current',
          });
      }
  const correlation = (
    project: string,
    provider?: string,
    session?: string,
    agent?: string,
    event?: string,
  ) => JSON.stringify([project, provider, session, agent, event]);
  const source = (entry: OpaHistoryEntry) =>
    JSON.stringify([
      entry.projectPath,
      entry.event.provider,
      entry.event.sessionId,
      entry.event.agentId,
    ]);
  const eventLookup = new Map<string, OpaHistoryEntry[]>();
  const latestRequests = new Map<string, number>();
  for (const entry of history.entries) {
    const key = correlation(
      entry.projectPath,
      entry.event.provider,
      entry.event.sessionId,
      entry.event.agentId,
      entry.event.id,
    );
    const list = eventLookup.get(key) ?? [];
    list.push(entry);
    eventLookup.set(key, list);
    if (entry.event.type === 'permission.requested')
      latestRequests.set(source(entry), entry.ordinal);
  }
  const permissionState = new Map<string, { resolved: boolean; nextRequest: boolean }>();
  const future = new Map<string, { resolution?: number; request?: number }>();
  for (const entry of [...history.entries].reverse()) {
    const key = episode(entry);
    const next = future.get(key) ?? {};
    if (entry.event.type === 'permission.requested') {
      permissionState.set(sourceId(entry), {
        resolved:
          next.resolution !== undefined &&
          (next.request === undefined || next.resolution < next.request),
        nextRequest: next.request !== undefined,
      });
      next.request = entry.event.sequence;
    } else if (entry.event.type === 'permission.resolved') next.resolution = entry.event.sequence;
    future.set(key, next);
  }
  const related = new Map<string, string[]>();
  for (const run of work.runs) {
    const execution = run.execution;
    if (!['completed', 'failed', 'interrupted', 'cancelled'].includes(execution.state)) continue;
    const fact: OpaAttentionFact = {
      id: attentionFactId('run', run.projectPath, run.taskId, execution.runId, execution.state),
      projectPath: run.projectPath,
      kind: ['failed', 'interrupted'].includes(execution.state) ? 'error' : 'result',
      title: run.titleFromLegacyTask ? 'Unknown attempt title' : run.title.slice(0, 500),
      state: execution.state,
      titleFromLegacyTask: run.titleFromLegacyTask,
      origin: 'task-run',
      observedAt: execution.finishedAt,
      taskId: run.taskId,
      runId: execution.runId,
      provider: execution.provider,
      sessionId: execution.sessionId,
      agentId: execution.sourceAgentId,
      eventId: execution.resultEventId,
    };
    const matches = (
      eventLookup.get(
        correlation(
          run.projectPath,
          execution.provider,
          execution.sessionId,
          execution.sourceAgentId,
          execution.resultEventId,
        ),
      ) ?? []
    ).filter(
      (entry) =>
        (!entry.taskId || entry.taskId === run.taskId) &&
        (!entry.runId || entry.runId === execution.runId),
    );
    if (matches.some((entry) => entry.origin === 'fixture')) fact.origin = 'fixture';
    const relatedIds = matches.map(sourceId);
    for (const id of relatedIds) related.set(id, [fact.id]);
    items.push({ fact, activity: 'recorded', relatedIds });
  }
  for (const entry of history.entries) {
    const event = entry.event;
    if (!['permission.requested', 'turn.completed', 'turn.failed'].includes(event.type)) continue;
    const id = sourceId(entry);
    if (related.has(id)) continue;
    const fact: OpaAttentionFact = {
      id,
      projectPath: entry.projectPath,
      kind:
        event.type === 'permission.requested'
          ? 'blocked'
          : event.type === 'turn.failed'
            ? 'error'
            : 'result',
      title: `${event.provider} · ${event.sessionId}`.slice(0, 500),
      state:
        event.type === 'permission.requested'
          ? 'Needs permission'
          : event.type === 'turn.failed'
            ? 'failed'
            : 'completed',
      origin: entry.origin,
      observedAt: entry.observedAt,
      sourceTime: event.timestamp,
      taskId: entry.taskId,
      runId: entry.runId,
      provider: event.provider,
      sessionId: event.sessionId,
      agentId: event.agentId,
      streamId: event.streamId,
      eventId: event.id,
      eventOrdinal: entry.ordinal,
    };
    let activity: OpaAttentionItem['activity'] = 'recorded';
    if (fact.kind === 'blocked') {
      const reconciliation = permissionState.get(id)!;
      const agent = projects
        .find((p) => p.id === entry.projectPath)
        ?.agents.find(
          (a) =>
            a.provider === event.provider &&
            a.sessionId === event.sessionId &&
            a.sourceAgentId === event.agentId,
        );
      const task = tasks.find((t) => t.projectPath === entry.projectPath && t.id === entry.taskId);
      const runStillCurrent =
        !entry.runId ||
        (task?.execution?.runId === entry.runId && task.execution.state === 'running');
      activity = reconciliation.resolved
        ? 'resolved'
        : agent?.status === 'blocked' &&
            !reconciliation.nextRequest &&
            latestRequests.get(source(entry)) === entry.ordinal &&
            runStillCurrent
          ? 'current'
          : 'stale';
    }
    items.push({ fact, activity });
  }
  // Live projections without durable event evidence stay explicitly labelled live.
  for (const project of projects)
    for (const agent of project.agents) {
      if (!['blocked', 'done', 'error'].includes(agent.status)) continue;
      if (
        items.some(
          (i) =>
            i.fact.projectPath === project.id &&
            i.fact.provider === agent.provider &&
            i.fact.sessionId === agent.sessionId &&
            i.fact.agentId === agent.sourceAgentId &&
            (agent.status === 'blocked'
              ? i.fact.kind === 'blocked'
              : i.fact.eventId === agent.attentionId),
        )
      )
        continue;
      if (agent.status !== 'blocked' && !agent.attentionId) continue;
      items.push({
        fact: {
          id: attentionFactId(
            'live',
            project.id,
            agent.provider,
            agent.sessionId ?? String(agent.id),
            agent.sourceAgentId ?? '',
            agent.status === 'blocked'
              ? String(agent.blockedSince ?? 'unknown')
              : agent.attentionId!,
          ),
          projectPath: project.id,
          kind:
            agent.status === 'blocked' ? 'blocked' : agent.status === 'error' ? 'error' : 'result',
          title: agent.name.slice(0, 500),
          state: agent.status,
          origin: 'live',
          observedAt: agent.status === 'blocked' ? agent.blockedSince : agent.completedAt,
          provider: agent.provider,
          sessionId: agent.sessionId,
          agentId: agent.sourceAgentId,
          eventId: agent.status === 'blocked' ? undefined : agent.attentionId,
        },
        activity: agent.status === 'blocked' ? 'current' : 'recorded',
      });
    }
  const filtered = items.filter(
    (i) => projectPath === undefined || i.fact.projectPath === toPathKey(projectPath),
  );
  filtered.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (b.fact.observedAt ?? -1) - (a.fact.observedAt ?? -1) ||
      a.fact.id.localeCompare(b.fact.id),
  );
  return {
    version: 1,
    hostId: work.hostId,
    items: filtered.slice(0, 2000),
    limited: filtered.length > 2000 || work.runsLimited,
    droppedFacts: work.droppedFacts,
    droppedEventsThrough: history.droppedThrough,
  };
}
export function attentionReply(store: AgentStateStore, raw: Record<string, unknown>) {
  const requestId =
    typeof raw.requestId === 'string' && raw.requestId.length <= 200 ? raw.requestId : '';
  try {
    if (
      !requestId ||
      (raw.projectPath !== undefined &&
        (typeof raw.projectPath !== 'string' ||
          !raw.projectPath.trim() ||
          raw.projectPath.length > 8192))
    )
      throw Error('ATTENTION_QUERY_INVALID');
    return {
      type: 'opaAttentionState' as const,
      requestId,
      ...attentionSnapshot(store, raw.projectPath as string | undefined),
    };
  } catch (error) {
    return {
      type: 'opaAttentionState' as const,
      requestId,
      error: error instanceof Error ? error.message : 'ATTENTION_UNAVAILABLE',
    };
  }
}
