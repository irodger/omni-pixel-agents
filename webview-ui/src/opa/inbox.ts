import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import type { OpaTask } from '../../../core/src/opa/work.js';
import { type SeenEvents } from './attention.js';
import type { CampusRoute } from './deepLinks.js';

export type InboxItem = {
  id: string;
  project: string;
  title: string;
  kind: 'blocked' | 'error' | 'result';
  state: string;
  since?: number;
  readId?: string;
  relatedEventId?: string;
  route: CampusRoute;
};
export function taskReadId(task: OpaTask): string | undefined {
  return (
    task.execution &&
    'opa:task-result:' +
      JSON.stringify([task.projectPath, task.id, task.execution.runId, task.execution.state])
  );
}
/** Projection only: no dispatch/permission methods, no inferred checks. */
export function inboxItems(
  projects: OpaProjectSnapshot[],
  tasks: OpaTask[],
  seen: SeenEvents,
): InboxItem[] {
  const taskItems: InboxItem[] = tasks.flatMap((task) => {
    const run = task.execution;
    if (!run) return [];
    const blocked = run.state === 'running' && !!run.permissions?.length;
    if (!blocked && !['completed', 'failed', 'cancelled', 'interrupted'].includes(run.state))
      return [];
    return [
      {
        id: JSON.stringify(['task', task.projectPath, task.id, run.runId]),
        project: task.projectPath,
        title: task.title,
        kind: blocked
          ? 'blocked'
          : ['failed', 'interrupted'].includes(run.state)
            ? 'error'
            : 'result',
        state: blocked ? 'Needs permission' : run.state,
        since: blocked ? undefined : run.finishedAt,
        readId: blocked ? undefined : taskReadId(task),
        relatedEventId: blocked ? undefined : run.resultEventId,
        route: { view: 'tasks', project: task.projectPath, task: task.id },
      },
    ];
  });
  const related = new Set(
    taskItems.flatMap((item) =>
      item.relatedEventId ? [JSON.stringify([item.project, item.relatedEventId])] : [],
    ),
  );
  const agentItems: InboxItem[] = projects.flatMap((project) =>
    project.agents.flatMap((agent) => {
      if (
        agent.status !== 'blocked' &&
        !((agent.status === 'done' || agent.status === 'error') && agent.attentionId)
      )
        return [];
      if (
        agent.status !== 'blocked' &&
        related.has(JSON.stringify([project.id, agent.attentionId]))
      )
        return [];
      return [
        {
          id: JSON.stringify([
            'agent',
            project.id,
            agent.provider,
            agent.sessionId ?? agent.id,
            agent.sourceAgentId,
          ]),
          project: project.id,
          title: agent.name,
          kind:
            agent.status === 'blocked' ? 'blocked' : agent.status === 'error' ? 'error' : 'result',
          state: agent.status,
          since: agent.blockedSince ?? agent.completedAt,
          readId: agent.status === 'blocked' ? undefined : agent.attentionId,
          route:
            agent.sessionId && agent.sourceAgentId
              ? {
                  view: 'overview',
                  project: project.id,
                  provider: agent.provider,
                  session: agent.sessionId,
                  agent: agent.sourceAgentId,
                }
              : { view: 'overview', project: project.id },
        },
      ];
    }),
  );
  const priority = { blocked: 0, error: 1, result: 2 };
  return [...taskItems, ...agentItems]
    .filter(
      (item) =>
        item.kind === 'blocked' ||
        ((!item.readId || !seen.includes(item.readId)) &&
          (!item.relatedEventId || !seen.includes(item.relatedEventId))),
    )
    .sort(
      (a, b) =>
        priority[a.kind] - priority[b.kind] ||
        (a.since ?? Infinity) - (b.since ?? Infinity) ||
        a.id.localeCompare(b.id),
    );
}
