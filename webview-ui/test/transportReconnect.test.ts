import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebSocketTransport } from '../src/transport/webSocketTransport.js';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor() {
    Socket.instances.push(this);
  }
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Socket.instances = [];
});
describe('reconnect snapshot handshake', () => {
  it('requests fresh state after reconnect without repeating executed task commands', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', Socket);
    const transport = new WebSocketTransport('ws://test');
    transport.connect();
    transport.send({ type: 'webviewReady' });
    const first = Socket.instances[0];
    first.open();
    transport.send({
      type: 'opaTaskCommand',
      action: 'create',
      requestId: 'one',
      projectPath: '/project',
      title: 'Task',
    });
    expect(first.sent.map((value) => JSON.parse(value).type)).toEqual([
      'webviewReady',
      'opaTaskCommand',
    ]);
    first.close();
    vi.advanceTimersByTime(60000);
    const next = Socket.instances.at(-1)!;
    next.open();
    expect(next.sent.map((value) => JSON.parse(value).type)).toEqual(['webviewReady']);
    transport.dispose();
  });
  it('does not duplicate an explicitly queued handshake or initialize a non-office consumer', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', Socket);
    const transport = new WebSocketTransport('ws://test');
    transport.connect();
    Socket.instances[0].open();
    Socket.instances[0].close();
    vi.advanceTimersByTime(60000);
    Socket.instances.at(-1)!.open();
    expect(Socket.instances.at(-1)!.sent).toHaveLength(0);
    Socket.instances.at(-1)!.close();
    transport.send({ type: 'webviewReady' });
    vi.advanceTimersByTime(60000);
    Socket.instances.at(-1)!.open();
    expect(Socket.instances.at(-1)!.sent.map((value) => JSON.parse(value).type)).toEqual([
      'webviewReady',
    ]);
    transport.dispose();
  });
});
