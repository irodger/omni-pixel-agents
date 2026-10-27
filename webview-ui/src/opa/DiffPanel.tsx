import { useEffect, useRef, useState } from 'react';

import { isDiffSnapshot, type OpaDiffSnapshot } from '../../../core/src/opa/diff.js';
import { t } from '../i18n/index.js';
import { transport } from '../transport/index.js';
import { vscodeProjectLink } from './deepLinks.js';

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    READ_ONLY: 'Diff contents require the host control link or the VS Code extension.',
    DIFF_END_CONTEXT_UNAVAILABLE:
      'No verified end commit was recorded. Historical committed changes are unavailable.',
    DIFF_CONTEXT_UNAVAILABLE:
      'The saved Git context is unavailable, moved or deleted. No substitute worktree was used.',
    DIFF_STALE: 'Changes differ from the displayed snapshot. Refresh the file list.',
    DIFF_CONTEXT_CHANGED: 'Git or file contents changed while reading. Refresh the file list.',
    DIFF_TOO_LARGE: 'The diff exceeds the 2 MiB read limit. Review it in your local Git client.',
    DIFF_TOO_MANY_FILES: 'More than 200 files changed. Review this diff in your local Git client.',
  };
  return t(messages[code] ?? 'Diff could not be read. Check the connection and saved Git context.');
}
export function DiffContent({ result }: { result: OpaDiffSnapshot }) {
  const selected = result.files.find((f) => f.path === result.path);
  const ide = selected?.openPath ? vscodeProjectLink(selected.openPath) : null;
  return (
    <>
      <p>
        {t(
          result.mode === 'committed'
            ? 'Recorded commit range'
            : 'Current changes, not a historical dirty snapshot',
        )}
      </p>
      <dl>
        <dt>{t('Working directory')}</dt>
        <dd>{result.cwd}</dd>
        <dt>{t('Base commit')}</dt>
        <dd>{result.base}</dd>
        <dt>{t('Target commit')}</dt>
        <dd>{result.head}</dd>
      </dl>
      {result.stale && (
        <p className="opa-notice">
          {t(
            'Current HEAD or branch differs from the saved attempt. The committed range remains anchored to its recorded commits.',
          )}
        </p>
      )}
      <p className="opa-muted">
        {t(
          'Changes may include edits made outside this run. Historical dirty file contents were not saved. Binary and untracked contents are not captured by this text snapshot.',
        )}
      </p>
      {result.filtersDisabled && (
        <p>
          {t(
            'Git filters are disabled. Text comparison uses raw file contents, not filtered content.',
          )}
        </p>
      )}
      {selected && (
        <section aria-label={t('Selected file diff')}>
          <h4>
            {selected.oldPath ? selected.oldPath + ' → ' : ''}
            {selected.path}
          </h4>
          {selected.binary ? (
            <p>{t('Binary file: text preview unavailable.')}</p>
          ) : selected.untracked ? (
            <p>{t('Untracked file: contents are not read by this viewer.')}</p>
          ) : (
            <pre
              className="opa-result-output"
              style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap' }}
            >
              {result.patch ?? ''}
            </pre>
          )}
          {result.truncated && <p>{t('Preview truncated at 128 Ki characters.')}</p>}
          {ide && (
            <a className="opa-button" href={ide}>
              {t('Open current file in VS Code')}
            </a>
          )}
        </section>
      )}
    </>
  );
}
export function DiffPanel({
  projectPath,
  taskId,
  runId,
}: {
  projectPath: string;
  taskId: string;
  runId: string;
}) {
  const [result, setResult] = useState<OpaDiffSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef<
    | {
        id: string;
        mode: OpaDiffSnapshot['mode'];
        path?: string;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    const off = transport.onMessage((message) => {
      const pending = request.current;
      if (message.type !== 'opaDiffState' || !pending || message.requestId !== pending.id) return;
      clearTimeout(pending.timer);
      request.current = undefined;
      setBusy(false);
      if (
        isDiffSnapshot(message.result) &&
        message.result.projectPath === projectPath &&
        message.result.taskId === taskId &&
        message.result.runId === runId &&
        message.result.mode === pending.mode &&
        message.result.path === pending.path
      ) {
        setResult(message.result);
        setError('');
      } else {
        setResult(undefined);
        setError(message.error ?? 'DIFF_UNAVAILABLE');
      }
    });
    return () => {
      off();
      if (request.current) clearTimeout(request.current.timer);
      request.current = undefined;
    };
  }, [projectPath, taskId, runId]);
  const load = (mode: OpaDiffSnapshot['mode'], path?: string) => {
    if (busy || transport.state !== 'connected') return;
    const id = crypto.randomUUID(),
      expectedSnapshot = path ? result?.snapshot : undefined;
    const timer = setTimeout(() => {
      request.current = undefined;
      setBusy(false);
      setError('DIFF_UNAVAILABLE');
      setResult(undefined);
    }, 20000);
    request.current = { id, mode, path, timer };
    setBusy(true);
    setError('');
    if (!path) setResult(undefined);
    transport.send({
      type: 'opaDiffRequest',
      requestId: id,
      projectPath,
      taskId,
      runId,
      mode,
      path,
      expectedSnapshot,
    });
  };
  return (
    <details className="opa-task-summary">
      <summary>{t('Git diff')}</summary>
      <button
        className="opa-button"
        disabled={busy || transport.state !== 'connected'}
        onClick={() => load('committed')}
      >
        {t('Show recorded commit diff')}
      </button>
      <button
        className="opa-button"
        disabled={busy || transport.state !== 'connected'}
        onClick={() => load('working')}
      >
        {t('Show current changes')}
      </button>
      {busy && <p role="status">{t('Reading diff…')}</p>}
      {error && <p role="alert">{errorMessage(error)}</p>}
      {result && (
        <>
          <DiffContent result={result} />
          <p>
            {t('Files')}: {result.files.length}
          </p>
          {result.files.map((file) => (
            <div key={file.path}>
              <button
                className="opa-button"
                disabled={busy}
                onClick={() => load(result.mode, file.path)}
              >
                {file.oldPath ? file.oldPath + ' → ' : ''}
                {file.path}{' '}
                {file.untracked
                  ? t('Untracked')
                  : file.binary
                    ? t('Binary')
                    : `+${file.added} −${file.deleted}`}
              </button>
            </div>
          ))}
        </>
      )}
      <p className="opa-muted">
        {t(
          'Read-only. Opening or refreshing a diff does not stage, commit, merge, approve or run checks.',
        )}
      </p>
    </details>
  );
}
