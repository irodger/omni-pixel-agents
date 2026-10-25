import * as path from 'node:path';

import type {
  OpaAgentSnapshot,
  OpaCampusState,
  OpaProjectSnapshot,
} from '../../../core/src/messages.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { toPathKey } from '../pathKey.js';

type Project = Omit<OpaProjectSnapshot, 'agents'>;
const registries = new WeakMap<AgentStateStore, Map<string, Project>>();
function registry(store: AgentStateStore): Map<string, Project> {
  let entries = registries.get(store);
  if (!entries) {
    entries = new Map();
    const saved = store.getAdapter()?.loadOpaProjects?.();
    if (Array.isArray(saved))
      for (const p of saved) {
        if (typeof p === 'string' && path.isAbsolute(p)) {
          const id = toPathKey(p);
          entries.set(id, { id, path: id, name: path.basename(id) || id });
        }
      }
    registries.set(store, entries);
  }
  return entries;
}

export function registerOpaProject(store: AgentStateStore, cwd: string): void {
  const id = toPathKey(cwd);
  const entries = registry(store);
  if (entries.has(id)) return;
  entries.set(id, { id, path: id, name: path.basename(id) || id });
  store.getAdapter()?.saveOpaProjects?.([...entries.keys()]);
}

/** Transport projection; reconstructible from source history, never a command API. */
export function opaCampusSnapshot(store: AgentStateStore): OpaCampusState {
  const projects = new Map<string, OpaProjectSnapshot>();
  for (const p of registry(store).values()) projects.set(p.id, { ...p, agents: [] });
  for (const agent of store.values()) {
    if (!agent.streamProvider) continue;
    const id = toPathKey(agent.projectDir);
    let project = projects.get(id);
    if (!project) {
      project = { id, path: id, name: path.basename(id) || id, agents: [] };
      projects.set(id, project);
    }
    const state = agent.opaAttention;
    const status: OpaAgentSnapshot['status'] = agent.permissionSent
      ? 'blocked'
      : (state?.status ?? 'idle');
    project.agents.push({
      id: agent.id,
      provider: agent.streamProvider,
      sessionId: agent.streamSessionId,
      sourceAgentId: agent.streamAgentId,
      name: state?.name || `${agent.streamProvider} ${agent.id}`,
      role: state?.role,
      status,
      palette: agent.palette,
      hueShift: agent.hueShift,
      blockedSince: state?.blockedSince,
      completedAt: state?.completedAt,
      attentionId: state?.attentionId,
      error: state?.error,
      tools: [...agent.activeToolStatuses.values()],
    });
  }
  const layouts = store.getAdapter()?.loadProjectLayouts?.() ?? {};
  for (const project of projects.values()) {
    const saved = layouts[project.id];
    if (saved) {
      if (saved.layout) project.layout = saved.layout;
      project.layoutVersion = saved.revision;
    }
  }
  return {
    type: 'opaCampusState',
    projects: [...projects.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
