import { useState } from 'react';

import type { OpaTask, OpaTaskCommand, TaskStatus } from '../../../core/src/opa/work.js';
import { taskStatuses } from '../../../core/src/opa/work.js';
import { localeName, t, useLanguage } from '../i18n/index.js';
import type { UsagePeriod } from './usage.js';
import { summarizeUsage, usageCsv, usageForPeriod } from './usage.js';
import type { useCampus } from './useCampus.js';

const statusLabels = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export function WorkPanel({
  campus,
  projectId,
  view,
  readOnly,
}: {
  campus: ReturnType<typeof useCampus>;
  projectId: string | null;
  view: 'tasks' | 'usage';
  readOnly: boolean;
}) {
  const { language } = useLanguage();
  const [title, setTitle] = useState('');
  const [newProject, setNewProject] = useState('');
  const [assignee, setAssignee] = useState('');
  const [editing, setEditing] = useState<OpaTask | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [status, setStatus] = useState<TaskStatus | 'all'>('all');
  const [period, setPeriod] = useState<UsagePeriod>('all');
  const disabled = readOnly || campus.connection !== 'connected' || pending;
  const tasks = campus.tasks.filter(
    (task) =>
      (!projectId || task.projectPath === projectId) &&
      (status === 'all' || task.status === status),
  );
  const projectName = (id: string) => campus.projects.find((p) => p.id === id)?.name ?? id;
  const send = async (command: Omit<OpaTaskCommand, 'requestId'>) => {
    setPending(true);
    setError('');
    setSuccess(false);
    try {
      await campus.saveTask(command);
      setSuccess(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'TASK_INVALID');
      return false;
    } finally {
      setPending(false);
    }
  };
  const editTask = (task: OpaTask) => {
    setEditing(task);
    setTitle(task.title);
    setAssignee(task.assignee ?? '');
    setError('');
    setSuccess(false);
  };
  if (view === 'tasks')
    return (
      <section className="opa-work" aria-label={t('Tasks')}>
        <h2>{t('Tasks')}</h2>
        <p className="opa-muted">{t('Tasks are shared by project and survive server restarts.')}</p>
        {readOnly && (
          <p className="opa-notice">
            {t('Read-only. Open the management link printed by the server to edit tasks.')}
          </p>
        )}
        <form
          className="opa-task-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const projectPath = editing?.projectPath ?? projectId ?? newProject.trim();
            if (!projectPath || disabled) return;
            if (
              await send({
                action: editing ? 'update' : 'create',
                projectPath,
                title,
                assignee,
                taskId: editing?.id,
                expectedRevision: editing?.revision,
              })
            ) {
              setTitle('');
              setAssignee('');
              setEditing(null);
            }
          }}
        >
          {!projectId && !editing && (
            <label>
              {t('Project folder')}
              <input
                aria-label={t('Project folder')}
                value={newProject}
                disabled={disabled}
                placeholder="/path/to/project"
                onChange={(e) => setNewProject(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            {editing ? t('Edit task') : t('New task')}
            <input
              aria-label={t('Task title')}
              value={title}
              maxLength={2000}
              required
              disabled={disabled}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            {t('Assignee')}
            <select
              aria-label={t('Assignee')}
              value={assignee}
              disabled={disabled}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">{t('Unassigned')}</option>
              {campus.executors.map((executor) => (
                <option key={executor.id} value={executor.id}>
                  {executor.name}
                </option>
              ))}
              {assignee && !campus.executors.some((e) => e.id === assignee) && (
                <option value={assignee} disabled>
                  {assignee} — {t('Unavailable')}
                </option>
              )}
            </select>
          </label>
          <button
            className="opa-button"
            disabled={disabled || !title.trim() || (!projectId && !editing && !newProject.trim())}
          >
            {editing ? t('Save changes') : t('Add task')}
          </button>
          {editing && (
            <button
              type="button"
              className="opa-button"
              disabled={pending}
              onClick={() => {
                setEditing(null);
                setTitle('');
                setAssignee('');
              }}
            >
              {t('Cancel')}
            </button>
          )}
        </form>
        {!projectId && !editing && (
          <p className="opa-notice">
            {t('Select an office above or enter an existing project folder.')}
          </p>
        )}
        <p className="opa-muted">
          {t('Choosing an executor starts the task in its project. Agent usage may incur costs.')}
        </p>
        {!campus.executors.length && (
          <p className="opa-notice">
            {t('No installed executors found. Install Codex or OpenCode and restart OPA.')}
          </p>
        )}
        {error && (
          <p className="opa-error-detail" role="alert">
            {t(error)}
          </p>
        )}
        {success && (
          <p className="opa-all-clear" role="status">
            {t('Task saved.')}
          </p>
        )}
        <label className="opa-filter">
          {t('Show')}{' '}
          <select
            aria-label={t('Task status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus | 'all')}
          >
            <option value="all">{t('All tasks')}</option>
            {taskStatuses.map((s) => (
              <option key={s} value={s}>
                {t(statusLabels[s])}
              </option>
            ))}
          </select>
        </label>
        {!tasks.length && <p className="opa-empty">{t('No tasks yet.')}</p>}
        <div className="opa-task-list">
          {tasks
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((task) => (
              <article key={`${task.projectPath}:${task.id}`} className="opa-task">
                <div>
                  <h3>{task.title}</h3>
                  <p className="opa-muted">
                    {projectName(task.projectPath)} ·{' '}
                    {campus.executors.find((e) => e.id === task.assignee)?.name ||
                      task.assignee ||
                      t('Unassigned')}
                  </p>
                </div>
                {task.execution && (
                  <div className="opa-muted">
                    <p>
                      {t('Execution')}: {t(task.execution.state)}
                    </p>
                    {task.execution.state === 'running' &&
                      task.execution.permissions?.map((permission) => (
                        <div key={permission.id} className="opa-notice">
                          <p>{permission.title}</p>
                          {permission.options.map((option) => (
                            <button
                              type="button"
                              className="opa-button"
                              key={option.optionId}
                              disabled={disabled}
                              onClick={() =>
                                void send({
                                  action: 'permission',
                                  projectPath: task.projectPath,
                                  taskId: task.id,
                                  runId: task.execution!.runId,
                                  permissionId: permission.id,
                                  optionId: option.optionId,
                                })
                              }
                            >
                              {option.name} ({option.kind})
                            </button>
                          ))}
                        </div>
                      ))}
                    {task.execution.error && <p role="alert">{task.execution.error}</p>}
                    {task.execution.output && (
                      <details>
                        <summary>{t('Result')}</summary>
                        <pre style={{ whiteSpace: 'pre-wrap' }}>{task.execution.output}</pre>
                      </details>
                    )}
                    {['failed', 'interrupted', 'cancelled'].includes(task.execution.state) && (
                      <button
                        className="opa-button"
                        disabled={disabled || !campus.executors.some((e) => e.id === task.assignee)}
                        onClick={() =>
                          void send({
                            action: 'update',
                            projectPath: task.projectPath,
                            taskId: task.id,
                            expectedRevision: task.revision,
                            launch: true,
                            status: 'open',
                          })
                        }
                      >
                        {t('Retry task')}
                      </button>
                    )}
                  </div>
                )}
                <select
                  aria-label={`${t('Task status')}: ${task.title}`}
                  value={task.status}
                  disabled={disabled}
                  onChange={(e) =>
                    void send({
                      action: 'update',
                      projectPath: task.projectPath,
                      taskId: task.id,
                      expectedRevision: task.revision,
                      status: e.target.value as TaskStatus,
                    })
                  }
                >
                  {taskStatuses.map((s) => (
                    <option key={s} value={s}>
                      {t(statusLabels[s])}
                    </option>
                  ))}
                </select>
                <button className="opa-button" disabled={disabled} onClick={() => editTask(task)}>
                  {t('Edit task')}
                </button>
              </article>
            ))}
        </div>
      </section>
    );

  const rows = usageForPeriod(
    campus.usage.filter((u) => !projectId || u.projectPath === projectId),
    period,
    new Date(campus.now),
  );
  const summary = summarizeUsage(rows);
  const locale = localeName(language);
  const number = (v: number) => new Intl.NumberFormat(locale).format(v);
  const money = (v: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(v);
  return (
    <section className="opa-work" aria-label={t('Usage & costs')}>
      <div className="opa-section-heading">
        <h2>{t('Usage & costs')}</h2>
        <button
          className="opa-button"
          disabled={!rows.length}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([usageCsv(rows)], { type: 'text/csv;charset=utf-8' }),
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = 'opa-usage.csv';
            a.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          {t('Export CSV')}
        </button>
      </div>
      <label className="opa-filter">
        {t('Period')}{' '}
        <select
          aria-label={t('Period')}
          value={period}
          onChange={(e) => setPeriod(e.target.value as UsagePeriod)}
        >
          <option value="all">{t('All time')}</option>
          <option value="today">{t('Today')}</option>
          <option value="month">{t('This month')}</option>
        </select>
      </label>
      <div className="opa-usage-summary">
        <div>
          <small>{t('Input tokens')}</small>
          <strong>{number(summary.input)}</strong>
        </div>
        <div>
          <small>{t('Output tokens')}</small>
          <strong>{number(summary.output)}</strong>
        </div>
        <div>
          <small>{t('Cached input')}</small>
          <strong>{number(summary.cached)}</strong>
        </div>
        <div>
          <small>{t('Reported cost')}</small>
          <strong>{summary.reportedCount ? money(summary.reported) : '—'}</strong>
        </div>
        <div>
          <small>{t('Estimated cost')}</small>
          <strong>{summary.estimatedCount ? money(summary.estimated) : '—'}</strong>
        </div>
        <div>
          <small>{t('Unknown cost')}</small>
          <strong>
            {number(summary.unknownCount)} / {number(rows.length)}
          </strong>
        </div>
      </div>
      <p className="opa-muted">
        {t('Unknown amounts are not counted as zero. These figures are not invoices.')}
      </p>
      {!rows.length ? (
        <p className="opa-empty">{t('No data for this period.')}</p>
      ) : (
        <div className="opa-table-scroll">
          <table className="opa-usage-table">
            <thead>
              <tr>
                {['Date', 'Project', 'Source', 'Model', 'Tokens', 'Cost'].map((key) => (
                  <th key={key}>{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
                .map((u) => (
                  <tr key={`${u.provider}:${u.sessionId}:${u.usageId}`}>
                    <td>
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(new Date(u.timestamp))}
                    </td>
                    <td title={u.projectPath}>{projectName(u.projectPath)}</td>
                    <td>{u.provider}</td>
                    <td>{u.model || '—'}</td>
                    <td>
                      {number(u.inputTokens)} / {number(u.outputTokens)}
                    </td>
                    <td>
                      {u.cost ? (
                        <>
                          {money(u.cost.amount)}
                          <small>
                            {t(u.cost.kind === 'estimated' ? 'Estimated cost' : 'Reported cost')}
                          </small>
                        </>
                      ) : (
                        t('Unknown cost')
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
