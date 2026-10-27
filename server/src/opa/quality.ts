import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { OpaData } from '../../../core/src/opa/events.js';
import {
  isQualityProfile,
  type QualityPlan,
  type QualityRun,
} from '../../../core/src/opa/quality.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';
import { taskRepositoryBusy } from './execution.js';
import { OpaOffice } from './office.js';
import { fileDigest, qualityFingerprint } from './qualityFingerprint.js';
import { qualityData, saveQualityData, taskRunsPage } from './work.js';

const plans = new WeakMap<AgentStateStore, Map<string, QualityPlan>>();
const owners = new WeakMap<
  AgentStateStore,
  Map<string, { repoId: string; stop: (reason: string) => void }>
>();
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fail(code: string): never {
  throw new Error(code);
}
function program(path: string) {
  try {
    return fileDigest(realpathSync(path));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw e;
  }
}
export function qualityRepositoryBusy(store: AgentStateStore, repoId?: string) {
  return (
    !!repoId &&
    [...(owners.get(store)?.values() ?? [])].some((o) => toPathKey(o.repoId) === toPathKey(repoId))
  );
}
export function stopQualityChecks(store: AgentStateStore) {
  for (const o of owners.get(store)?.values() ?? []) o.stop('Host shutdown');
  plans.delete(store);
}
function snapshot(store: AgentStateStore, p: QualityPlan) {
  const run = taskRunsPage(store, { projectPath: p.projectPath, taskId: p.taskId, runId: p.runId })
    .runs[0];
  if (!run || run.execution.state === 'running') fail('QUALITY_ATTEMPT_UNAVAILABLE');
  const start = run.execution.gitContext;
  const cwd = run.execution.cwd ?? start?.cwd;
  if (!cwd || start?.state !== 'available' || !start.head) fail('QUALITY_CONTEXT_UNAVAILABLE');
  const result = qualityFingerprint(cwd),
    c = result.context;
  if (
    c.cwd !== start.cwd ||
    c.root !== start.root ||
    c.commonDir !== start.commonDir ||
    c.gitDir !== start.gitDir
  )
    fail('QUALITY_CONTEXT_CHANGED');
  return {
    cwd: c.cwd,
    repoId: c.commonDir!,
    base: start.head,
    head: c.head!,
    fingerprint: result.fingerprint,
  };
}
function current(store: AgentStateStore, p: QualityPlan) {
  const config = qualityData(store).configs.find((c) => c.projectPath === p.projectPath);
  const check = config?.checks.find((c) => c.id === p.check.id);
  if (!config || !check) fail('QUALITY_CONFIG_CHANGED');
  return {
    ...snapshot(store, p),
    check,
    configDigest: digest(config),
    program: program(check.executable),
  };
}
function same(p: QualityPlan, c: ReturnType<typeof current>) {
  return ['cwd', 'repoId', 'base', 'head', 'fingerprint', 'program', 'configDigest'].every(
    (k) => p[k as keyof QualityPlan] === c[k as keyof typeof c],
  );
}
function appendRun(runs: QualityRun[], run: QualityRun) {
  const next = [...runs, run];
  while (next.length > 200) {
    const i = next.findIndex((r) => r.state !== 'running');
    if (i < 0) fail('QUALITY_LIMIT');
    next.splice(i, 1);
  }
  return next;
}
function launch(store: AgentStateStore, plan: QualityPlan) {
  const map = owners.get(store) ?? new Map();
  owners.set(store, map);
  if (qualityRepositoryBusy(store, plan.repoId) || taskRepositoryBusy(store, plan.repoId))
    fail('PROJECT_BUSY');
  const record: QualityRun = {
    ...plan,
    checkRunId: randomUUID(),
    state: 'running',
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    truncated: false,
    tests: 'unreported',
  };
  const data = qualityData(store);
  if (data.runs.filter((r) => r.state === 'running').length >= 20) fail('QUALITY_LIMIT');
  data.runs = appendRun(data.runs, record);
  saveQualityData(store, data); // No process before the reservation is durably stored.
  const office = new OpaOffice(store, Date.now, {
    origin: 'task-journal',
    projectPath: plan.projectPath,
    taskId: plan.taskId,
    runId: plan.runId,
  });
  let sequence = 0;
  const event = (payload: OpaData) =>
    office.accept({
      specVersion: '0.2',
      id: randomUUID(),
      streamId: record.checkRunId,
      timestamp: new Date().toISOString(),
      provider: 'opa-quality',
      sessionId: record.checkRunId,
      agentId: record.checkRunId,
      sequence: sequence++,
      ...payload,
    });
  let sessionRecorded = false;
  let toolRecorded = false;
  let child: ChildProcess | undefined,
    timeout: ReturnType<typeof setTimeout> | undefined,
    force: ReturnType<typeof setTimeout> | undefined;
  let stopped: string | undefined,
    completed = false;
  const kill = (signal: NodeJS.Signals) => {
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      /* May already have exited. */
    }
  };
  const stop = (reason: string) => {
    if (completed || stopped) return;
    stopped = reason;
    kill('SIGTERM');
    force = setTimeout(() => kill('SIGKILL'), 2000);
    force.unref();
  };
  map.set(record.checkRunId, { repoId: plan.repoId, stop });
  const persist = () => {
    const d = qualityData(store);
    d.runs = d.runs.map((r) => (r.checkRunId === record.checkRunId ? { ...record } : r));
    saveQualityData(store, d);
  };
  const finish = (code: number | null, signal: NodeJS.Signals | null, error?: Error) => {
    if (completed) return;
    completed = true;
    if (timeout) clearTimeout(timeout);
    // A process group can outlive its leader. The owned group is terminated on cancellation/timeout.
    if (stopped) kill('SIGKILL');
    if (force) clearTimeout(force);
    map.delete(record.checkRunId);
    record.finishedAt = Date.now();
    record.exitCode = code ?? undefined;
    record.signal = signal ?? undefined;
    record.state =
      stopped === 'Timeout'
        ? 'failed'
        : stopped || error || !record.spawnedAt
          ? 'unknown'
          : code === 0
            ? 'passed'
            : code !== null
              ? 'failed'
              : 'unknown';
    record.reason =
      stopped ??
      (error
        ? 'Process could not start: ' + ((error as NodeJS.ErrnoException).code ?? 'unknown')
        : code === 0
          ? undefined
          : 'Process did not exit successfully');
    try {
      record.stale = !same(plan, current(store, plan));
    } catch {
      record.stale = true;
    }
    const d = qualityData(store);
    d.runs = d.runs.map((r) => (r.checkRunId === record.checkRunId ? { ...record } : r));
    try {
      saveQualityData(store, d, [
        {
          id: 'quality:' + record.checkRunId,
          projectPath: record.projectPath,
          kind: 'check',
          title: ('Local check · ' + record.check.name).slice(0, 500),
          state: 'Recorded ' + record.state + (record.stale ? ' · stale' : ''),
          origin: 'task-journal',
          observedAt: record.finishedAt,
          taskId: record.taskId,
          runId: record.runId,
          code: record.checkRunId,
        },
      ]);
    } catch {
      /* Durable reservation remains running and is recovered as unknown; never rerun. */
    }
    if (sessionRecorded) {
      try {
        if (toolRecorded && !error)
          event({
            type: 'tool.completed',
            toolId: record.checkRunId,
            failed: record.state !== 'passed',
          });
        event(
          record.state === 'passed'
            ? { type: 'turn.completed' }
            : { type: 'turn.failed', message: record.reason ?? record.state },
        );
        event({ type: 'session.ended' });
      } catch {
        record.reason = (
          (record.reason ? record.reason + '; ' : '') + 'Timeline write unavailable'
        ).slice(0, 500);
        try {
          persist();
        } catch {
          /* Retain the last durable observation. */
        }
      }
    }
  };
  try {
    event({
      type: 'session.started',
      cwd: plan.cwd,
      name: 'Local check · ' + plan.check.name,
      role: 'Local process, not AI',
    });
    sessionRecorded = true;
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
    );
    child = spawn(plan.check.executable, plan.check.args, {
      cwd: plan.cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.once('spawn', () => {
      record.spawnedAt = Date.now();
      try {
        persist();
        event({
          type: 'tool.started',
          toolId: record.checkRunId,
          name: plan.check.name,
          activity: 'execute',
        });
        toolRecorded = true;
      } catch {
        stop('Evidence storage failed');
      }
    });
    for (const key of ['stdout', 'stderr'] as const)
      child[key]?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const room = 8192 - record[key].length;
        record[key] += text.slice(0, room);
        if (text.length > room) record.truncated = true;
      });
    child.once('error', (e) => finish(null, null, e));
    child.once('close', (code, signal) => finish(code, signal));
    timeout = setTimeout(() => stop('Timeout'), plan.check.timeoutMs);
    timeout.unref();
  } catch (e) {
    finish(null, null, e as Error);
  }
  return record.checkRunId;
}
/** All actions, including reading private argv/logs, require host control privilege. */
export function qualityReply(store: AgentStateStore, raw: Record<string, unknown>) {
  const requestId =
    typeof raw.requestId === 'string' && raw.requestId.length <= 200 ? raw.requestId : '';
  try {
    if (
      !requestId ||
      typeof raw.projectPath !== 'string' ||
      !raw.projectPath ||
      raw.projectPath.length > 8192 ||
      raw.projectPath.includes('\0')
    )
      fail('QUALITY_QUERY_INVALID');
    const projectPath = toPathKey(raw.projectPath),
      data = qualityData(store);
    const config = data.configs.find((c) => c.projectPath === projectPath) ?? {
      projectPath,
      revision: 0,
      checks: [],
    };
    if (raw.action === 'save') {
      if (raw.expectedRevision !== config.revision) fail('QUALITY_CONFIG_CONFLICT');
      if (
        !Array.isArray(raw.checks) ||
        raw.checks.length > 20 ||
        !raw.checks.every(isQualityProfile) ||
        raw.checks.some((c) => !isAbsolute(c.executable)) ||
        new Set(raw.checks.map((c) => c.id)).size !== raw.checks.length
      )
        fail('QUALITY_CONFIG_INVALID');
      const updated = {
        projectPath,
        revision: config.revision + 1,
        checks: raw.checks.map((c) => ({
          id: c.id,
          name: c.name,
          executable: c.executable,
          args: [...c.args],
          timeoutMs: c.timeoutMs,
        })),
      };
      data.configs = [...data.configs.filter((c) => c.projectPath !== projectPath), updated];
      saveQualityData(store, data);
      plans.delete(store);
      return { type: 'opaQualityState' as const, requestId, config: updated, runs: [] };
    }
    if (
      typeof raw.taskId !== 'string' ||
      !raw.taskId ||
      raw.taskId.length > 200 ||
      typeof raw.runId !== 'string' ||
      !raw.runId ||
      raw.runId.length > 200
    )
      fail('QUALITY_QUERY_INVALID');
    const selected = { projectPath, taskId: raw.taskId, runId: raw.runId };
    // Verify the exact attempt exists even for cancel/query; no newest-attempt fallback.
    taskRunsPage(store, selected);
    if (raw.action === 'query') {
      const rows = data.runs.filter(
        (r) => r.projectPath === projectPath && r.taskId === raw.taskId && r.runId === raw.runId,
      );
      let observed: ReturnType<typeof snapshot> | undefined;
      try {
        if (rows.length) observed = snapshot(store, rows[0]);
      } catch {
        /* Unavailable means stale, never a substituted cwd. */
      }
      const programs = new Map<string, string | undefined>();
      const runs = rows.map((r) => {
        const check = config.checks.find((c) => c.id === r.check.id);
        let c: ReturnType<typeof current> | undefined;
        if (check && observed) {
          if (!programs.has(check.executable)) {
            try {
              programs.set(check.executable, program(check.executable));
            } catch {
              programs.set(check.executable, undefined);
            }
          }
          const executableDigest = programs.get(check.executable);
          if (executableDigest)
            c = { ...observed, check, configDigest: digest(config), program: executableDigest };
        }
        return {
          ...r,
          ...(r.state === 'running' && !owners.get(store)?.has(r.checkRunId)
            ? { state: 'unknown' as const, reason: 'Process ownership or final observation lost' }
            : {}),
          stale: !!r.stale || !c || !same(r, c),
        };
      });
      return { type: 'opaQualityState' as const, requestId, config, runs };
    }
    if (raw.action === 'cancel') {
      const r = data.runs.find(
        (r) =>
          r.checkRunId === raw.checkRunId &&
          r.projectPath === projectPath &&
          r.taskId === raw.taskId &&
          r.runId === raw.runId,
      );
      const owner = r && owners.get(store)?.get(r.checkRunId);
      if (!owner) fail('QUALITY_NOT_OWNED');
      owner.stop('Cancelled by user');
      return { type: 'opaQualityState' as const, requestId, config, runs: [] };
    }
    if (raw.action === 'prepare') {
      const check = config.checks.find((c) => c.id === raw.checkId);
      if (!check) fail('QUALITY_CHECK_NOT_FOUND');
      const seed = { ...selected, check } as QualityPlan;
      const c = current(store, seed);
      if (qualityRepositoryBusy(store, c.repoId) || taskRepositoryBusy(store, c.repoId))
        fail('PROJECT_BUSY');
      const plan: QualityPlan = {
        ...selected,
        ...c,
        id: randomUUID(),
        expiresAt: Date.now() + 60000,
      };
      const map = plans.get(store) ?? new Map();
      for (const [id, p] of map) if (p.expiresAt < Date.now()) map.delete(id);
      if (map.size >= 20) fail('QUALITY_LIMIT');
      map.set(plan.id, plan);
      plans.set(store, map);
      return {
        type: 'opaQualityState' as const,
        requestId,
        config,
        runs: [],
        plan: structuredClone(plan),
      };
    }
    if (raw.action === 'skip') {
      const check = config.checks.find((c) => c.id === raw.checkId);
      if (!check) fail('QUALITY_CHECK_NOT_FOUND');
      const c = current(store, { ...selected, check } as QualityPlan);
      const r: QualityRun = {
        ...selected,
        ...c,
        id: randomUUID(),
        expiresAt: Date.now(),
        checkRunId: randomUUID(),
        state: 'skipped',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        reason: 'Explicitly skipped by user',
        stdout: '',
        stderr: '',
        truncated: false,
        tests: 'unreported',
      };
      data.runs = appendRun(data.runs, r);
      saveQualityData(store, data);
      return { type: 'opaQualityState' as const, requestId, config, runs: [r] };
    }
    if (raw.action === 'run') {
      const map = plans.get(store),
        plan = typeof raw.planId === 'string' ? map?.get(raw.planId) : undefined;
      if (
        !plan ||
        raw.approved !== true ||
        plan.expiresAt < Date.now() ||
        plan.projectPath !== projectPath ||
        plan.taskId !== raw.taskId ||
        plan.runId !== raw.runId
      )
        fail('QUALITY_APPROVAL_REQUIRED');
      map!.delete(plan.id); // One attempt only, including failed dispatch/storage/acknowledgement.
      if (!same(plan, current(store, plan))) fail('QUALITY_PLAN_STALE');
      const checkRunId = launch(store, plan);
      return { type: 'opaQualityState' as const, requestId, config, runs: [], checkRunId };
    }
    fail('QUALITY_ACTION_INVALID');
  } catch (e) {
    return {
      type: 'opaQualityState' as const,
      requestId,
      error: e instanceof Error ? e.message : 'QUALITY_UNAVAILABLE',
    };
  }
}
