import { useState } from 'react';

import type { OpaQueueCommand } from '../../../core/src/opa/work.js';
import { t } from '../i18n/index.js';
import type { useCampus } from './useCampus.js';

export function TaskQueuePanel({
  campus,
  project,
  readOnly,
}: {
  campus: ReturnType<typeof useCampus>;
  project: string | null;
  readOnly: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const queue = campus.queues.find((q) => q.projectPath === project);
  const ids = queue?.taskIds ?? [];
  const first = campus.tasks.find((task) => task.projectPath === project && task.id === ids[0]);
  const busy = campus.tasks.some(
    (task) => task.projectPath === project && task.execution?.state === 'running',
  );
  const disabled = readOnly || pending || campus.connection !== 'connected';
  const send = async (action: OpaQueueCommand['action'], fields: Partial<OpaQueueCommand> = {}) => {
    if (!project || disabled) return;
    setPending(true);
    setError('');
    try {
      await campus.saveQueue({
        ...fields,
        action,
        projectPath: project,
        expectedRevision: queue?.revision ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'QUEUE_INVALID');
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="opa-queue" aria-label={t('Task queue')}>
      <h3>{t('Task queue')}</h3>
      <p className="opa-muted">
        {t(
          'Saving, assigning and enqueueing never starts work. Start one task explicitly; the queue never drains automatically.',
        )}
      </p>
      {!project ? (
        <p>{t('Choose one project to manage its queue.')}</p>
      ) : (
        <>
          <p>
            {t(queue?.paused ? 'Queue paused' : 'Queue ready')} · {t('Revision')}{' '}
            {queue?.revision ?? 0}
          </p>
          <button
            type="button"
            className="opa-button"
            disabled={disabled}
            onClick={() => void send(queue?.paused ? 'resume' : 'pause')}
          >
            {t(queue?.paused ? 'Resume queue' : 'Pause queue')}
          </button>
          <p>
            {t('Next task')}:{' '}
            {first
              ? `${first.title} · ${first.assignee ?? t('Unassigned')} · ${first.projectPath}`
              : t('None')}
          </p>
          {busy && (
            <p role="status">
              {t('A task is running in this project. Starting another is unavailable.')}
            </p>
          )}
          {first && !campus.executors.some((e) => e.id === first.assignee) && (
            <p role="status">{t('The next task needs an available executor.')}</p>
          )}
          <button
            type="button"
            className="opa-button"
            disabled={
              disabled ||
              !!queue?.paused ||
              !first ||
              busy ||
              !campus.executors.some((e) => e.id === first.assignee) ||
              (!!first && ['done', 'cancelled'].includes(first.status))
            }
            onClick={() => {
              if (
                first &&
                window.confirm(
                  t('Start {title} with {executor} in {project}? This may incur provider costs.', {
                    title: first.title,
                    executor: first.assignee ?? '',
                    project: first.projectPath,
                  }),
                )
              )
                void send('start-next', { taskId: first.id, expectedTaskRevision: first.revision });
            }}
          >
            {t('Start next task')}
          </button>
          {error && <p role="alert">{t(error)}</p>}
          {!ids.length && <p>{t('No queued tasks.')}</p>}
          <ol>
            {ids.map((id, index) => {
              const task = campus.tasks.find(
                (task) => task.projectPath === project && task.id === id,
              );
              return (
                <li key={id}>
                  <span>
                    {task?.title ?? t('Unavailable task')} · {task?.assignee ?? t('Unassigned')}{' '}
                    {task && ['done', 'cancelled'].includes(task.status)
                      ? `· ${t('Reopen this task before starting it.')}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="opa-button"
                    disabled={disabled || index === 0}
                    aria-label={`${t('Move earlier')}: ${task?.title ?? id}`}
                    onClick={() => {
                      const taskIds = [...ids];
                      [taskIds[index - 1], taskIds[index]] = [taskIds[index], taskIds[index - 1]];
                      void send('reorder', { taskIds });
                    }}
                  >
                    {t('Move earlier')}
                  </button>
                  <button
                    type="button"
                    className="opa-button"
                    disabled={disabled}
                    aria-label={`${t('Remove from queue')}: ${task?.title ?? id}`}
                    onClick={() => void send('remove', { taskId: id })}
                  >
                    {t('Remove from queue')}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
