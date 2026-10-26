import { useState } from 'react';

import type { OpaTask } from '../../../core/src/opa/work.js';
import type { OpaWorktreeCommand } from '../../../core/src/opa/worktree.js';
import { t } from '../i18n/index.js';
import { vscodeProjectLink } from './deepLinks.js';

export function WorktreePanel({
  task,
  disabled,
  save,
}: {
  task: OpaTask;
  disabled: boolean;
  save: (command: Omit<OpaWorktreeCommand, 'requestId'>) => Promise<void>;
}) {
  const [path, setPath] = useState(''),
    [branch, setBranch] = useState(''),
    [head, setHead] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const blocked = disabled || busy || task.execution?.state === 'running';
  const ide = vscodeProjectLink(task.worktree?.cwd ?? task.projectPath);
  const submit = async (action: OpaWorktreeCommand['action']) => {
    const message =
      action === 'detach'
        ? t('Detach the task binding? Worktree files and branch will be kept.')
        : t(
            'Set up this worktree without starting an agent? Review the folder, branch and commit below.',
          );
    if (
      !window.confirm(
        `${message}\n${action === 'detach' ? task.worktree?.cwd : path}\n${branch}\n${head}`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await save({
        projectPath: task.projectPath,
        taskId: task.id,
        expectedRevision: task.revision,
        action,
        ...(action === 'detach'
          ? {}
          : { path, expectedHead: head, ...(action === 'create' ? { branch } : {}) }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'WORKTREE_INVALID');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="opa-task-summary">
      <summary>{t('Task worktree')}</summary>
      <p>
        {t(
          'Setup is separate from Start. No automatic merge or cleanup; one run per repository remains the limit.',
        )}
      </p>
      {task.worktree ? (
        <dl>
          <dt>{t('Working directory')}</dt>
          <dd>{task.worktree.cwd}</dd>
          <dt>{t('Branch')}</dt>
          <dd>{task.worktree.branch ?? t('Detached HEAD')}</dd>
          <dt>{t('Base commit')}</dt>
          <dd>{task.worktree.baseCommit}</dd>
        </dl>
      ) : (
        <p>{t('No isolated worktree is bound. Start uses the project directory.')}</p>
      )}
      {ide && (
        <a className="opa-button" href={ide}>
          {t('Open working directory in VS Code')}
        </a>
      )}
      {task.worktree && (
        <button className="opa-button" disabled={blocked} onClick={() => void submit('detach')}>
          {t('Detach binding (keep files)')}
        </button>
      )}
      <label>
        {t('Absolute worktree folder')}
        <input value={path} disabled={blocked} onChange={(e) => setPath(e.target.value)} />
      </label>
      <label>
        {t('Expected full commit ID')}
        <input value={head} disabled={blocked} onChange={(e) => setHead(e.target.value)} />
      </label>
      <label>
        {t('New branch (create only)')}
        <input value={branch} disabled={blocked} onChange={(e) => setBranch(e.target.value)} />
      </label>
      <button
        className="opa-button"
        disabled={blocked || !path || !head || !branch || !!task.worktree}
        onClick={() => void submit('create')}
      >
        {t('Create worktree and bind')}
      </button>
      <button
        className="opa-button"
        disabled={blocked || !path || !head}
        onClick={() => void submit('attach')}
      >
        {t('Attach existing worktree')}
      </button>
      <p className="opa-muted">
        {t(
          'Create needs an unused folder outside repositories and the current project HEAD. Attach needs the target HEAD. Dirty files are kept. Changed Git identity requires explicit reattachment before Start.',
        )}
      </p>
      {error && (
        <p role="alert">
          {t(
            'Worktree setup was not confirmed. Refresh task state and inspect the folder before retrying; files are never removed automatically.',
          )}{' '}
          <span>{t(error)}</span>
        </p>
      )}
    </details>
  );
}
