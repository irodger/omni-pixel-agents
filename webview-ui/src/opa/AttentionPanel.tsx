import { useState } from 'react';

import { localeName, t, useLanguage } from '../i18n/index.js';
import { waitingLabel } from './attention.js';
import type { CampusRoute } from './deepLinks.js';
import { inboxPresentation } from './inboxPreferences.js';
import { attentionRoute } from './inboxV2.js';
import { taskError } from './taskErrors.js';
import type { useCampus } from './useCampus.js';

export function AttentionPanel({
  campus,
  projectId,
  navigate,
}: {
  campus: ReturnType<typeof useCampus>;
  projectId: string | null;
  navigate: (route: CampusRoute) => void;
}) {
  const { language } = useLanguage();
  const [visibleLimit, setVisibleLimit] = useState(100);
  const [view, setView] = useState('active');
  const [kind, setKind] = useState('all');
  const [groupBy, setGroupBy] = useState('project');
  const snapshot = campus.attention;
  const selected = (snapshot?.items ?? []).filter((item) => {
    if (projectId && item.fact.projectPath !== projectId) return false;
    if (
      kind !== 'all' &&
      (kind === 'error'
        ? !['error', 'queue-error'].includes(item.fact.kind)
        : item.fact.kind !== kind)
    )
      return false;
    const mark = inboxPresentation(item, campus.inboxMarks, campus.now);
    return (
      view === 'all' ||
      (view === 'active' && mark.active) ||
      (view === 'read' && mark.read) ||
      (view === 'snoozed' && mark.snoozed) ||
      (view === 'dismissed' && mark.dismissed)
    );
  });
  const groups = new Map<string, typeof selected>();
  for (const item of selected.slice(0, visibleLimit)) {
    const key =
      groupBy === 'run'
        ? JSON.stringify([item.fact.projectPath, item.fact.taskId, item.fact.runId])
        : item.fact.projectPath;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const projectName = (path: string) =>
    campus.projects.find((project) => project.id === path)?.name ?? path;
  return (
    <section className="opa-work" aria-label={t('Attention Inbox')}>
      <h2>
        {t('Attention Inbox')}{' '}
        <span className="opa-count">
          {campus.inbox.filter((item) => !projectId || item.project === projectId).length}
        </span>
      </h2>
      <p className="opa-muted">
        {t(
          'Saved facts and personal marks are separate. Reading, snoozing and dismissing never starts work or answers permissions.',
        )}
      </p>
      <p className="opa-muted">
        {t(
          'Personal marks apply to this OPA host in this browser profile. They are not shared with other users or devices.',
        )}
      </p>
      {campus.connection !== 'connected' && (
        <p role="status">
          {t(
            'Offline: showing the last received state. Actions requiring the host remain unavailable.',
          )}
        </p>
      )}
      {campus.inboxError && (
        <p role="status">
          {t(
            'Saved Inbox could not refresh. Cached facts or the current live projection remain visible.',
          )}
        </p>
      )}
      {campus.inboxStorageWarning && (
        <div role="status">
          <p>
            {t(
              'Personal Inbox marks cannot be saved in this browser. Stored data has not been replaced.',
            )}
          </p>
          <button type="button" className="opa-button" onClick={campus.resetInboxPreferences}>
            {t('Reset personal Inbox marks')}
          </button>
        </div>
      )}
      <button
        type="button"
        className="opa-button"
        disabled={campus.connection !== 'connected'}
        onClick={campus.refreshInbox}
      >
        {t('Refresh Inbox')}
      </button>
      {snapshot ? (
        <>
          <div className="opa-timeline-filters">
            <label>
              {t('Show')}
              <select
                aria-label={t('Inbox view')}
                value={view}
                onChange={(e) => {
                  setView(e.target.value);
                  setVisibleLimit(100);
                }}
              >
                {['active', 'all', 'snoozed', 'read', 'dismissed'].map((value) => (
                  <option key={value} value={value}>
                    {t(
                      {
                        active: 'Needs attention',
                        all: 'All saved facts',
                        snoozed: 'Snoozed',
                        read: 'Read',
                        dismissed: 'Dismissed',
                      }[value]!,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Kind')}
              <select
                aria-label={t('Inbox kind')}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setVisibleLimit(100);
                }}
              >
                {['all', 'blocked', 'error', 'result', 'queue-error', 'check'].map((value) => (
                  <option key={value} value={value}>
                    {t(
                      {
                        all: 'All kinds',
                        blocked: 'Permission blocks',
                        error: 'Errors',
                        result: 'Results',
                        'queue-error': 'Queue start failures',
                        check: 'Check results',
                      }[value]!,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Group by')}
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="project">{t('Project')}</option>
                <option value="run">{t('Task / attempt')}</option>
              </select>
            </label>
          </div>
          {(snapshot.limited || snapshot.droppedFacts > 0 || snapshot.droppedEventsThrough > 0) && (
            <p className="opa-notice">
              {t(
                'This Inbox is a bounded window. Older facts may be absent; open run history or Timeline for their available evidence.',
              )}
            </p>
          )}
          {!selected.length && <p role="status">{t('No items in this view.')}</p>}
          <p className="opa-muted">
            {t('Showing {count} of {total} facts', {
              count: Math.min(visibleLimit, selected.length),
              total: selected.length,
            })}
          </p>
          {[...groups].map(([key, items]) => (
            <section key={key}>
              <h3>
                {projectName(items[0].fact.projectPath)}
                {groupBy === 'run' &&
                  ` · ${items[0].fact.taskId ?? t('Unknown task')} / ${items[0].fact.runId ?? t('Unknown attempt')}`}
              </h3>
              <div className="opa-attention-list">
                {items.map((item) => {
                  const fact = item.fact;
                  const mark = inboxPresentation(item, campus.inboxMarks, campus.now);
                  const currentBlock = fact.kind === 'blocked' && item.activity === 'current';
                  const present = (action: 'read' | 'dismiss' | 'snooze' | 'restore') =>
                    campus.presentInbox(fact.id, action, snapshot.hostId, item.activity);
                  return (
                    <article key={fact.id} className="opa-attention-item">
                      <strong>
                        {fact.origin === 'queue' || fact.titleFromLegacyTask
                          ? t(fact.title)
                          : fact.title}
                      </strong>
                      <small>
                        {t(fact.state)} ·{' '}
                        {t(
                          {
                            current: 'Currently active',
                            resolved: 'Resolution recorded',
                            stale: 'No longer current; outcome may be unknown',
                            recorded: 'Saved observation',
                          }[item.activity],
                        )}
                      </small>
                      <small>
                        {t(
                          fact.origin === 'fixture'
                            ? 'Fixture / test data'
                            : fact.origin === 'live'
                              ? 'Live snapshot; not saved'
                              : 'Saved fact',
                        )}
                      </small>
                      {fact.observedAt !== undefined && (
                        <time dateTime={new Date(fact.observedAt).toISOString()}>
                          {new Date(fact.observedAt).toLocaleString(localeName(language))}
                        </time>
                      )}
                      {fact.sourceTime && (
                        <small>
                          {t('Source time')}:{' '}
                          {new Date(fact.sourceTime).toLocaleString(localeName(language))}
                        </small>
                      )}
                      {fact.code && <p>{taskError(fact.code, language)}</p>}
                      {currentBlock && <p>{waitingLabel(fact.observedAt, campus.now, language)}</p>}
                      {mark.snoozedUntil && (
                        <p>
                          {t('Snoozed until')}{' '}
                          {new Date(mark.snoozedUntil).toLocaleString(localeName(language))}
                        </p>
                      )}
                      <div className="opa-timeline-actions">
                        <button
                          type="button"
                          className="opa-button"
                          onClick={() => navigate(attentionRoute(item))}
                        >
                          {t(fact.kind === 'blocked' ? 'Review block' : 'Open result')}
                        </button>
                        <button
                          type="button"
                          className="opa-button"
                          disabled={currentBlock || mark.read}
                          onClick={() => present('read')}
                        >
                          {t('Mark read')}
                        </button>
                        <button
                          type="button"
                          className="opa-button"
                          onClick={() => present('snooze')}
                        >
                          {t('Snooze 10 minutes')}
                        </button>
                        <button
                          type="button"
                          className="opa-button"
                          disabled={currentBlock || mark.dismissed}
                          onClick={() => present('dismiss')}
                        >
                          {t('Dismiss')}
                        </button>
                        {(mark.read || mark.dismissed || mark.snoozed) && (
                          <button
                            type="button"
                            className="opa-button"
                            onClick={() => present('restore')}
                          >
                            {t('Restore personal mark')}
                          </button>
                        )}
                      </div>
                      {fact.kind === 'blocked' && (
                        <p className="opa-muted">
                          {t(
                            'Review the current task permission controls or respond in the source agent. Opening this item grants nothing.',
                          )}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {selected.length > visibleLimit && (
            <button
              type="button"
              className="opa-button"
              onClick={() => setVisibleLimit((limit) => limit + 100)}
            >
              {t('Show more Inbox items')}
            </button>
          )}
        </>
      ) : (
        <div className="opa-attention-list">
          <p role="status">
            {t('Loading saved Inbox. The live projection below remains available.')}
          </p>
          {campus.inbox
            .filter((item) => !projectId || item.project === projectId)
            .map((item) => (
              <article key={item.id} className="opa-attention-item">
                <strong>{item.title}</strong>
                <small>
                  {projectName(item.project)} · {t(item.state)}
                </small>
                {item.kind === 'blocked' && <p>{waitingLabel(item.since, campus.now, language)}</p>}
                <button type="button" className="opa-button" onClick={() => navigate(item.route)}>
                  {t(item.kind === 'blocked' ? 'Review block' : 'Open result')}
                </button>
                {item.kind !== 'blocked' && item.readId && (
                  <button
                    type="button"
                    className="opa-button"
                    onClick={() => campus.acknowledgeId(item.readId!, item.relatedEventId)}
                  >
                    {t('Mark read')}
                  </button>
                )}
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
