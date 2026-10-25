import type { OpaTask, OpaTaskCommand, TaskStatus } from '../../../core/src/opa/work.js';

export const TASK_DRAG_TYPE = 'application/x-opa-task';
export function taskDragData(task: OpaTask): string {
  return JSON.stringify({ id: task.id, projectPath: task.projectPath, revision: task.revision });
}
export function taskFromDrop(raw: string, tasks: OpaTask[]): OpaTask {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('TASK_INVALID');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.id !== 'string' ||
    typeof value.projectPath !== 'string' ||
    !Number.isSafeInteger(value.revision)
  )
    throw new Error('TASK_INVALID');
  const task = tasks.find((t) => t.id === value.id && t.projectPath === value.projectPath);
  if (!task) throw new Error('TASK_NOT_FOUND');
  if (task.revision !== value.revision) throw new Error('TASK_CONFLICT');
  return task;
}
export function taskMoveCommand(
  task: OpaTask,
  status: TaskStatus,
): Omit<OpaTaskCommand, 'requestId'> | null {
  if (task.execution?.state === 'running') throw new Error('TASK_MOVE_RUNNING');
  if (task.status === status) return null;
  // A move never carries title, assignee, launch, permissions or execution fields.
  return {
    action: 'move',
    projectPath: task.projectPath,
    taskId: task.id,
    expectedRevision: task.revision,
    status,
  };
}
