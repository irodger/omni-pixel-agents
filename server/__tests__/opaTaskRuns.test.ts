import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaTask, OpaWorkData, TaskExecution } from '../../core/src/opa/work.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { createHttpServer } from '../src/httpServer.js';
import {
  changeTask,
  opaWorkSnapshot,
  taskRunsPage,
  taskRunsReply,
  updateTaskExecution,
} from '../src/opa/work.js';

function fixture(initial: OpaWorkData = { tasks: [], usage: [] }) {
  let saved = structuredClone(initial);
  const save = vi.fn((next: OpaWorkData) => {
    saved = structuredClone(next);
  });
  const adapter = {
    loadOpaWork: () => structuredClone(saved),
    saveOpaWork: save,
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_: string, fallback: unknown) => fallback,
    setSetting: () => {},
  } as StateAdapter;
  const restart = () => {
    const store = new AgentStateStore();
    store.setAdapter(adapter);
    return store;
  };
  return { store: restart(), restart, save, adapter, persisted: () => saved };
}
const legacyTask: OpaTask = {
  id: 't',
  projectPath: '/fixture',
  title: 'Original title',
  status: 'open',
  createdAt: 1,
  updatedAt: 2,
  revision: 1,
};
const evidence = (runId: string, state = 'running'): TaskExecution => ({
  runId,
  state,
  journal: '/fixture-journal',
  startedAt: 1,
});
function attempt(store: AgentStateStore, task: OpaTask, runId: string) {
  updateTaskExecution(store, task, evidence(runId), 'in_progress');
  updateTaskExecution(
    store,
    task,
    { ...evidence(runId, 'completed'), output: runId, finishedAt: 2 },
    'done',
  );
}

describe('durable TaskRun history', () => {
  it('retains separate attempts, original titles, immutable outcomes and independent response data', () => {
    const f = fixture();
    const task = changeTask(f.store, {
      action: 'create',
      requestId: 't',
      projectPath: '/fixture',
      title: 'Original title',
    });
    attempt(f.store, task, 'first');
    const first = taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't' }).runs[0];
    const current = opaWorkSnapshot(f.store).tasks[0];
    const renamed = changeTask(f.store, {
      action: 'update',
      requestId: 'rename',
      projectPath: '/fixture',
      taskId: 't',
      expectedRevision: current.revision,
      title: 'New title',
    });
    attempt(f.store, renamed, 'second');
    const runs = taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't' }).runs;
    expect(runs.map((r) => [r.execution.runId, r.title])).toEqual([
      ['second', 'New title'],
      ['first', 'Original title'],
    ]);
    expect(runs[1]).toEqual(first);
    const revision = opaWorkSnapshot(f.store).tasks[0].revision;
    updateTaskExecution(
      f.store,
      renamed,
      taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't', runId: 'second' }).runs[0]
        .execution,
      'done',
    );
    expect(opaWorkSnapshot(f.store).tasks[0].revision).toBe(revision);
    expect(() =>
      updateTaskExecution(
        f.store,
        renamed,
        {
          ...taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't', runId: 'second' })
            .runs[0].execution,
          output: 'overwrite',
        },
        'done',
      ),
    ).toThrow('RUN_FINALIZED');
    runs[0].execution.output = 'caller mutation';
    expect(
      taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't', runId: 'second' }).runs[0]
        .execution.output,
    ).toBe('second');
    expect(taskRunsPage(f.restart(), { projectPath: '/fixture', taskId: 't' }).runs).toHaveLength(
      2,
    );
  });
  it('migrates latest execution once and durably interrupts stale runs without inventing finish or permissions', () => {
    const f = fixture({
      tasks: [
        {
          ...legacyTask,
          execution: {
            ...evidence('legacy'),
            permissions: [{ id: 'old', title: 'Old request', options: [] }],
          },
        },
      ],
      usage: [],
    });
    const task = opaWorkSnapshot(f.store).tasks[0];
    const runs = taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't' }).runs;
    expect(task.execution?.state).toBe('interrupted');
    expect(runs[0].execution).toEqual(evidence('legacy', 'interrupted'));
    expect(runs[0].execution.finishedAt).toBeUndefined();
    expect(runs[0].execution.executorId).toBeUndefined();
    expect(runs[0].titleFromLegacyTask).toBe(true);
    expect(f.persisted().runs).toEqual(runs);
    expect(f.persisted().runHistoryVersion).toBe(1);
    const writes = f.save.mock.calls.length;
    taskRunsPage(f.restart(), { projectPath: '/fixture', taskId: 't' });
    expect(f.save).toHaveBeenCalledTimes(writes);
    expect(() => updateTaskExecution(f.store, task, evidence('legacy'), 'in_progress')).toThrow(
      'RUN_FINALIZED',
    );
  });
  it('pages newest recorded attempts with stable scoped cursors and bounded limits', () => {
    const f = fixture({ tasks: [legacyTask, { ...legacyTask, projectPath: '/other' }], usage: [] });
    for (let i = 0; i < 5; i++) attempt(f.store, legacyTask, `run-${i}`);
    attempt(f.store, { ...legacyTask, projectPath: '/other' }, 'other');
    const query = { projectPath: '/fixture', taskId: 't', limit: 2 };
    const first = taskRunsPage(f.store, query);
    expect(first.runs.map((r) => r.execution.runId)).toEqual(['run-4', 'run-3']);
    expect(first.runs[0].execution.output).toBeUndefined();
    expect(taskRunsPage(f.store, { ...query, runId: 'run-4' }).runs[0].execution.output).toBe(
      'run-4',
    );
    attempt(f.store, legacyTask, 'new-after-first-page');
    const second = taskRunsPage(f.store, { ...query, before: first.nextCursor });
    expect(second.runs.map((r) => r.execution.runId)).toEqual(['run-2', 'run-1']);
    expect(
      taskRunsPage(f.store, { ...query, before: second.nextCursor }).nextCursor,
    ).toBeUndefined();
    expect(taskRunsPage(f.store, { ...query, runId: 'run-0' }).runs[0].execution.runId).toBe(
      'run-0',
    );
    expect(() => taskRunsPage(f.store, { ...query, before: 'other' })).toThrow(
      'RUNS_CURSOR_INVALID',
    );
    expect(() => taskRunsPage(f.store, { ...query, runId: 'other' })).toThrow('RUN_NOT_FOUND');
    for (const limit of [0, 51, 1.2, '2'])
      expect(() => taskRunsPage(f.store, { ...query, limit })).toThrow('RUNS_INVALID');
    expect(() => taskRunsPage(f.store, { ...query, runId: 'run-0', before: 'run-4' })).toThrow(
      'RUNS_INVALID',
    );
    const writes = f.save.mock.calls.length;
    taskRunsReply(f.store, { ...query, requestId: 'observe' });
    expect(f.save).toHaveBeenCalledTimes(writes);
  });
  it('does not publish failed writes or discard unsupported/corrupt history', () => {
    const f = fixture({ tasks: [legacyTask], usage: [] });
    opaWorkSnapshot(f.store);
    f.save.mockImplementationOnce(() => {
      throw Error('disk');
    });
    expect(() =>
      updateTaskExecution(f.store, legacyTask, evidence('not-saved'), 'in_progress'),
    ).toThrow('STORAGE_FAILED');
    expect(taskRunsPage(f.store, { projectPath: '/fixture', taskId: 't' }).runs).toHaveLength(0);
    expect(opaWorkSnapshot(f.store).tasks[0].execution).toBeUndefined();
    const unsupported = fixture({
      tasks: [legacyTask],
      usage: [],
      runHistoryVersion: 2,
    } as unknown as OpaWorkData);
    expect(() => opaWorkSnapshot(unsupported.store)).toThrow('HISTORY_UNSUPPORTED');
    expect(unsupported.save).not.toHaveBeenCalled();
    const corrupt = fixture({
      tasks: [legacyTask],
      usage: [],
      runs: [{}],
    } as unknown as OpaWorkData);
    expect(() => opaWorkSnapshot(corrupt.store)).toThrow('HISTORY_INVALID');
    expect(corrupt.save).not.toHaveBeenCalled();
  });
});

describe('task history observer boundaries', () => {
  it('permits only the passive query for a tokenless observer and keeps commands denied', () => {
    const f = fixture({ tasks: [legacyTask], usage: [] });
    attempt(f.store, legacyTask, 'fixture-run');
    const before = structuredClone(f.persisted());
    const send = vi.fn();
    const ctx = { store: f.store, cache: null, privileged: false };
    handleClientMessage(
      {
        type: 'opaTaskRunsRequest',
        requestId: 'query',
        projectPath: '/fixture',
        taskId: 't',
        launch: true,
        action: 'permission',
      },
      send,
      ctx,
    );
    expect(send.mock.calls[0][0]).toMatchObject({
      type: 'opaTaskRunsPage',
      requestId: 'query',
      runs: [{ execution: { runId: 'fixture-run' } }],
    });
    handleClientMessage(
      {
        type: 'opaTaskCommand',
        requestId: 'not-allowed',
        action: 'update',
        launch: true,
        projectPath: '/fixture',
        taskId: 't',
      },
      send,
      ctx,
    );
    expect(send.mock.calls.some(([msg]) => msg.error === 'READ_ONLY')).toBe(true);
    expect(f.persisted()).toEqual(before);
  });
  it('authenticates HTTP retrieval and bounds scoped WebSocket observer queries', async () => {
    const f = fixture({ tasks: [legacyTask], usage: [] });
    attempt(f.store, legacyTask, 'fixture-run');
    const { app, port } = await createHttpServer({
      embedded: false,
      token: 'fixture-token',
      store: f.store,
    });
    let socket: WebSocket | undefined;
    try {
      const url = '/api/opa/task-runs?projectPath=%2Ffixture&taskId=t';
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      const headers = { authorization: 'Bearer fixture-token' };
      const response = await app.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(200);
      expect(response.json().runs[0].execution.runId).toBe('fixture-run');
      expect(
        (await app.inject({ method: 'GET', url: url + '&limit=51', headers })).statusCode,
      ).toBe(400);
      expect(
        (await app.inject({ method: 'GET', url: url + '&runId=missing', headers })).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/opa/task-runs?projectPath=%2Fother&taskId=t',
            headers,
          })
        ).statusCode,
      ).toBe(404);
      socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      await new Promise<void>((resolve, reject) => {
        socket!.once('open', resolve);
        socket!.once('error', reject);
      });
      const page = new Promise<Record<string, unknown>>((resolve) =>
        socket!.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'opaTaskRunsPage') resolve(msg);
        }),
      );
      socket.send(
        JSON.stringify({
          type: 'opaTaskRunsRequest',
          requestId: 'observe',
          projectPath: '/fixture',
          taskId: 't',
          limit: 1,
        }),
      );
      expect(await page).toMatchObject({
        requestId: 'observe',
        runs: [{ execution: { runId: 'fixture-run', state: 'completed' } }],
      });
    } finally {
      socket?.terminate();
      await app.close();
    }
  });
});
