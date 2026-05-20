import test from 'node:test';
import assert from 'node:assert/strict';

import { CdpClient } from '../../src/infra/browser/cdp-client.mjs';

function createManualWebSocketClass({ sendImpl } = {}) {
  const instances = [];

  class ManualWebSocket {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.sent = [];
      this.listeners = new Map();
      instances.push(this);
    }

    addEventListener(type, handler) {
      const handlers = this.listeners.get(type) ?? new Set();
      handlers.add(handler);
      this.listeners.set(type, handlers);
    }

    removeEventListener(type, handler) {
      this.listeners.get(type)?.delete(handler);
    }

    emit(type, event = {}) {
      for (const handler of [...(this.listeners.get(type) ?? [])]) {
        handler(event);
      }
    }

    send(payload) {
      if (sendImpl) {
        return sendImpl.call(this, payload);
      }
      this.sent.push(payload);
      return undefined;
    }

    close() {
      this.closed = true;
      this.emit('close', { code: 1000, reason: 'closed' });
    }
  }

  return { instances, WebSocketImpl: ManualWebSocket };
}

async function openFakeClient({ sendImpl, timeoutMs = 100 } = {}) {
  const { instances, WebSocketImpl } = createManualWebSocketClass({ sendImpl });
  const client = new CdpClient('ws://127.0.0.1:9222/devtools/browser/test', {
    timeoutMs,
    WebSocketImpl,
  });
  const connectPromise = client.connect();
  assert.equal(instances.length, 1);
  instances[0].emit('open');
  await connectPromise;
  return { client, socket: instances[0] };
}

test('CdpClient connect times out stalled websocket handshakes', async () => {
  const { instances, WebSocketImpl } = createManualWebSocketClass();
  const client = new CdpClient('ws://127.0.0.1:9222/devtools/browser/hangs', {
    timeoutMs: 20,
    WebSocketImpl,
  });

  await assert.rejects(
    () => client.connect(),
    /Timed out connecting to CDP websocket after 20ms/u,
  );
  assert.equal(instances.length, 1);
  assert.equal(instances[0].closed, true);
});

test('CdpClient send resolves matching CDP responses and clears pending state', async () => {
  const { client, socket } = await openFakeClient();

  const sendPromise = client.send('Runtime.evaluate', { expression: '1 + 1' }, 'session-1', 1_000);
  assert.equal(client.pending.size, 1);
  const payload = JSON.parse(socket.sent[0]);
  assert.deepEqual(payload, {
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: '1 + 1' },
    sessionId: 'session-1',
  });

  socket.emit('message', {
    data: JSON.stringify({
      id: payload.id,
      result: { value: 2 },
    }),
  });

  assert.deepEqual(await sendPromise, { value: 2 });
  assert.equal(client.pending.size, 0);
});

test('CdpClient send rejects immediately when websocket send throws', async () => {
  const { client } = await openFakeClient({
    sendImpl() {
      throw new Error('socket not open');
    },
  });

  await assert.rejects(
    () => client.send('Runtime.evaluate', { expression: 'document.title' }, null, 1_000),
    /CDP Runtime\.evaluate send failed: socket not open/u,
  );
  assert.equal(client.pending.size, 0);
});

test('CdpClient close rejects pending protocol commands without waiting for command timeout', async () => {
  const { client, socket } = await openFakeClient();

  const sendPromise = client.send('Runtime.evaluate', { expression: 'document.title' }, null, 10_000);
  assert.equal(client.pending.size, 1);

  client.close();

  await assert.rejects(sendPromise, /CDP socket closed by client/u);
  assert.equal(client.pending.size, 0);
  assert.equal(socket.closed, true);
});
