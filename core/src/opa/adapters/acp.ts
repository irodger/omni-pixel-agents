import { randomUUID } from 'node:crypto';

import type { OpaData, OpaEvent } from '../events.js';
import type { AdapterCapabilities } from './types.js';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function acpCapabilities(raw: unknown): AdapterCapabilities {
  const value = object(raw);
  return {
    observe: true,
    prompt: true,
    cancel: true,
    permissions: true,
    loadSession: value.loadSession === true,
  };
}
/** Only ACP v1 is implemented. v2 is a distinct draft with different field names. */
export function negotiateAcp(result: unknown) {
  const value = object(result);
  if (value.protocolVersion !== 1)
    throw new Error('Unsupported ACP protocol version (OPA supports v1)');
  return {
    capabilities: acpCapabilities(value.agentCapabilities),
    authMethods: Array.isArray(value.authMethods) ? value.authMethods : [],
  };
}
export class AcpNormalizer {
  private streamId = randomUUID();
  private sequence = 0;
  private sessionId = '';
  private tools = new Set<string>();
  constructor(
    private provider: string,
    private cwd: string,
    private emit: (event: OpaEvent) => void,
  ) {}
  event(data: OpaData) {
    if (!this.sessionId) return;
    this.emit({
      specVersion: '0.1',
      id: randomUUID(),
      streamId: this.streamId,
      sequence: this.sequence++,
      timestamp: new Date().toISOString(),
      provider: this.provider,
      sessionId: this.sessionId,
      agentId: this.sessionId,
      ...data,
    });
  }
  session(id: string) {
    if (!id || this.sessionId) throw new Error('Invalid ACP session');
    this.sessionId = id;
    this.event({ type: 'session.started', cwd: this.cwd });
  }
  turn() {
    this.tools.clear();
    this.event({ type: 'turn.started' });
  }
  update(raw: unknown) {
    const params = object(raw);
    if (params.sessionId !== this.sessionId || !this.sessionId) return;
    const update = object(params.update);
    const content = object(update.content);
    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      content.type === 'text' &&
      typeof content.text === 'string'
    )
      this.event({ type: 'message', role: 'assistant', text: content.text });
    // Thoughts, raw tool arguments/results and context-window/cumulative usage are not consumption records.
    if (
      !['tool_call', 'tool_call_update'].includes(String(update.sessionUpdate)) ||
      typeof update.toolCallId !== 'string'
    )
      return;
    const toolId = update.toolCallId;
    if (!this.tools.has(toolId)) {
      this.tools.add(toolId);
      this.event({
        type: 'tool.started',
        toolId,
        name: typeof update.title === 'string' ? update.title : 'ACP tool',
        activity:
          update.kind === 'read' || update.kind === 'search'
            ? 'read'
            : update.kind === 'edit' || update.kind === 'delete'
              ? 'write'
              : 'execute',
      });
    }
    if (update.status === 'completed' || update.status === 'failed')
      this.event({ type: 'tool.completed', toolId, failed: update.status === 'failed' });
  }
  finish(raw: unknown) {
    const stopReason = object(raw).stopReason;
    this.event(
      stopReason === 'end_turn'
        ? { type: 'turn.completed' }
        : { type: 'turn.failed', message: `ACP stopped: ${String(stopReason ?? 'unknown')}` },
    );
  }
}
