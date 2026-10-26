import { useState } from 'react';

import type { OpaTask } from '../../../core/src/opa/work.js';
import { localeName, t, useLanguage } from '../i18n/index.js';
import { GitContextPanel } from './GitContextPanel.js';
import { LinkControls } from './LinkControls.js';
import { taskSummary } from './summaryModel.js';

export function TaskSummary({ task, historical = false }: { task: OpaTask; historical?: boolean }) {
  const { language } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState('');
  const summary = taskSummary(task);
  if (!summary || summary.run.state === 'running') return null;
  const { run, started, finished, duration, usage } = summary;
  const date = (n: number | undefined) =>
    n === undefined ? t('Unknown') : new Date(n).toLocaleString(localeName(language));
  const text = `${task.title}\n${t('Execution')}: ${t(run.state)}\n${t('Run ID')}: ${run.runId}\n${t('Executor')}: ${run.executorId ?? t('Unknown')}\n${t('Started')}: ${date(started)}\n${t('Finished')}: ${date(finished)}\n${t('Project')}: ${task.projectPath}\n\n${run.error ?? ''}\n${run.output ?? ''}`;
  return (
    <section className="opa-task-summary" aria-label={`${t('Task summary')}: ${task.title}`}>
      <h4>{t('Task summary')}</h4>
      <dl>
        <dt>{t('Execution')}</dt>
        <dd>{t(run.state)}</dd>
        <dt>{t(historical ? 'Current task status' : 'Task status')}</dt>
        <dd>
          {t(
            { open: 'Open', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' }[
              task.status
            ],
          )}
        </dd>
        <dt>{t('Run ID')}</dt>
        <dd>{run.runId}</dd>
        <dt>{t('Executor')}</dt>
        <dd>{run.executorId ?? t('Unknown')}</dd>
        <dt>{t('Started')}</dt>
        <dd>{date(started)}</dd>
        <dt>{t('Finished')}</dt>
        <dd>{date(finished)}</dd>
        <dt>{t('Duration')}</dt>
        <dd>
          {duration === undefined ? t('Unknown') : `${Math.round(duration / 1000)} ${t('seconds')}`}
        </dd>
        <dt>{t('Recorded tokens (input / output)')}</dt>
        <dd>{usage ? `${usage.input} / ${usage.output}` : t('Unknown')}</dd>
        <dt>{t('Reported cost')}</dt>
        <dd>{usage?.reportedCount ? `${usage.reported} USD` : t('Unknown')}</dd>
        <dt>{t('Estimated cost')}</dt>
        <dd>{usage?.estimatedCount ? `${usage.estimated} USD` : t('Unknown')}</dd>
      </dl>
      {usage && (
        <p className="opa-muted">
          {t('Usage observations without cost')}: {usage.unknownCount}
        </p>
      )}
      <p className="opa-muted">
        {t(
          'Only usage observed in this run is shown. Missing observations remain unknown; costs are not invoices.',
        )}
      </p>
      <p className="opa-muted">
        {t('Git diff, quality checks and artifacts: not recorded in this increment.')}
      </p>
      {run.error && <p className="opa-error-detail">{run.error}</p>}
      {run.output ? (
        <details>
          <summary>{t('Result')}</summary>
          <pre className="opa-result-output">{run.output}</pre>
        </details>
      ) : (
        <p>{t('No result text recorded.')}</p>
      )}
      {run.outputTruncated && (
        <p className="opa-notice">
          {t('Result truncated: only the last 8000 characters were retained.')}
        </p>
      )}
      {historical && (
        <GitContextPanel
          key={run.runId}
          projectPath={task.projectPath}
          saved={run.gitContext}
          after={run.gitContextAfter}
        />
      )}
      <LinkControls
        route={{ view: 'tasks', project: task.projectPath, task: task.id, run: run.runId }}
      />
      {run.provider && run.sessionId && run.sourceAgentId && (
        <a
          className="opa-button"
          href={
            '#opa?' +
            new URLSearchParams({
              v: '1',
              view: 'overview',
              project: task.projectPath,
              provider: run.provider,
              session: run.sessionId,
              agent: run.sourceAgentId,
            }).toString()
          }
        >
          {t('Source session')}
        </a>
      )}
      <button
        type="button"
        className="opa-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          } catch {
            setCopyFallback(text);
          }
        }}
      >
        {t('Copy summary')}
      </button>
      {copied && <span role="status">{t('Summary copied.')}</span>}
      {copyFallback && (
        <textarea
          aria-label={t('Summary text')}
          readOnly
          value={copyFallback}
          onFocus={(e) => e.target.select()}
        />
      )}
    </section>
  );
}
