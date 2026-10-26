import type { Language } from '../i18n/catalog.js';
import { translate } from '../i18n/catalog.js';

const messages: Record<string, string> = {
  WORKTREE_CHANGED:
    'The bound worktree changed or is unavailable. Inspect it and explicitly attach it again before Start.',
  WORKTREE_HISTORY_INVALID:
    'The saved worktree binding could not be read. Stored data has been kept.',
  QUEUE_INVALID: 'The queue request is invalid. Refresh and try again.',
  QUEUE_CONFLICT: 'The queue changed. Review its current order and try again.',
  QUEUE_CAPACITY: 'The queue has reached its limit of 200 pending tasks or revisions.',
  QUEUE_PAUSED: 'Resume the queue before explicitly starting its next task.',
  QUEUE_EMPTY: 'There are no queued tasks.',
  QUEUE_ITEM_NOT_FOUND: 'This task is no longer queued.',
  TASK_ALREADY_QUEUED: 'This task is already queued.',
  TASK_REOPEN_REQUIRED: 'Reopen this task before starting it.',
  TASK_QUEUED: 'Use Start next task, or remove this task from its queue first.',
  EXPLICIT_START_REQUIRED: 'Saving no longer starts work. Use the separate Start action.',
  QUEUE_START_ALREADY_RECORDED:
    'This start request was already recorded. Check run history; it will not be repeated.',
  QUEUE_VERSION_UNSUPPORTED: 'This host cannot read the saved queue version.',
  QUEUE_HISTORY_INVALID: 'The saved queue could not be read. Stored data has been kept.',
};
export function taskError(code: string, language: Language): string {
  return language === 'ru' ? translate(code, language) : (messages[code] ?? code);
}
