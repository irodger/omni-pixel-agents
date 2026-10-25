import type { OpaProjectSnapshot } from '../../../core/src/messages.js';
import { OfficeState } from '../office/engine/officeState.js';
import type { OfficeLayout } from '../office/types.js';

/** Each project owns its seats, paths and character simulation. Assets stay shared. */
export class ProjectOffice {
  readonly office: OfficeState;
  private states = new Map<number, string>();
  constructor(layout: OfficeLayout) {
    this.office = new OfficeState(structuredClone(layout));
  }
  sync(project: OpaProjectSnapshot): void {
    const ids = new Set(project.agents.map((a) => a.id));
    for (const id of this.states.keys())
      if (!ids.has(id)) {
        this.office.removeAgent(id);
        this.states.delete(id);
      }
    for (const agent of project.agents) {
      this.office.addAgent(agent.id, agent.palette, agent.hueShift, undefined, true, project.name);
      const signature = JSON.stringify([agent.status, agent.tools, agent.attentionId]);
      if (this.states.get(agent.id) === signature) continue;
      this.states.set(agent.id, signature);
      this.office.setAgentActive(
        agent.id,
        agent.status === 'working' || agent.status === 'blocked',
      );
      const tool = agent.tools[0];
      this.office.setAgentTool(
        agent.id,
        tool?.startsWith('Reading') ? 'Read' : tool ? 'Write' : null,
      );
      if (agent.status === 'blocked') this.office.showPermissionBubble(agent.id);
      else {
        this.office.clearPermissionBubble(agent.id);
        if (agent.status === 'done' || agent.status === 'error')
          this.office.showWaitingBubble(agent.id);
      }
    }
  }
}
