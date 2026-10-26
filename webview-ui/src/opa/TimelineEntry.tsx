import type { OpaHistoryEntry } from '../../../core/src/opa/history.js';
import { localeName, t, useLanguage } from '../i18n/index.js';
import type { CampusRoute } from './deepLinks.js';
import { LinkControls } from './LinkControls.js';
import { timelineExcerpt, timelineTaskId } from './timelineModel.js';

export function TimelineEntry({
  entry,
  route,
  navigate,
}: {
  entry: OpaHistoryEntry;
  route: CampusRoute;
  navigate: (route: CampusRoute) => void;
}) {
  const { language } = useLanguage();
  const project = entry.projectPath;
  const date = (time: number | string) => new Date(time).toLocaleString(localeName(language));
  const event = entry.event;
  const taskId = timelineTaskId(entry);
  const excerpt = timelineExcerpt(entry);
  return (
    <li
      key={entry.ordinal}
      className={route.event === String(entry.ordinal) ? 'opa-timeline-selected' : undefined}
    >
      <header>
        <strong>
          #{entry.ordinal} · {event.type}
        </strong>{' '}
        <span>
          {t(
            entry.origin === 'fixture'
              ? 'Fixture / test data'
              : entry.origin === 'task-journal'
                ? 'Task journal'
                : 'Ingested observation',
          )}
        </span>
      </header>
      <dl>
        <dt>{t('Source time')}</dt>
        <dd>
          <time dateTime={event.timestamp}>{date(event.timestamp)}</time>
        </dd>
        <dt>{t('Observed time')}</dt>
        <dd>
          <time dateTime={new Date(entry.observedAt).toISOString()}>{date(entry.observedAt)}</time>
        </dd>
        <dt>{t('Provider')}</dt>
        <dd>{event.provider}</dd>
        <dt>{t('Source context')}</dt>
        <dd>
          {event.sessionId} / {event.agentId} / {event.streamId} · {t('Sequence')} {event.sequence}
        </dd>
        <dt>{t('Task / run association')}</dt>
        <dd>
          {taskId ?? t('Unknown')} / {entry.runId ?? t('Unknown')}
        </dd>
      </dl>
      {excerpt !== undefined && <pre className="opa-timeline-excerpt">{excerpt}</pre>}
      {!!entry.truncatedFields?.length && (
        <p className="opa-muted">{t('Stored excerpt is truncated.')}</p>
      )}
      <div className="opa-timeline-actions">
        <button
          type="button"
          className="opa-button"
          onClick={() => navigate({ ...route, event: String(entry.ordinal) })}
        >
          {t('Inspect event')}
        </button>
        <LinkControls route={{ ...route, event: String(entry.ordinal) }} />
        {taskId && (
          <button
            type="button"
            className="opa-button"
            onClick={() => navigate({ view: 'tasks', project, task: taskId, run: entry.runId })}
          >
            {t('Open task / attempt')}
          </button>
        )}
        <button
          type="button"
          className="opa-button"
          onClick={() =>
            navigate({
              view: 'overview',
              project,
              provider: event.provider,
              session: event.sessionId,
              agent: event.agentId,
            })
          }
        >
          {t('Open session context')}
        </button>
        <button
          type="button"
          className="opa-button"
          onClick={() =>
            navigate({
              ...route,
              provider: event.provider,
              session: event.sessionId,
              event: undefined,
            })
          }
        >
          {t('Filter this session')}
        </button>
      </div>
      <details open={route.event === String(entry.ordinal)}>
        <summary>{t('Stored event details')}</summary>
        <pre className="opa-timeline-excerpt">{JSON.stringify(event, null, 2)}</pre>
      </details>
    </li>
  );
}
