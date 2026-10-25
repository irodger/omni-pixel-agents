import { randomUUID } from 'node:crypto';

import type { OpaData, OpaEvent } from './events.js';
import { isUsage, validCount } from './work.js';

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Stateful only for stream identity and ordering; no filesystem or network access. */
export class OpaNormalizer {
  private sequence = 0;
  private streamId = randomUUID();
  private codexSession = '';
  private turnNumber = 0;
  private sessions = new Set<string>();
  constructor(
    private provider: 'codex' | 'opencode',
    private cwd: string,
  ) {}

  private wrap(sessionId: string, data: OpaData): OpaEvent {
    return {
      specVersion: data.type === 'usage.reported' || data.type === 'task.upserted' ? '0.2' : '0.1',
      id: randomUUID(),
      streamId: this.streamId,
      timestamp: data.type === 'usage.reported' ? data.usage.timestamp : new Date().toISOString(),
      provider: this.provider,
      sessionId,
      agentId: sessionId,
      sequence: this.sequence++,
      ...data,
    };
  }

  normalize(raw: unknown): OpaEvent[] {
    const r = obj(raw);
    let sid = '';
    const data: OpaData[] = [];
    if (this.provider === 'codex') {
      if (r.type === 'thread.started') this.codexSession = str(r.thread_id);
      sid = this.codexSession;
      if (!sid) return [];
      if (r.type === 'turn.started') data.push({ type: 'turn.started' });
      if (r.type === 'turn.completed') data.push({ type: 'turn.completed' });
      if (r.type === 'turn.completed') {
        this.turnNumber++;
        const u = obj(r.usage);
        const usage = {
          usageId: `${this.streamId}:turn:${this.turnNumber}`,
          projectPath: this.cwd,
          provider: 'codex',
          sessionId: sid,
          timestamp: new Date().toISOString(),
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cachedInputTokens: u.cached_input_tokens,
          reasoningTokens: u.reasoning_output_tokens,
        };
        if (isUsage(usage)) data.push({ type: 'usage.reported', usage });
      }
      if (r.type === 'turn.failed' || r.type === 'error')
        data.push({
          type: 'turn.failed',
          message: str(obj(r.error).message) || str(r.message) || 'Codex failed',
        });
      const item = obj(r.item);
      const toolId = str(item.id);
      const toolTypes = [
        'command_execution',
        'file_change',
        'mcp_tool_call',
        'web_search',
        'collab_tool_call',
      ];
      if (toolId && toolTypes.includes(str(item.type))) {
        // File-change records can arrive only at completion: emit a balanced pair.
        if (
          r.type === 'item.started' ||
          (r.type === 'item.completed' && item.type === 'file_change')
        ) {
          data.push({
            type: 'tool.started',
            toolId,
            name: str(item.tool) || str(item.type),
            activity:
              item.type === 'web_search'
                ? 'read'
                : item.type === 'file_change'
                  ? 'write'
                  : 'execute',
          });
        }
        if (r.type === 'item.completed')
          data.push({
            type: 'tool.completed',
            toolId,
            failed:
              item.status === 'failed' ||
              (typeof item.exit_code === 'number' && item.exit_code !== 0),
          });
      }
      if (r.type === 'item.completed' && item.type === 'agent_message')
        data.push({ type: 'message', role: 'assistant', text: str(item.text) });
    } else {
      const p = obj(r.properties);
      const info = obj(p.info);
      const part = obj(p.part);
      sid = str(p.sessionID) || str(info.sessionID) || str(info.id) || str(part.sessionID);
      if (!sid) return [];
      if (
        r.type === 'message.updated' &&
        info.role === 'assistant' &&
        validCount(obj(info.time).completed)
      ) {
        const tokens = obj(info.tokens),
          cache = obj(tokens.cache);
        if (
          ![tokens.input, tokens.output, tokens.reasoning, cache.read, cache.write].every(
            validCount,
          ) ||
          !str(info.id)
        )
          return [];
        const usage = {
          usageId: str(info.id),
          projectPath: str(obj(info.path).cwd) || this.cwd,
          provider: 'opencode',
          sessionId: sid,
          timestamp: new Date(obj(info.time).completed as number).toISOString(),
          model: [str(info.providerID), str(info.modelID)].filter(Boolean).join('/') || undefined,
          inputTokens: (tokens.input as number) + (cache.read as number) + (cache.write as number),
          outputTokens: (tokens.output as number) + (tokens.reasoning as number),
          cachedInputTokens: cache.read,
          cacheWriteTokens: cache.write,
          reasoningTokens: tokens.reasoning,
          cost:
            typeof info.cost === 'number'
              ? { amount: info.cost, currency: 'USD', kind: 'estimated' }
              : undefined,
        };
        if (isUsage(usage)) data.push({ type: 'usage.reported', usage });
      } else if (r.type === 'session.created') {
        // Bootstrap below carries the source's role/name and parent relation.
      } else if (r.type === 'session.deleted') data.push({ type: 'session.ended' });
      else if (r.type === 'session.status' && obj(p.status).type === 'busy')
        data.push({ type: 'turn.started' });
      else if (r.type === 'session.idle') data.push({ type: 'turn.completed' });
      else if (r.type === 'session.error')
        data.push({
          type: 'turn.failed',
          message: str(obj(obj(p.error).data).message) || 'OpenCode failed',
        });
      else if (r.type === 'permission.asked') data.push({ type: 'permission.requested' });
      else if (r.type === 'permission.replied') data.push({ type: 'permission.resolved' });
      else if (r.type === 'message.part.updated' && part.type === 'tool') {
        const state = obj(part.state);
        const toolId = str(part.callID);
        if (!toolId) return [];
        const name = str(part.tool) || 'tool';
        if (state.status === 'running')
          data.push({
            type: 'tool.started',
            toolId,
            name,
            activity: ['read', 'glob', 'grep', 'list', 'webfetch', 'websearch'].includes(name)
              ? 'read'
              : name === 'bash'
                ? 'execute'
                : 'write',
          });
        if (state.status === 'completed' || state.status === 'error')
          data.push({ type: 'tool.completed', toolId, failed: state.status === 'error' });
      } else return [];
      if (!this.sessions.has(sid))
        data.unshift({
          type: 'session.started',
          cwd: str(info.directory) || str(obj(info.path).cwd) || this.cwd,
          name: r.type === 'session.created' ? str(info.title) || undefined : undefined,
          parentAgentId: r.type === 'session.created' ? str(info.parentID) || undefined : undefined,
        });
    }
    if (this.provider === 'codex' && !this.sessions.has(sid))
      data.unshift({ type: 'session.started', cwd: this.cwd });
    this.sessions.add(sid);
    return data.map((d) => this.wrap(sid, d));
  }
}
