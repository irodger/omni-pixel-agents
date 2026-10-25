import type { OpaTask } from '../../../core/src/opa/work.js';

/** No inference from task status, result prose or current assignee. */
export function taskSummary(task: OpaTask) {
  const run = task.execution;
  if (!run) return null;
  const started = Number.isFinite(run.startedAt) ? run.startedAt : undefined;
  const finished =
    run.finishedAt !== undefined && Number.isFinite(run.finishedAt) ? run.finishedAt : undefined;
  const duration =
    started !== undefined && finished !== undefined && finished >= started
      ? finished - started
      : undefined;
  const observations = run.usage;
  const usage = observations?.length
    ? {
        input: observations.reduce((n, u) => n + u.inputTokens, 0),
        output: observations.reduce((n, u) => n + u.outputTokens, 0),
        reported: observations
          .filter((u) => u.cost?.kind === 'reported')
          .reduce((n, u) => n + (u.cost?.amount ?? 0), 0),
        estimated: observations
          .filter((u) => u.cost?.kind === 'estimated')
          .reduce((n, u) => n + (u.cost?.amount ?? 0), 0),
        reportedCount: observations.filter((u) => u.cost?.kind === 'reported').length,
        estimatedCount: observations.filter((u) => u.cost?.kind === 'estimated').length,
        unknownCount: observations.filter((u) => !u.cost).length,
      }
    : undefined;
  return { run, started, finished, duration, usage };
}
