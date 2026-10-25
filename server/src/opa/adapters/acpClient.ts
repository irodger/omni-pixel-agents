import { AcpNormalizer, negotiateAcp } from '../../../../core/src/opa/adapters/acp.js';
import type { AdapterCapabilities, StreamHooks } from '../../../../core/src/opa/adapters/types.js';

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** ACP v1 JSON-RPC peer. The process host supplies framing and owns termination. */
export class AcpClient {
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private sessionId = '';
  private closed = false;
  private cancelled = false;
  private permissionCount = 0;
  private normalizer: AcpNormalizer;
  capabilities?: AdapterCapabilities;
  constructor(
    private send: (message: Record<string, unknown>) => void,
    private hooks: StreamHooks,
    provider: string,
    private cwd: string,
    private timeout = 10000,
  ) {
    this.normalizer = new AcpNormalizer(provider, cwd, hooks.event);
  }
  private request(method: string, params: Record<string, unknown>, timeout = this.timeout) {
    if (this.closed) return Promise.reject(new Error('ACP connection closed'));
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, timeout);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  receive(raw: unknown) {
    const message = record(raw);
    if (message.jsonrpc !== '2.0') throw new Error('Invalid ACP JSON-RPC message');
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        void this.incoming(message).catch(() => this.close());
        return;
      }
      if (message.method === 'session/update') this.normalizer.update(message.params);
      return;
    }
    const pending = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id as number);
    if (message.error !== undefined)
      pending.reject(
        new Error(`ACP: ${String(record(message.error).message ?? 'request failed')}`),
      );
    else if ('result' in message) pending.resolve(message.result);
    else pending.reject(new Error('Malformed ACP response'));
  }
  private async incoming(message: Record<string, unknown>) {
    const params = record(message.params);
    if (message.method !== 'session/request_permission') {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: 'Client method not supported; no filesystem or terminal capability advertised',
        },
      });
      return;
    }
    if (!this.sessionId || params.sessionId !== this.sessionId || !Array.isArray(params.options)) {
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32602, message: 'Invalid session or permission options' },
      });
      return;
    }
    const options = params.options
      .map(record)
      .filter(
        (o) =>
          typeof o.optionId === 'string' &&
          typeof o.name === 'string' &&
          typeof o.kind === 'string',
      )
      .map((o) => ({
        optionId: o.optionId as string,
        name: o.name as string,
        kind: o.kind as string,
      }));
    this.permissionCount++;
    this.normalizer.event({ type: 'permission.requested' });
    let selected: string | null = null;
    try {
      if (!this.cancelled && !this.closed && options.length)
        selected = await this.hooks.permission({
          id: JSON.stringify(message.id),
          title: String(record(params.toolCall).title ?? 'Agent permission'),
          options,
        });
    } catch {
      /* Fail closed. */
    }
    if (this.closed) return;
    this.send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        outcome:
          selected && !this.cancelled && options.some((o) => o.optionId === selected)
            ? { outcome: 'selected', optionId: selected }
            : { outcome: 'cancelled' },
      },
    });
    this.permissionCount--;
    if (this.permissionCount === 0) this.normalizer.event({ type: 'permission.resolved' });
  }
  async run(prompt: string) {
    const initialized = await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'omni-pixel-agents', version: '0.2.0' },
    });
    this.capabilities = negotiateAcp(initialized).capabilities;
    if (this.cancelled) throw new Error('ACP cancelled before session creation');
    const session = record(await this.request('session/new', { cwd: this.cwd, mcpServers: [] }));
    if (typeof session.sessionId !== 'string' || !session.sessionId)
      throw new Error('ACP returned no sessionId');
    this.sessionId = session.sessionId;
    this.normalizer.session(this.sessionId);
    if (this.cancelled) {
      this.cancel();
      throw new Error('ACP cancelled before prompt');
    }
    this.normalizer.turn();
    const result = await this.request(
      'session/prompt',
      { sessionId: this.sessionId, prompt: [{ type: 'text', text: prompt }] },
      30 * 60 * 1000,
    );
    this.normalizer.finish(result);
    return record(result).stopReason === 'end_turn';
  }
  cancel() {
    this.cancelled = true;
    if (this.sessionId && !this.closed)
      this.send({
        jsonrpc: '2.0',
        method: 'session/cancel',
        params: { sessionId: this.sessionId },
      });
  }
  close() {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('ACP connection closed'));
    }
    this.pending.clear();
  }
}
