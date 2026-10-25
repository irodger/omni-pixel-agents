import type { OpaEvent } from '../../../core/src/opa/events.js';
import { createAgentState } from '../agentState.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { assignPaletteIfNeeded } from '../paletteAssigner.js';
import { opaCampusSnapshot, registerOpaProject } from './campus.js';
import { applyWorkEvent } from './work.js';

/** Projects portable history onto the existing office, without Claude parsers/timers. */
export class OpaOffice {
  private sessions = new Map<string, number>();
  private sequences = new Map<string, number>();
  constructor(
    private store: AgentStateStore,
    private now: () => number = Date.now,
  ) {}

  accept(e: OpaEvent): boolean {
    if (e.type === 'usage.reported' || e.type === 'task.upserted') {
      const accepted = applyWorkEvent(this.store, e);
      this.store.broadcast({ ...opaCampusSnapshot(this.store) });
      return accepted;
    }
    const key = JSON.stringify([e.provider, e.sessionId, e.agentId]);
    const streamKey = JSON.stringify([e.streamId, key]);
    if (e.sequence <= (this.sequences.get(streamKey) ?? -1)) return false;
    let id = this.sessions.get(key);
    let agent = id === undefined ? undefined : this.store.get(id);
    if (e.type === 'session.started' && !agent) {
      registerOpaProject(this.store, e.cwd);
      id = this.store.nextAgentId.current++;
      agent = createAgentState({
        id,
        sessionId: `opa:${key}`,
        projectDir: e.cwd,
        jsonlFile: '',
        isExternal: true,
        streamProvider: e.provider,
        opaAttention: { status: 'idle', name: e.name, role: e.role },
        hookDelivered: true,
        directoryName: `${e.provider}: ${e.name || e.role || e.cwd.split(/[\\/]/).pop() || 'Agent'}`,
      });
      assignPaletteIfNeeded(agent, this.store);
      this.store.set(id, agent);
      this.sessions.set(key, id);
      this.store.broadcast({
        type: 'agentCreated',
        id,
        directoryName: agent.directoryName,
        isExternal: true,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    }
    if (!agent || id === undefined) throw new Error('session.started must precede activity');
    this.sequences.set(streamKey, e.sequence);
    agent.lastDataAt = this.now();
    const eventTime = Math.min(this.now(), Date.parse(e.timestamp));
    const attention = (agent.opaAttention ??= { status: 'idle' });
    const clear = () => {
      agent.activeToolIds.clear();
      agent.activeToolNames.clear();
      agent.activeToolStatuses.clear();
      agent.permissionSent = false;
      attention.blockedSince = undefined;
      this.store.broadcast({ type: 'agentToolsClear', id });
      this.store.broadcast({ type: 'agentToolPermissionClear', id });
    };
    const active = () => {
      agent.isWaiting = false;
      attention.status = 'working';
      attention.completedAt = undefined;
      attention.attentionId = undefined;
      attention.error = undefined;
      this.store.broadcast({ type: 'agentStatus', id, status: 'active' });
    };
    switch (e.type) {
      case 'tool.started': {
        active();
        // Use upstream's animation vocabulary, preserve the source tool name in status.
        const name = e.activity === 'read' ? 'Read' : e.activity === 'write' ? 'Write' : 'Bash';
        const status = `${e.activity === 'read' ? 'Reading' : e.activity === 'write' ? 'Writing' : 'Running'}: ${e.name}`;
        agent.activeToolIds.add(e.toolId);
        agent.activeToolNames.set(e.toolId, name);
        agent.activeToolStatuses.set(e.toolId, status);
        this.store.broadcast({
          type: 'agentToolStart',
          id,
          toolId: e.toolId,
          toolName: name,
          status,
        });
        break;
      }
      case 'tool.completed':
        agent.activeToolIds.delete(e.toolId);
        agent.activeToolNames.delete(e.toolId);
        agent.activeToolStatuses.delete(e.toolId);
        this.store.broadcast({ type: 'agentToolDone', id, toolId: e.toolId });
        break;
      case 'turn.started':
        clear();
        active();
        break;
      case 'turn.completed':
      case 'turn.failed':
        clear();
        agent.isWaiting = true;
        attention.status = e.type === 'turn.failed' ? 'error' : 'done';
        attention.completedAt = eventTime;
        attention.attentionId = e.id;
        attention.error = e.type === 'turn.failed' ? e.message : undefined;
        this.store.broadcast({ type: 'agentStatus', id, status: 'waiting' });
        break;
      case 'permission.requested':
        agent.permissionSent = true;
        attention.blockedSince ??= eventTime;
        this.store.broadcast({ type: 'agentToolPermission', id });
        break;
      case 'permission.resolved':
        agent.permissionSent = false;
        attention.blockedSince = undefined;
        this.store.broadcast({ type: 'agentToolPermissionClear', id });
        break;
      case 'session.ended':
        clear();
        this.store.delete(id);
        this.store.broadcast({ type: 'agentClosed', id });
        break;
    }
    this.store.broadcast({ ...opaCampusSnapshot(this.store) });
    return true;
  }
}
