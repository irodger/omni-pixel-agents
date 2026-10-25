import { OpaNormalizer } from '../normalize.js';
import type { StreamHooks } from './types.js';

/** Plugin events and run JSON remain different contracts, even for the same provider. */
export function nativeStream(provider: 'codex' | 'opencode', cwd: string, hooks: StreamHooks) {
  const normalizer = new OpaNormalizer(provider, cwd);
  const record = (raw: unknown) => normalizer.normalize(raw).forEach(hooks.event);
  return (raw: unknown) => {
    if (provider === 'codex') {
      record(raw);
      return;
    }
    if (!raw || typeof raw !== 'object') throw new Error('Invalid OpenCode run record');
    const event = raw as Record<string, unknown>;
    const sessionID = event.sessionID;
    const part = event.part as Record<string, unknown> | undefined;
    switch (event.type) {
      case 'step_start':
        record({ type: 'session.status', properties: { sessionID, status: { type: 'busy' } } });
        break;
      case 'error':
        record({ type: 'session.error', properties: { sessionID, error: event.error } });
        break;
      case 'step_finish':
        if (!part) throw new Error('Missing OpenCode step');
        record({
          type: 'message.updated',
          properties: {
            info: {
              id: part.id,
              sessionID,
              role: 'assistant',
              time: { completed: event.timestamp },
              tokens: part.tokens,
              cost: part.cost,
            },
          },
        });
        if (part.reason === 'stop') record({ type: 'session.idle', properties: { sessionID } });
        break;
      case 'tool_use':
        record({ type: 'message.part.updated', properties: { sessionID, part } });
        break;
      // OpenCode plugin text is deliberately omitted. Run text is normalized explicitly below.
      case 'text':
        record({ type: 'opa.run.text', properties: { sessionID, text: part?.text } });
        break;
    }
  };
}

export interface NativeAdapter {
  id: string;
  name: string;
  executable: string;
  invocation: (prompt: string) => { args: string[]; stdin?: string };
  stream: (cwd: string, hooks: StreamHooks) => (raw: unknown) => void;
}
/** Add a verified native contract here; the process host does not switch on provider names. */
export const nativeAdapters: readonly NativeAdapter[] = [
  {
    id: 'codex',
    name: 'Codex',
    executable: 'codex',
    invocation: (prompt) => ({
      args: ['exec', '--json', '--sandbox', 'workspace-write', '-'],
      stdin: prompt,
    }),
    stream: (cwd, hooks) => nativeStream('codex', cwd, hooks),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    executable: 'opencode',
    invocation: (prompt) => ({ args: ['run', '--format', 'json', '--', prompt] }),
    stream: (cwd, hooks) => nativeStream('opencode', cwd, hooks),
  },
];
