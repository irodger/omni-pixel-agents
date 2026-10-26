import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const sandbox = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => sandbox.home,
}));
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  availableExecutors,
  executeTaskCommand,
  stopTaskExecutions,
} from '../src/opa/execution.js';
import { changeTask, opaWorkSnapshot, taskRunsPage } from '../src/opa/work.js';

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
// Existing process fixtures now use the explicit two-step launch contract.
function dispatch(store: AgentStateStore, command: Record<string, unknown>) {
  if (command.action !== 'create') return executeTaskCommand(store, command);
  const task = executeTaskCommand(store, command);
  if (task.execution) return task;
  return executeTaskCommand(store, {
    action: 'start',
    requestId: `start-${command.requestId}`,
    projectPath: task.projectPath,
    taskId: task.id,
    expectedRevision: task.revision,
  });
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
    const running = dispatch(store, command);
    expect(running.status).toBe('in_progress');
    expect(running.execution?.state).toBe('running');
    dispatch(store, command);
    expect(() => dispatch(store, { ...command, requestId: 'two' })).toThrow('PROJECT_BUSY');
    const done = await finished(store);
    expect(done.status).toBe('done');
    expect(done.execution?.output).toContain('Done from fixture');
    expect(done.execution?.executorId).toBe('codex');
    expect(done.execution?.provider).toBe('codex');
    expect(done.execution?.sessionId).toBe('test');
    expect(done.execution?.usage?.[0].inputTokens).toBe(10);
    expect(done.execution?.usage?.[0].cost).toBeUndefined();
    expect(done.execution?.outputTruncated).toBe(false);
    expect(done.execution?.gitContext).toMatchObject({
      version: 1,
      cwd: realpathSync(project),
      state: 'unavailable',
    });
    expect(done.execution?.gitContextAfter).toMatchObject({
      version: 1,
      cwd: realpathSync(project),
      state: 'unavailable',
    });
    const journal = readFileSync(done.execution!.journal, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(journal.find((event) => event.type === 'turn.completed').id).toBe(
      done.execution?.resultEventId,
    );
    expect(opaWorkSnapshot(store).usage).toHaveLength(1);
    expect(readFileSync(done.execution!.journal, 'utf8')).toContain('usage.reported');
    expect(done.projectPath).toBe(project);
  });
  it('labels bounded result output instead of implying completeness', async () => {
    const { store, command } = setup(success.replace('Done from fixture', 'x'.repeat(8100)));
    dispatch(store, command);
    const done = await finished(store);
    expect(done.execution?.output).toHaveLength(8000);
    expect(done.execution?.outputTruncated).toBe(true);
  });
  it('preserves launch failures and permits explicit retry', async () => {
    const { store, command } = setup("process.stderr.write('fixture failure'); process.exit(2)");
    dispatch(store, command);
    const failed = await finished(store);
    expect(failed.status).toBe('open');
    expect(failed.execution?.state).toBe('failed');
    expect(failed.execution?.error).toContain('fixture failure');
    const retry = executeTaskCommand(store, {
      action: 'start',
      requestId: 'retry',
      taskId: failed.id,
      projectPath: failed.projectPath,
      expectedRevision: failed.revision,
    });
    expect(retry.execution?.runId).not.toBe(failed.execution?.runId);
    await finished(store);
    const history = taskRunsPage(store, {
      projectPath: failed.projectPath,
      taskId: failed.id,
    }).runs;
    expect(history).toHaveLength(2);
    expect(
      taskRunsPage(store, {
        projectPath: failed.projectPath,
        taskId: failed.id,
        runId: failed.execution!.runId,
      }).runs[0].execution,
    ).toEqual(failed.execution);
    expect(history[0].execution.runId).toBe(retry.execution?.runId);
  });
  it('cancels a running process and blocks conflicting edits', async () => {
    const { store, command } = setup('setInterval(()=>{},1000)');
    const task = dispatch(store, command);
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
  it('saves unavailable assignments passively and rejects explicit start before spawning', () => {
    const { store, command } = setup(success);
    const unavailable = executeTaskCommand(store, { ...command, assignee: 'shell' });
    expect(unavailable.execution).toBeUndefined();
    expect(() =>
      executeTaskCommand(store, {
        action: 'start',
        requestId: 'bad-start',
        taskId: unavailable.id,
        projectPath: unavailable.projectPath,
        expectedRevision: unavailable.revision,
      }),
    ).toThrow('EXECUTOR_UNAVAILABLE');
    const missing = executeTaskCommand(store, {
      ...command,
      requestId: 'missing',
      projectPath: '/missing/opa-project',
    });
    expect(() =>
      executeTaskCommand(store, {
        action: 'start',
        requestId: 'missing-start',
        taskId: missing.id,
        projectPath: missing.projectPath,
        expectedRevision: missing.revision,
      }),
    ).toThrow('PROJECT_UNAVAILABLE');
    expect(opaWorkSnapshot(store).tasks).toHaveLength(2);
    expect(opaWorkSnapshot(store).tasks.every((task) => !task.execution)).toBe(true);
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
    dispatch(store, command);
    const done = await finished(store);
    expect(done.status).toBe('done');
    expect(done.execution?.output).toContain('OpenCode result');
    expect(opaWorkSnapshot(store).usage[0].inputTokens).toBe(13);
  });
  it('keeps native discovery when the ACP config is malformed', () => {
    setup(success);
    const directory = join(sandbox.home, '.pixel-agents');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'opa-adapters.json'), '{broken');
    expect(availableExecutors().map((e) => e.id)).toContain('codex');
  });
  it('runs a configured ACP process and waits for an explicit permission decision', async () => {
    const { store, project } = setup(success);
    const file = join(sandbox.home, 'acp.cjs');
    writeFileSync(
      file,
      `const rl=require('node:readline').createInterface({input:process.stdin});let prompt;
const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));
rl.on('line',line=>{const m=JSON.parse(line);
if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{}}});
if(m.method==='session/new')send({id:m.id,result:{sessionId:'acp-fixture'}});
if(m.method==='session/prompt'){prompt=m.id;send({id:'ask',method:'session/request_permission',params:{sessionId:'acp-fixture',toolCall:{title:'Fixture permission'},options:[{optionId:'allow',name:'Allow once',kind:'allow_once'}]}})}
if(m.id==='ask' && m.result){send({method:'session/update',params:{sessionId:'acp-fixture',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ACP fixture result'}}}});send({id:prompt,result:{stopReason:'end_turn'}})}
});`,
    );
    const dir = join(sandbox.home, '.pixel-agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'opa-adapters.json'),
      JSON.stringify({
        version: 1,
        agents: [{ id: 'fixture', name: 'ACP fixture', command: process.execPath, args: [file] }],
      }),
    );
    dispatch(store, {
      action: 'create',
      requestId: 'acp-task',
      title: 'Fixture work',
      assignee: 'acp:fixture',
      projectPath: project,
    });
    await vi.waitFor(() =>
      expect(opaWorkSnapshot(store).tasks[0].execution?.permissions).toHaveLength(1),
    );
    const task = opaWorkSnapshot(store).tasks[0];
    const decision = {
      action: 'permission',
      requestId: 'decision',
      projectPath: project,
      taskId: task.id,
      runId: task.execution!.runId,
      permissionId: task.execution!.permissions![0].id,
      optionId: 'allow',
    };
    expect(() => executeTaskCommand(store, { ...decision, runId: 'old' })).toThrow(
      'PERMISSION_STALE',
    );
    executeTaskCommand(store, decision);
    expect(() => executeTaskCommand(store, decision)).toThrow('PERMISSION_STALE');
    const done = await finished(store);
    expect(done.status).toBe('done');
    expect(done.execution?.output).toContain('ACP fixture result');
    expect(readFileSync(done.execution!.journal, 'utf8')).toContain('permission.requested');
  });
  it('moves assigned tasks without launching, and protects the passive command from launch fields and stale edits', () => {
    const { store, project } = setup(success);
    const task = changeTask(store, {
      action: 'create',
      requestId: 'board',
      projectPath: project,
      title: 'Board task',
      assignee: 'codex',
    });
    const move = {
      action: 'move',
      requestId: 'move',
      projectPath: project,
      taskId: task.id,
      expectedRevision: task.revision,
      status: 'in_progress',
    };
    for (const extra of [{ launch: true }, { assignee: 'opencode' }, { title: 'replacement' }])
      expect(() => executeTaskCommand(store, { ...move, ...extra })).toThrow('TASK_INVALID');
    const moved = executeTaskCommand(store, move);
    expect(moved.status).toBe('in_progress');
    expect(moved.assignee).toBe('codex');
    expect(moved.execution).toBeUndefined();
    expect(() => executeTaskCommand(store, move)).toThrow('TASK_CONFLICT');
    const cancelled = executeTaskCommand(store, {
      ...move,
      expectedRevision: moved.revision,
      status: 'cancelled',
    });
    expect(cancelled.execution).toBeUndefined();
    expect(cancelled.status).toBe('cancelled');
  });
  it('does not cancel a real process when a running card is moved to cancelled', async () => {
    const { store, command } = setup('setInterval(()=>{},1000)');
    const task = dispatch(store, command);
    expect(() =>
      executeTaskCommand(store, {
        action: 'move',
        requestId: 'move-running',
        taskId: task.id,
        projectPath: task.projectPath,
        expectedRevision: task.revision,
        status: 'cancelled',
      }),
    ).toThrow('TASK_MOVE_RUNNING');
    expect(opaWorkSnapshot(store).tasks[0].execution?.state).toBe('running');
    executeTaskCommand(store, {
      action: 'update',
      requestId: 'explicit-stop',
      taskId: task.id,
      projectPath: task.projectPath,
      expectedRevision: task.revision,
      status: 'cancelled',
    });
    expect((await finished(store)).status).toBe('cancelled');
  });
});
