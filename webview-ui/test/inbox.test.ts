import { describe, expect, it } from 'vitest';

import type { OpaProjectSnapshot } from '../../core/src/messages.js';
import type { OpaTask } from '../../core/src/opa/work.js';
import { inboxItems, taskReadId } from '../src/opa/inbox.js';

const task: OpaTask = {
  id: 't',
  projectPath: '/fixture',
  title: 'Fixture',
  status: 'open',
  createdAt: 1,
  updatedAt: 2,
  revision: 1,
  execution: {
    runId: 'r',
    state: 'completed',
    journal: '/j',
    startedAt: 1,
    finishedAt: 10,
    resultEventId: 'event',
  },
};
const projects: OpaProjectSnapshot[] = [
  {
    id: '/fixture',
    path: '/fixture',
    name: 'Fixture',
    agents: [
      {
        id: 1,
        name: 'agent',
        provider: 'codex',
        sessionId: 's',
        sourceAgentId: 'a',
        status: 'done',
        attentionId: 'event',
        tools: [],
      },
    ],
  },
];
describe('Attention Lite projection', () => {
  it('deduplicates a task result only with exact source event evidence', () => {
    expect(inboxItems(projects, [task], [])).toHaveLength(1);
    const unrelated = { ...task, execution: { ...task.execution!, resultEventId: 'different' } };
    expect(inboxItems(projects, [unrelated], [])).toHaveLength(2);
    expect(inboxItems(projects, [task], [taskReadId(task)!, 'event'])).toHaveLength(0);
    expect(inboxItems(projects, [task], ['event'])).toHaveLength(0);
    expect(inboxItems(projects, [task], [])).toEqual(inboxItems(projects, [task], []));
  });
  it('never hides blocks when read and never invents their waiting start', () => {
    const blocked: OpaTask = {
      ...task,
      execution: {
        ...task.execution!,
        state: 'running',
        permissions: [{ id: 'p', title: 'Approve?', options: [] }],
      },
    };
    const items = inboxItems([], [blocked], [taskReadId(blocked)!]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'blocked', readId: undefined, since: undefined });
    expect(blocked.execution?.permissions).toHaveLength(1);
  });
  it('orders blocking before errors and results, scopes identity by project/run', () => {
    const blocked = {
      ...task,
      id: 'b',
      execution: {
        ...task.execution!,
        state: 'running',
        permissions: [{ id: 'p', title: 'p', options: [] }],
      },
    };
    const error = {
      ...task,
      id: 'e',
      execution: { ...task.execution!, state: 'interrupted', finishedAt: undefined },
    };
    expect(inboxItems([], [task, error, blocked], []).map((i) => i.kind)).toEqual([
      'blocked',
      'error',
      'result',
    ]);
    expect(taskReadId({ ...task, projectPath: '/other' })).not.toBe(taskReadId(task));
    expect(taskReadId({ ...task, execution: { ...task.execution!, runId: 'new' } })).not.toBe(
      taskReadId(task),
    );
    expect(inboxItems([], [{ ...task, execution: undefined }], [])).toEqual([]);
  });
});
