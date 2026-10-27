import { useEffect, useRef, useState } from 'react';

import type { OpaQualityCommand } from '../../../core/src/messages.js';
import {
  isQualityData,
  isQualityPlan,
  type QualityConfig,
  type QualityPlan,
  type QualityRun,
} from '../../../core/src/opa/quality.js';
import { t } from '../i18n/index.js';
import { transport } from '../transport/index.js';

/** Preparing, reconnecting, loading history and refreshing never launch a command. */
export function QualityPanel({
  projectPath,
  taskId,
  runId,
}: {
  projectPath: string;
  taskId: string;
  runId: string;
}) {
  const [config, setConfig] = useState<QualityConfig>();
  const [rows, setRows] = useState<QualityRun[]>([]);
  const [plan, setPlan] = useState<QualityPlan>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('Local check');
  const [executable, setExecutable] = useState('');
  const [argv, setArgv] = useState('[]');
  const [timeout, setTimeoutMs] = useState(60000);
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | undefined>(
    undefined,
  );
  useEffect(() => {
    const off = transport.onMessage((message) => {
      if (message.type !== 'opaQualityState' || message.requestId !== pending.current?.id) return;
      clearTimeout(pending.current.timer);
      pending.current = undefined;
      setBusy(false);
      setPlan(undefined);
      if (message.error) {
        setError(message.error);
        return;
      }
      if (
        !isQualityData({ version: 1, configs: [message.config], runs: message.runs ?? [] }) ||
        message.config?.projectPath !== projectPath ||
        message.runs?.some(
          (r) => r.projectPath !== projectPath || r.taskId !== taskId || r.runId !== runId,
        )
      ) {
        setError('Invalid check response');
        return;
      }
      setError('');
      setNotice(
        message.checkRunId ? t('Check accepted. Refresh to see its recorded outcome.') : '',
      );
      setConfig(message.config);
      setRows(message.runs ?? []);
      if (
        isQualityPlan(message.plan) &&
        message.plan.projectPath === projectPath &&
        message.plan.taskId === taskId &&
        message.plan.runId === runId
      )
        setPlan(message.plan);
    });
    const state = transport.onStateChange(() => {
      setPlan(undefined);
    });
    return () => {
      off();
      state();
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = undefined;
    };
  }, [projectPath, taskId, runId]);
  const send = (action: OpaQualityCommand['action'], extra: Partial<OpaQualityCommand> = {}) => {
    if (busy || transport.state !== 'connected') return;
    const id = crypto.randomUUID();
    setBusy(true);
    setError('');
    setPlan(undefined);
    pending.current = {
      id,
      timer: setTimeout(() => {
        pending.current = undefined;
        setBusy(false);
        setError('No acknowledgement. Refresh history before preparing another run.');
      }, 30000),
    };
    transport.send({
      type: 'opaQualityCommand',
      requestId: id,
      projectPath,
      taskId,
      runId,
      action,
      ...extra,
    });
  };
  const save = () => {
    try {
      const args: unknown = JSON.parse(argv);
      if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) throw Error();
      const id = crypto.randomUUID();
      send('save', {
        expectedRevision: config!.revision,
        checks: [...config!.checks, { id, name, executable, args, timeoutMs: timeout }],
      });
    } catch {
      setError('Arguments must be a JSON array of strings.');
    }
  };
  return (
    <details className="opa-summary">
      <summary>{t('Quality Gates')}</summary>
      <p>
        {t(
          'Local commands require a separate confirmation for each run. Saving and refreshing do not execute them.',
        )}
      </p>
      <button disabled={busy} onClick={() => send('query')}>
        {t('Refresh checks')}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {config && (
        <>
          <details>
            <summary>{t('Add trusted local check')}</summary>
            <label>
              {t('Check name')}
              <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {t('Absolute executable path')}
              <input value={executable} onChange={(e) => setExecutable(e.target.value)} />
            </label>
            <label>
              {t('Arguments as JSON array')}
              <textarea value={argv} onChange={(e) => setArgv(e.target.value)} />
            </label>
            <label>
              {t('Timeout in milliseconds')}
              <input
                type="number"
                min={100}
                max={600000}
                value={timeout}
                onChange={(e) => setTimeoutMs(Number(e.target.value))}
              />
            </label>
            <button disabled={busy || config.checks.length >= 20} onClick={save}>
              {t('Save check without running')}
            </button>
          </details>
          {config.checks.map((c) => (
            <div key={c.id}>
              <strong>{c.name}</strong>
              <pre>{JSON.stringify([c.executable, ...c.args])}</pre>
              <button disabled={busy} onClick={() => send('prepare', { checkId: c.id })}>
                {t('Review run')}
              </button>
              <button disabled={busy} onClick={() => send('skip', { checkId: c.id })}>
                {t('Skip check')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  send('save', {
                    expectedRevision: config.revision,
                    checks: config.checks.filter((x) => x.id !== c.id),
                  })
                }
              >
                {t('Remove check')}
              </button>
            </div>
          ))}
        </>
      )}
      {plan && (
        <section aria-label={t('Confirm local command')}>
          <h4>{t('Confirm local command')}</h4>
          <pre>{JSON.stringify([plan.check.executable, ...plan.check.args], null, 2)}</pre>
          <dl>
            <dt>{t('Working directory')}</dt>
            <dd>{plan.cwd}</dd>
            <dt>{t('Base commit')}</dt>
            <dd>{plan.base}</dd>
            <dt>{t('Target commit')}</dt>
            <dd>{plan.head}</dd>
            <dt>{t('File fingerprint')}</dt>
            <dd>{plan.fingerprint}</dd>
            <dt>{t('Configuration digest')}</dt>
            <dd>{plan.configDigest}</dd>
            <dt>{t('Executable digest')}</dt>
            <dd>{plan.program}</dd>
            <dt>{t('Timeout in milliseconds')}</dt>
            <dd>{plan.check.timeoutMs}</dd>
          </dl>
          <p>
            {t(
              'Runs with your local permissions, without a sandbox. Review the command and project scripts. Approval expires in 60 seconds.',
            )}
          </p>
          <button disabled={busy} onClick={() => send('run', { planId: plan.id, approved: true })}>
            {t('Approve and run once')}
          </button>
          <button onClick={() => setPlan(undefined)}>{t('Dismiss')}</button>
        </section>
      )}
      {rows.map((r) => (
        <QualityRunContent
          key={r.checkRunId}
          r={r}
          busy={busy}
          onCancel={() => send('cancel', { checkRunId: r.checkRunId })}
        />
      ))}
      <p className="opa-muted">
        {t(
          'Refresh to observe completion and freshness. Ignored files, dependencies, environment and external symlink targets are outside the fingerprint. This is not a hermetic snapshot.',
        )}
      </p>
    </details>
  );
}

export function QualityRunContent({
  r,
  busy = false,
  onCancel,
}: {
  r: QualityRun;
  busy?: boolean;
  onCancel?: () => void;
}) {
  return (
    <section aria-label={r.check.name}>
      <h4>
        {r.check.name}: {r.state}
        {r.stale ? ' · ' + t('stale') : ''}
      </h4>
      <p>{r.reason}</p>
      <p>
        {t(
          'Tests executed and test count: unreported. Exit zero alone does not establish test coverage.',
        )}
      </p>
      <pre>
        {JSON.stringify(
          {
            checkRunId: r.checkRunId,
            cwd: r.cwd,
            base: r.base,
            head: r.head,
            fingerprint: r.fingerprint,
            command: [r.check.executable, ...r.check.args],
            startedAt: r.startedAt,
            spawnedAt: r.spawnedAt,
            finishedAt: r.finishedAt,
            exitCode: r.exitCode,
            signal: r.signal,
          },
          null,
          2,
        )}
      </pre>
      <pre className="opa-result-output">
        {r.stdout}
        {r.stderr ? '\n[stderr]\n' + r.stderr : ''}
      </pre>
      {r.truncated && <p>{t('Output truncated at 8192 characters per stream.')}</p>}
      {r.state === 'running' && (
        <button disabled={busy} onClick={onCancel}>
          {t('Cancel check')}
        </button>
      )}
    </section>
  );
}
