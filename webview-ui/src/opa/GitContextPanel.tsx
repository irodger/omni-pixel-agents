import { useEffect, useRef, useState } from 'react';

import { isGitContext, type OpaGitContext } from '../../../core/src/opa/gitContext.js';
import { localeName, t, useLanguage } from '../i18n/index.js';
import { transport } from '../transport/index.js';

export function GitObservation({ context }: { context?: OpaGitContext }) {
  const { language } = useLanguage();
  if (!context) return <p>{t('Git context was not recorded for this attempt.')}</p>;
  return (
    <div>
      <p>
        {t('Observed')}: {new Date(context.observedAt).toLocaleString(localeName(language))}
      </p>
      <dl>
        <dt>{t('Working directory')}</dt>
        <dd>{context.cwd}</dd>
        <dt>{t('Git context')}</dt>
        <dd>
          {t(
            {
              available: 'Available',
              'not-git': 'Not a Git worktree',
              unavailable: 'Unavailable',
              unstable: 'Git identity changed during observation',
            }[context.state],
          )}
        </dd>
        {context.state === 'available' && (
          <>
            <dt>{t('Worktree root')}</dt>
            <dd>{context.root}</dd>
            <dt>{t('Git common directory')}</dt>
            <dd>{context.commonDir}</dd>
            <dt>{t('Git directory')}</dt>
            <dd>{context.gitDir}</dd>
            <dt>{t('Branch')}</dt>
            <dd>{context.detached ? t('Detached HEAD') : (context.branch ?? t('Unknown'))}</dd>
            <dt>HEAD</dt>
            <dd>{context.head ?? t('No commit recorded (unborn branch)')}</dd>
            <dt>{t('Working tree changes')}</dt>
            <dd>
              {context.dirty === undefined
                ? t('Unknown (Git filters disabled)')
                : context.dirty
                  ? t('Changes present')
                  : t('No changes observed')}
            </dd>
            <dt>{t('Conflicts')}</dt>
            <dd>{context.conflicted ? t('Conflicts present') : t('No conflicts observed')}</dd>
            <dt>{t('Submodule')}</dt>
            <dd>{context.submodule ? t('Yes') : t('No')}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
export function GitContextPanel({
  projectPath,
  saved,
  after,
  taskId,
  allowRefresh = true,
}: {
  projectPath: string;
  taskId?: string;
  allowRefresh?: boolean;
  saved?: OpaGitContext;
  after?: OpaGitContext;
}) {
  const [current, setCurrent] = useState<{ project: string; context: OpaGitContext }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<
    { id: string; project: string; timer: ReturnType<typeof setTimeout> } | undefined
  >(undefined);
  useEffect(() => {
    const off = transport.onMessage((message) => {
      const active = request.current;
      if (message.type !== 'opaGitContextState' || !active || active.id !== message.requestId)
        return;
      clearTimeout(active.timer);
      request.current = undefined;
      setPending(false);
      if (message.projectPath === active.project && isGitContext(message.context)) {
        setCurrent({ project: active.project, context: message.context });
        setError(false);
      } else setError(true);
    });
    return () => {
      off();
      if (request.current) clearTimeout(request.current.timer);
    };
  }, []);
  const observed = current?.project === projectPath ? current.context : undefined;
  const identityChanged =
    saved?.state === 'available' &&
    observed?.state === 'available' &&
    ['cwd', 'root', 'gitDir', 'commonDir', 'head', 'branch'].some(
      (k) => saved[k as keyof OpaGitContext] !== observed[k as keyof OpaGitContext],
    );
  return (
    <details className="opa-task-summary">
      <summary>{t('Git context')}</summary>
      <h4>{t('At launch')}</h4>
      <GitObservation context={saved} />
      {after && (
        <>
          <h4>{t('After execution')}</h4>
          <GitObservation context={after} />
        </>
      )}
      {allowRefresh && (
        <button
          type="button"
          className="opa-button"
          disabled={pending || transport.state !== 'connected'}
          onClick={() => {
            const id = `git-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const timer = setTimeout(() => {
              request.current = undefined;
              setPending(false);
              setError(true);
            }, 15000);
            request.current = { id, project: projectPath, timer };
            setPending(true);
            setError(false);
            transport.send({ type: 'opaGitContextRequest', requestId: id, projectPath, taskId });
          }}
        >
          {t('Inspect current Git context')}
        </button>
      )}
      {error && (
        <p role="status">
          {t('Git context could not be refreshed. Saved observations are unchanged.')}
        </p>
      )}
      {observed && (
        <>
          <h4>{t('Current observation')}</h4>
          <GitObservation context={observed} />
        </>
      )}
      {identityChanged && (
        <p className="opa-notice">{t('Git identity differs from the launch observation.')}</p>
      )}
      <p className="opa-muted">
        {t(
          'Metadata only; file contents and submodule changes are not compared. No worktree is created or removed.',
        )}
      </p>
    </details>
  );
}
