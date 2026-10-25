import { describe, expect, it } from 'vitest';

import type { OpaTask } from '../../core/src/opa/work.js';
import { taskDragData, taskFromDrop, taskMoveCommand } from '../src/opa/kanban.js';

const task: OpaTask = {
  id: 'same-id',
  projectPath: '/project/a',
  title: 'Do work',
  assignee: 'codex',
  status: 'open',
  revision: 3,
  createdAt: 1,
  updatedAt: 2,
};
describe('kanban command boundary', () => {
  it('moves only status, retaining revision and project without a launch or assignment', () => {
    expect(taskMoveCommand(task, 'in_progress')).toEqual({
      action: 'move',
      projectPath: '/project/a',
      taskId: 'same-id',
      expectedRevision: 3,
      status: 'in_progress',
    });
    expect(taskMoveCommand(task, 'open')).toBeNull();
  });
  it('rejects every move, including cancellation, while a process is running', () => {
    const running = {
      ...task,
      execution: { runId: 'run', state: 'running', journal: '/journal', startedAt: 1 },
    };
    expect(() => taskMoveCommand(running, 'cancelled')).toThrow('TASK_MOVE_RUNNING');
    expect(() => taskMoveCommand(running, 'done')).toThrow('TASK_MOVE_RUNNING');
  });
  it('resolves a drag by project and ID instead of trusting foreign payload fields', () => {
    const other = { ...task, projectPath: '/project/b' };
    expect(taskFromDrop(taskDragData(task), [other, task])).toBe(task);
    expect(taskFromDrop(JSON.stringify({ ...task, launch: true, assignee: 'evil' }), [task])).toBe(
      task,
    );
  });
  it('rejects stale, deleted or malformed cards instead of overwriting newer work', () => {
    expect(() => taskFromDrop(taskDragData(task), [{ ...task, revision: 4 }])).toThrow(
      'TASK_CONFLICT',
    );
    expect(() => taskFromDrop(taskDragData(task), [])).toThrow('TASK_NOT_FOUND');
    for (const raw of ['not json', 'null', '[]', '{"id":"x"}'])
      expect(() => taskFromDrop(raw, [task])).toThrow('TASK_INVALID');
  });
});
