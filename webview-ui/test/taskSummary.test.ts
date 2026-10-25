import { describe, expect, it } from 'vitest';

import type { OpaTask } from '../../core/src/opa/work.js';
import { taskSummary } from '../src/opa/summaryModel.js';

const task: OpaTask = {
  id: 'task',
  projectPath: '/fixture',
  title: 'Fixture',
  status: 'done',
  assignee: 'changed-after-run',
  createdAt: 1,
  updatedAt: 10,
  revision: 1,
};
describe('evidence-backed task summary', () => {
  it('does not invent a run or checks from task done status', () =>
    expect(taskSummary(task)).toBeNull());
  it.each(['completed', 'failed', 'cancelled', 'interrupted'])(
    'keeps %s separate from task status, unknown executor and missing finish',
    (state) => {
      const summary = taskSummary({
        ...task,
        execution: {
          runId: 'r',
          state,
          journal: '/journal',
          startedAt: 20,
          output: 'All tests passed',
        },
      })!;
      expect(summary.run.state).toBe(state);
      expect(summary.run.executorId).toBeUndefined();
      expect(summary.finished).toBeUndefined();
      expect(summary.duration).toBeUndefined();
      expect(summary.usage).toBeUndefined();
    },
  );
  it('distinguishes known zero from missing cost and never adds cache subsets', () => {
    const summary = taskSummary({
      ...task,
      execution: {
        runId: 'r',
        state: 'completed',
        executorId: 'original',
        journal: '/journal',
        startedAt: 10,
        finishedAt: 20,
        usage: [
          {
            usageId: '1',
            projectPath: '/fixture',
            provider: 'codex',
            sessionId: 's',
            timestamp: new Date().toISOString(),
            inputTokens: 10,
            outputTokens: 5,
            cachedInputTokens: 3,
            cost: { amount: 0, currency: 'USD', kind: 'reported' },
          },
        ],
      },
    })!;
    expect(summary.run.executorId).toBe('original');
    expect(summary.duration).toBe(10);
    expect(summary.usage).toMatchObject({
      input: 10,
      output: 5,
      reported: 0,
      reportedCount: 1,
      estimatedCount: 0,
      unknownCount: 0,
    });
  });
});
