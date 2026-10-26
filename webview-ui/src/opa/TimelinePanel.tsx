import { useCallback, useEffect, useRef, useState } from 'react';

import type { OpaHistoryEntry } from '../../../core/src/opa/history.js';
import { t } from '../i18n/index.js';
import { type CampusRoute, EVENT_TYPES } from './deepLinks.js';
import { LinkControls } from './LinkControls.js';
import { TimelineEntry } from './TimelineEntry.js';
import { mergeTimeline, timelineError, timelineQuery } from './timelineModel.js';
import type { useCampus } from './useCampus.js';

export function TimelinePanel({
  campus,
  route,
  navigate,
}: {
  campus: ReturnType<typeof useCampus>;
  route: CampusRoute;
  navigate: (route: CampusRoute) => void;
}) {
  const { connection, requestEvents } = campus;
  const [entries, setEntries] = useState<OpaHistoryEntry[]>([]);
  const [cursor, setCursor] = useState<number>();
  const [dropped, setDropped] = useState<number>();
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const generation = useRef({ value: 0 });
  const inFlight = useRef(false);
  const project = route.project;
  const load = useCallback(
    async (before?: number) => {
      if (!project || inFlight.current) return;
      inFlight.current = true;
      const request = ++generation.current.value;
      setPending(true);
      setError('');
      try {
        const page = await requestEvents(timelineQuery(route, before));
        if (!mounted.current || request !== generation.current.value) return;
        // Validate the page before committing any presentation state.
        const checked = mergeTimeline([], page, project);
        setEntries((current) => (before ? mergeTimeline(current, page, project) : checked));
        setCursor(page.nextCursor);
        setDropped(page.droppedThrough);
        setLoaded(true);
      } catch (e) {
        if (mounted.current && request === generation.current.value)
          setError(e instanceof Error ? e.message : 'EVENT_HISTORY_INVALID');
      } finally {
        if (mounted.current && request === generation.current.value) {
          inFlight.current = false;
          setPending(false);
        }
      }
    },
    [project, requestEvents, route],
  );
  useEffect(() => {
    mounted.current = true;
    const epoch = generation.current;
    if (connection === 'connected') void load();
    else setPending(false);
    return () => {
      mounted.current = false;
      epoch.value++;
      inFlight.current = false;
    };
  }, [connection, load]);
  return (
    <section className="opa-timeline" aria-label={t('Timeline')}>
      <h2>{t('Timeline')}</h2>
      <p className="opa-muted">
        {t(
          'Recorded observations, newest first. Source clocks may differ; order does not imply causality.',
        )}
      </p>
      {!project ? (
        <p role="status">{t('Choose one project to load its saved activity.')}</p>
      ) : (
        <>
          <LinkControls route={route} />
          <form
            className="opa-timeline-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              navigate({
                view: 'timeline',
                project,
                task: String(data.get('task') || '') || undefined,
                run: String(data.get('run') || '') || undefined,
                provider: String(data.get('provider') || '') || undefined,
                session: String(data.get('session') || '') || undefined,
                eventType: String(data.get('eventType') || '') || undefined,
              });
            }}
          >
            {(['task', 'run', 'provider', 'session'] as const).map((field) => (
              <label key={field}>
                {t(
                  { task: 'Task ID', run: 'Run ID', provider: 'Provider', session: 'Session ID' }[
                    field
                  ],
                )}
                <input
                  name={field}
                  defaultValue={route[field] ?? ''}
                  maxLength={field === 'task' || field === 'run' ? 200 : 256}
                />
              </label>
            ))}
            <label>
              {t('Event type')}
              <select name="eventType" defaultValue={route.eventType ?? ''}>
                <option value="">{t('All event types')}</option>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="opa-button">
              {t('Apply filters')}
            </button>
            <button
              type="button"
              className="opa-button"
              onClick={() => navigate({ view: 'timeline', project })}
            >
              {t('Clear filters')}
            </button>
          </form>
          <button
            type="button"
            className="opa-button"
            disabled={pending || connection !== 'connected'}
            onClick={() => void load()}
          >
            {t('Refresh timeline')}
          </button>
          {route.event && (
            <button
              type="button"
              className="opa-button"
              onClick={() => navigate({ ...route, event: undefined })}
            >
              {t('Return to newest events')}
            </button>
          )}
          {connection !== 'connected' && (
            <p role="status">
              {t('Offline. Loaded events remain available; reconnect to refresh.')}
            </p>
          )}
          {error && <p role="alert">{t(timelineError(error))}</p>}
          {dropped !== undefined && dropped > 0 && (
            <p className="opa-notice">
              {t(
                'Host retention removed observations through #{ordinal}. Missing events are not reconstructed.',
                { ordinal: dropped },
              )}
            </p>
          )}
          {loaded && route.event && !entries.some((e) => String(e.ordinal) === route.event) && (
            <p role="status">
              {t('The linked event is unavailable or excluded by these filters.')}
            </p>
          )}
          {loaded && !entries.length && <p>{t('No recorded events match these filters.')}</p>}
          <ol className="opa-timeline-list">
            {entries.map((entry) => (
              <TimelineEntry key={entry.ordinal} entry={entry} route={route} navigate={navigate} />
            ))}
          </ol>
          {cursor !== undefined && (
            <button
              type="button"
              className="opa-button"
              disabled={pending || connection !== 'connected'}
              onClick={() => void load(cursor)}
            >
              {t('Load older events')}
            </button>
          )}
          {pending && <p role="status">{t('Loading events…')}</p>}
        </>
      )}
    </section>
  );
}
