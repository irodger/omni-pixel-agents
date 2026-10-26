import { useEffect, useState } from 'react';

import type { OpaTask, OpaTaskRun } from '../../../core/src/opa/work.js';
import { localeName, t, useLanguage } from '../i18n/index.js';
import type { CampusRoute } from './deepLinks.js';
import { TaskSummary } from './TaskSummary.js';
import type { useCampus } from './useCampus.js';

function historyError(code: string): string {
  const messages: Record<string, string> = {
    RUN_NOT_FOUND: 'This saved attempt is unavailable on this host.',
    TASK_NOT_FOUND: 'This task is unavailable on this host.',
    RUNS_CURSOR_INVALID: 'History changed. Refresh the list.',
    HISTORY_INVALID: 'Run history could not be read. Stored data has been kept.',
    HISTORY_UNSUPPORTED: 'This host cannot read the saved history version.',
    STORAGE_FAILED: 'Run history could not be saved. Check host storage and try again.',
    REQUEST_TIMEOUT: 'Run history could not be loaded. Check the connection and try again.',
  };
  return messages[code] ?? 'Run history is unavailable.';
}

export function TaskHistory({
  task,
  campus,
  selectedRunId,
  navigate,
}: {
  task: OpaTask;
  campus: ReturnType<typeof useCampus>;
  selectedRunId?: string;
  navigate: (route: CampusRoute) => void;
}) {
  const { language } = useLanguage();
  const [opened, setOpened] = useState(false);
  const [runs, setRuns] = useState<OpaTaskRun[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<OpaTaskRun>();
  const [selectedError, setSelectedError] = useState('');
  const { requestHistory, connection } = campus;
  const { projectPath, id } = task;
  const selectedState = selectedRunId === task.execution?.runId ? task.execution?.state : undefined;
  useEffect(() => {
    let cancelled = false;
    setSelected((current) => (current?.execution.runId === selectedRunId ? current : undefined));
    setSelectedError('');
    if (selectedRunId && connection === 'connected') {
      void requestHistory({ projectPath, taskId: id, runId: selectedRunId })
        .then((page) => {
          if (!cancelled) {
            const run = page.runs.find((r) => r.execution.runId === selectedRunId);
            if (run) setSelected(run);
            else {
              setSelected(undefined);
              setSelectedError('RUN_NOT_FOUND');
            }
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setSelected(undefined);
            setSelectedError(e instanceof Error ? e.message : 'RUNS_INVALID');
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, selectedState, projectPath, id, connection, requestHistory]);
  const load = async (before?: string) => {
    setPending(true);
    setError('');
    try {
      const page = await requestHistory({ projectPath, taskId: id, before, limit: 20 });
      setRuns((current) =>
        before
          ? [
              ...current,
              ...page.runs.filter(
                (r) => !current.some((c) => c.execution.runId === r.execution.runId),
              ),
            ]
          : page.runs,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'RUNS_INVALID');
    } finally {
      setPending(false);
    }
  };
  const route = (run?: string): CampusRoute => ({
    view: 'tasks',
    project: projectPath,
    task: id,
    run,
  });
  const chosen = selected?.execution.runId === selectedRunId ? selected : undefined;
  return (
    <div className="opa-run-history">
      <button
        type="button"
        className="opa-button"
        onClick={() =>
          navigate({ view: 'timeline', project: projectPath, task: id, run: selectedRunId })
        }
      >
        {t('View recorded activity')}
      </button>
      {selectedRunId ? (
        <>
          <p className="opa-notice">
            {t('Viewing a saved attempt. Return to latest for live task controls.')}
          </p>
          <button type="button" className="opa-button" onClick={() => navigate(route())}>
            {t('Return to latest')}
          </button>
          {selectedError && <p role="status">{t(historyError(selectedError))}</p>}
          {!chosen && !selectedError && (
            <p role="status">
              {t(
                connection === 'connected'
                  ? 'Loading run history…'
                  : 'Connect to load run history.',
              )}
            </p>
          )}
          {chosen && (
            <>
              <p>
                {t('Attempt title')}: {chosen.titleFromLegacyTask ? t('Unknown') : chosen.title}
              </p>
              {chosen.execution.state === 'running' ? (
                <p>{t('This attempt is still active. Live controls stay on the latest task.')}</p>
              ) : (
                <TaskSummary
                  key={chosen.execution.runId}
                  task={{
                    ...task,
                    title: chosen.titleFromLegacyTask ? t('Unknown attempt title') : chosen.title,
                    execution: chosen.execution,
                  }}
                  historical
                />
              )}
            </>
          )}
        </>
      ) : (
        <TaskSummary key={task.execution?.runId} task={task} />
      )}
      <details
        open={opened}
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpened(next);
          if (next && !opened && !runs.length && !pending && connection === 'connected')
            void load();
        }}
      >
        <summary>{t('Run history')}</summary>
        <p className="opa-muted">
          {t('Each attempt is separate. Viewing history never starts, retries or approves work.')}
        </p>
        <button
          type="button"
          className="opa-button"
          disabled={pending || connection !== 'connected'}
          onClick={() => void load()}
        >
          {t('Refresh history')}
        </button>
        {connection !== 'connected' && <p role="status">{t('Connect to load run history.')}</p>}
        {error && <p role="status">{t(historyError(error))}</p>}
        {!pending && !runs.length && !error && connection === 'connected' && (
          <p>{t('No saved attempts.')}</p>
        )}
        <ol>
          {runs.map((run) => (
            <li key={run.execution.runId}>
              <button
                type="button"
                className="opa-button opa-run-button"
                onClick={() => navigate(route(run.execution.runId))}
                aria-current={run.execution.runId === selectedRunId ? 'true' : undefined}
              >
                {new Date(run.execution.startedAt).toLocaleString(localeName(language))} ·{' '}
                {t(run.execution.state)} · {run.execution.executorId ?? t('Unknown')} ·{' '}
                {run.execution.runId}
              </button>
            </li>
          ))}
        </ol>
        {cursor && (
          <button
            type="button"
            className="opa-button"
            disabled={pending || connection !== 'connected'}
            onClick={() => void load(cursor)}
          >
            {t('Load older attempts')}
          </button>
        )}
        {pending && <p role="status">{t('Loading run history…')}</p>}
      </details>
    </div>
  );
}
