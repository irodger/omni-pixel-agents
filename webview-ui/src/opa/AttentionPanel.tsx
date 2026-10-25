import { t, useLanguage } from '../i18n/index.js';
import { waitingLabel } from './attention.js';
import type { CampusRoute } from './deepLinks.js';
import { inboxItems } from './inbox.js';
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
  const items = inboxItems(campus.projects, campus.tasks, campus.seen).filter(
    (item) => !projectId || item.project === projectId,
  );
  return (
    <section className="opa-work" aria-label={t('Attention Inbox')}>
      <h2>
        {t('Attention Inbox')} <span className="opa-count">{items.length}</span>
      </h2>
      <p className="opa-muted">
        {t('Blocks first, then errors and unread results. Reading never approves or starts work.')}
      </p>
      {campus.connection !== 'connected' && (
        <p role="status">
          {t(
            'Offline: showing the last received state. Actions requiring the host remain unavailable.',
          )}
        </p>
      )}
      {!items.length && (
        <p className="opa-all-clear" role="status">
          {t('All caught up.')}
        </p>
      )}
      <div className="opa-attention-list">
        {items.map((item) => (
          <article key={item.id} className="opa-attention-item">
            <strong>{item.title}</strong>
            <small>
              {campus.projects.find((p) => p.id === item.project)?.name ?? item.project} ·{' '}
              {t(item.state)}
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
            {item.kind === 'blocked' && (
              <p className="opa-muted">
                {t(
                  'Review the current task permission controls or respond in the source agent. Opening this item grants nothing.',
                )}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
