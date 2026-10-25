import { describe, expect, it } from 'vitest';

import type { StateAdapter } from '../../core/src/adapter.js';
import type { OpaData, OpaEvent } from '../../core/src/opa/events.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { opaCampusSnapshot } from '../src/opa/campus.js';
import { OpaOffice } from '../src/opa/office.js';

let sequence = 0;
function event(sessionId: string, data: OpaData, provider = 'codex'): OpaEvent {
  const n = sequence++;
  return {
    specVersion: '0.1',
    id: `event-${n}`,
    streamId: 'test',
    sequence: n,
    timestamp: new Date().toISOString(),
    provider,
    sessionId,
    agentId: sessionId,
    ...data,
  };
}

function memoryAdapter(settings: Record<string, unknown>): StateAdapter {
  return {
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    loadOpaProjects: () => (settings.projects as string[]) ?? [],
    saveOpaProjects: (paths) => {
      settings.projects = paths;
    },
    getSetting: <T>(key: string, fallback: T): T => (settings[key] as T) ?? fallback,
    setSetting: (key, value) => {
      settings[key] = value;
    },
  };
}

describe('OPA campus', () => {
  it('restores waiting time from event history rather than the replay time', () => {
    const store = new AgentStateStore();
    const office = new OpaOffice(store, () => 180000);
    office.accept(event('s', { type: 'session.started', cwd: '/project' }));
    office.accept({
      ...event('s', { type: 'permission.requested' }),
      timestamp: new Date(1000).toISOString(),
    });
    expect(opaCampusSnapshot(store).projects[0].agents[0].blockedSince).toBe(1000);
  });
  it('groups providers by canonical project path and separates equal folder names', () => {
    const store = new AgentStateStore();
    const office = new OpaOffice(store);
    office.accept(event('c', { type: 'session.started', cwd: '/a/project/./', name: 'Coder' }));
    office.accept(event('o', { type: 'session.started', cwd: '/a/project' }, 'opencode'));
    office.accept(event('other', { type: 'session.started', cwd: '/b/project' }));
    const { projects } = opaCampusSnapshot(store);
    expect(projects).toHaveLength(2);
    expect(projects[0].agents.map((a) => a.provider)).toEqual(['codex', 'opencode']);
    expect(projects[0].name).toBe(projects[1].name);
    expect(projects[0].id).not.toBe(projects[1].id);
  });

  it('keeps permission timing on duplicate requests and preserves working state after a reply', () => {
    let now = 1000;
    const store = new AgentStateStore();
    const office = new OpaOffice(store, () => now);
    office.accept(event('s', { type: 'session.started', cwd: '/project' }));
    office.accept(event('s', { type: 'turn.started' }));
    office.accept(event('s', { type: 'permission.requested' }));
    now = 121000;
    office.accept(event('s', { type: 'permission.requested' }));
    let agent = opaCampusSnapshot(store).projects[0].agents[0];
    expect(agent).toMatchObject({ status: 'blocked', blockedSince: 1000 });
    office.accept(event('s', { type: 'permission.resolved' }));
    agent = opaCampusSnapshot(store).projects[0].agents[0];
    expect(agent.status).toBe('working');
    expect(agent.blockedSince).toBeUndefined();
  });

  it('distinguishes completion and errors, and clears stale attention when work resumes', () => {
    const store = new AgentStateStore();
    const office = new OpaOffice(store, () => 5000);
    office.accept(event('s', { type: 'session.started', cwd: '/project', role: 'tester' }));
    const failure = event('s', { type: 'turn.failed', message: 'Tests failed' });
    office.accept(failure);
    expect(opaCampusSnapshot(store).projects[0].agents[0]).toMatchObject({
      status: 'error',
      role: 'tester',
      error: 'Tests failed',
      attentionId: failure.id,
      completedAt: 5000,
    });
    office.accept(event('s', { type: 'turn.started' }));
    expect(opaCampusSnapshot(store).projects[0].agents[0]).toMatchObject({
      status: 'working',
      error: undefined,
      attentionId: undefined,
    });
    office.accept(event('s', { type: 'turn.completed' }));
    expect(opaCampusSnapshot(store).projects[0].agents[0].status).toBe('done');
  });

  it('retains project registry after session end and server recreation without resurrecting agents', () => {
    const settings: Record<string, unknown> = {};
    const store = new AgentStateStore();
    store.setAdapter(memoryAdapter(settings));
    const office = new OpaOffice(store);
    office.accept(event('s', { type: 'session.started', cwd: '/project' }));
    office.accept(event('s', { type: 'session.ended' }));
    expect(opaCampusSnapshot(store).projects).toEqual([
      { id: '/project', name: 'project', path: '/project', agents: [] },
    ]);
    const restarted = new AgentStateStore();
    restarted.setAdapter(memoryAdapter(settings));
    expect(opaCampusSnapshot(restarted)).toEqual(opaCampusSnapshot(store));
    expect(restarted.size).toBe(0);
  });

  it('broadcasts reconstructible snapshots and ignores duplicate source events', () => {
    const store = new AgentStateStore();
    const office = new OpaOffice(store);
    const messages: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => messages.push(m));
    const start = event('s', { type: 'session.started', cwd: '/project' });
    office.accept(start);
    office.accept(start);
    expect(messages.filter((m) => m.type === 'opaCampusState')).toHaveLength(1);
    expect(messages.at(-1)).toEqual(opaCampusSnapshot(store));
  });
});
