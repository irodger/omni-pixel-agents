import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const sandbox = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => sandbox.home,
}));
import { AgentStateStore } from '../src/agentStateStore.js';
import { executeTaskCommand, stopTaskExecutions } from '../src/opa/execution.js';
import { opaWorkSnapshot } from '../src/opa/work.js';

const roots: string[] = [];
const stores: AgentStateStore[] = [];
afterEach(() => {
  stores.forEach(stopTaskExecutions);
  vi.unstubAllEnvs();
  roots.forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function setup(script: string, id = 'codex') {
  const root = mkdtempSync(join(tmpdir(), 'opa-run-test-'));
  roots.push(root);
  sandbox.home = root;
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(
    join(bin, id),
    `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('fixture 1.0');process.exit(0)}\n${script}`,
    { mode: 0o755 },
  );
  vi.stubEnv('PATH', bin);
  const store = new AgentStateStore();
  stores.push(store);
  return {
    store,
    project,
    command: {
      action: 'create',
      requestId: 'one',
      projectPath: project,
      title: 'Task $(touch NEVER) `literal`',
      assignee: id,
    },
  };
}
const success = `process.stdin.resume(); process.stdin.on('end',()=>{for(const e of [{type:'thread.started',thread_id:'test'},{type:'turn.started'},{type:'item.completed',item:{id:'answer',type:'agent_message',text:'Done from fixture'}},{type:'turn.completed',usage:{input_tokens:10,output_tokens:2}}])console.log(JSON.stringify(e))});`;
async function finished(store: AgentStateStore) {
  await vi.waitFor(() =>
    expect(opaWorkSnapshot(store).tasks[0].execution?.state).not.toBe('running'),
  );
  return opaWorkSnapshot(store).tasks[0];
}
describe('task dispatch', () => {
  it('launches once, passes prompt without shell expansion, collects result and usage', async () => {
    const { store, project, command } = setup(success);
    const running = executeTaskCommand(store, command);
    expect(running.status).toBe('in_progress');
    expect(running.execution?.state).toBe('running');
    executeTaskCommand(store, command);
    expect(() => executeTaskCommand(store, { ...command, requestId: 'two' })).toThrow(
      'PROJECT_BUSY',
    );
    const done = await finished(store);
    expect(done.status).toBe('done');
    expect(done.execution?.output).toContain('Done from fixture');
    expect(opaWorkSnapshot(store).usage).toHaveLength(1);
    expect(readFileSync(done.execution!.journal, 'utf8')).toContain('usage.reported');
    expect(done.projectPath).toBe(project);
  });
  it('preserves launch failures and permits explicit retry', async () => {
    const { store, command } = setup("process.stderr.write('fixture failure'); process.exit(2)");
    executeTaskCommand(store, command);
    const failed = await finished(store);
    expect(failed.status).toBe('open');
    expect(failed.execution?.state).toBe('failed');
    expect(failed.execution?.error).toContain('fixture failure');
    const retry = executeTaskCommand(store, {
      action: 'update',
      requestId: 'retry',
      taskId: failed.id,
      projectPath: failed.projectPath,
      expectedRevision: failed.revision,
      launch: true,
    });
    expect(retry.execution?.runId).not.toBe(failed.execution?.runId);
    await finished(store);
  });
  it('cancels a running process and blocks conflicting edits', async () => {
    const { store, command } = setup('setInterval(()=>{},1000)');
    const task = executeTaskCommand(store, command);
    const update = {
      action: 'update',
      requestId: 'stop',
      taskId: task.id,
      projectPath: task.projectPath,
      expectedRevision: task.revision,
    };
    expect(() => executeTaskCommand(store, { ...update, title: 'change' })).toThrow('TASK_RUNNING');
    executeTaskCommand(store, { ...update, status: 'cancelled' });
    const stopped = await finished(store);
    expect(stopped.execution?.state).toBe('cancelled');
    expect(stopped.status).toBe('cancelled');
  });
  it('rejects unavailable executor or missing project before saving', () => {
    const { store, command } = setup(success);
    expect(() => executeTaskCommand(store, { ...command, assignee: 'shell' })).toThrow(
      'EXECUTOR_UNAVAILABLE',
    );
    expect(() =>
      executeTaskCommand(store, { ...command, projectPath: '/missing/opa-project' }),
    ).toThrow('PROJECT_UNAVAILABLE');
    expect(opaWorkSnapshot(store).tasks).toHaveLength(0);
  });
  it('adapts OpenCode run events independently of the plugin contract', async () => {
    const events = [
      { type: 'step_start', sessionID: 'oc' },
      { type: 'text', sessionID: 'oc', part: { text: 'OpenCode result' } },
      {
        type: 'step_finish',
        sessionID: 'oc',
        timestamp: Date.now(),
        part: {
          id: 'step1',
          reason: 'stop',
          tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 3, write: 0 } },
          cost: 0.001,
        },
      },
    ];
    const { store, command } = setup(
      `for(const e of ${JSON.stringify(events)})console.log(JSON.stringify(e));`,
      'opencode',
    );
    executeTaskCommand(store, command);
    const done = await finished(store);
    expect(done.status).toBe('done');
    expect(done.execution?.output).toContain('OpenCode result');
    expect(opaWorkSnapshot(store).usage[0].inputTokens).toBe(13);
  });
});
