import type { OpaQueueCommand } from '../../../core/src/opa/work.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { executeTaskCommand, isTaskRunning, validateTaskStart } from './execution.js';
import { opaWorkSnapshot, saveTaskQueue, taskQueue, WorkError } from './work.js';

/** A queue command is always an authenticated human mutation, never an observer query. */
export function executeQueueCommand(store: AgentStateStore, raw: Record<string, unknown>): void {
  const text = (value: unknown, limit: number): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
  if (
    !text(raw.projectPath, 8192) ||
    !text(raw.requestId, 200) ||
    !Number.isSafeInteger(raw.expectedRevision) ||
    (raw.expectedRevision as number) < 0 ||
    typeof raw.action !== 'string' ||
    !['enqueue', 'remove', 'reorder', 'pause', 'resume', 'start-next'].includes(raw.action) ||
    Object.keys(raw).some(
      (k) =>
        ![
          'type',
          'requestId',
          'projectPath',
          'action',
          'expectedRevision',
          'taskId',
          'taskIds',
          'expectedTaskRevision',
        ].includes(k),
    )
  )
    throw new WorkError('QUEUE_INVALID');
  const command = raw as unknown as OpaQueueCommand;
  const taskFields = command.action === 'enqueue' || command.action === 'start-next';
  if (
    (!taskFields && command.expectedTaskRevision !== undefined) ||
    (command.action !== 'reorder' && command.taskIds !== undefined) ||
    (!['enqueue', 'remove', 'start-next'].includes(command.action) && command.taskId !== undefined)
  )
    throw new WorkError('QUEUE_INVALID');
  const projectPath = toPathKey(command.projectPath);
  const queue = taskQueue(store, projectPath);
  const fingerprint = JSON.stringify([
    command.action,
    command.expectedRevision,
    command.taskId,
    command.taskIds,
    command.expectedTaskRevision,
  ]);
  const receipt = queue.receipts.find((r) => r.requestId === command.requestId);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new WorkError('QUEUE_CONFLICT');
    if (command.action === 'start-next') throw new WorkError('QUEUE_START_ALREADY_RECORDED');
    return;
  }
  if (queue.revision !== command.expectedRevision) throw new WorkError('QUEUE_CONFLICT');
  if (queue.revision >= Number.MAX_SAFE_INTEGER) throw new WorkError('QUEUE_CAPACITY');
  const tasks = opaWorkSnapshot(store).tasks.filter((t) => t.projectPath === projectPath);
  const task = tasks.find((t) => t.id === command.taskId);
  switch (command.action) {
    case 'enqueue':
      if (!task) throw new WorkError('TASK_NOT_FOUND');
      if (task.revision !== command.expectedTaskRevision) throw new WorkError('TASK_CONFLICT');
      if (isTaskRunning(store, task)) throw new WorkError('TASK_RUNNING');
      if (['done', 'cancelled'].includes(task.status)) throw new WorkError('TASK_REOPEN_REQUIRED');
      if (queue.taskIds.includes(task.id)) throw new WorkError('TASK_ALREADY_QUEUED');
      if (queue.taskIds.length >= 200) throw new WorkError('QUEUE_CAPACITY');
      queue.taskIds.push(task.id);
      break;
    case 'remove':
      if (!text(command.taskId, 200) || !queue.taskIds.includes(command.taskId))
        throw new WorkError('QUEUE_ITEM_NOT_FOUND');
      queue.taskIds = queue.taskIds.filter((id) => id !== command.taskId);
      break;
    case 'reorder':
      if (
        !Array.isArray(command.taskIds) ||
        command.taskIds.length !== queue.taskIds.length ||
        new Set(command.taskIds).size !== queue.taskIds.length ||
        command.taskIds.some((id) => !queue.taskIds.includes(id))
      )
        throw new WorkError('QUEUE_INVALID');
      queue.taskIds = [...command.taskIds];
      break;
    case 'pause':
      queue.paused = true;
      break;
    case 'resume':
      queue.paused = false;
      break;
    case 'start-next': {
      if (queue.paused) throw new WorkError('QUEUE_PAUSED');
      const next = tasks.find((t) => t.id === queue.taskIds[0]);
      if (!next) throw new WorkError(queue.taskIds.length ? 'TASK_NOT_FOUND' : 'QUEUE_EMPTY');
      if (command.taskId !== next.id) throw new WorkError('QUEUE_CONFLICT');
      if (['done', 'cancelled'].includes(next.status)) throw new WorkError('TASK_REOPEN_REQUIRED');
      validateTaskStart(store, next, command.expectedTaskRevision);
      // Commit removal and idempotency before launch. A crash cannot auto-resume/repeat this reservation.
      queue.taskIds.shift();
      break;
    }
  }
  queue.revision++;
  queue.receipts = [...queue.receipts, { requestId: command.requestId, fingerprint }].slice(-128);
  saveTaskQueue(store, queue);
  if (command.action === 'start-next') {
    executeTaskCommand(store, {
      action: 'start',
      requestId: command.requestId,
      projectPath,
      taskId: command.taskId,
      expectedRevision: command.expectedTaskRevision,
    });
  }
}
