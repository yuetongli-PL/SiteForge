export class CdpClient {
  constructor(wsUrl, { timeoutMs = 30_000 } = {}) {
    this.wsUrl = wsUrl;
    this.defaultTimeoutMs = timeoutMs;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  async connect() {
    if (this.ws) {
      return;
    }
    const deadline = Date.now() + this.defaultTimeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const ws = new WebSocket(this.wsUrl);
          let settled = false;

          const cleanup = () => {
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
          };

          const onOpen = () => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            this.ws = ws;
            ws.addEventListener('message', (event) => this.#handleMessage(event));
            ws.addEventListener('close', (event) => this.#handleClose(event));
            ws.addEventListener('error', (event) => this.#handleSocketError(event));
            resolve();
          };

          const onError = (event) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            try {
              ws.close();
            } catch {
              // Ignore close errors on failed handshakes.
            }
            reject(new Error(`Failed to connect to CDP websocket: ${event?.message ?? 'unknown error'}`));
          };

          ws.addEventListener('open', onOpen);
          ws.addEventListener('error', onError);
        });
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw lastError ?? new Error('Failed to connect to CDP websocket');
  }

  async send(method, params = {}, sessionId, timeoutMs = this.defaultTimeoutMs) {
    if (!this.ws || this.closed) {
      throw new Error('CDP socket is not connected');
    }

    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(method, handler, { sessionId } = {}) {
    const listener = { method, handler, sessionId: sessionId ?? null };
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  waitForEvent(method, { sessionId, predicate, timeoutMs = this.defaultTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = this.on(
        method,
        (event) => {
          try {
            if (predicate && !predicate(event.params, event)) {
              return;
            }
            clearTimeout(timer);
            off();
            resolve(event);
          } catch (error) {
            clearTimeout(timer);
            off();
            reject(error);
          }
        },
        { sessionId },
      );

      timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for event ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    if (!this.ws || this.closed) {
      return;
    }
    this.closed = true;
    this.ws.close();
  }

  #handleMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'));
    } catch {
      return;
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`CDP ${pending.method} failed: ${message.error.message}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) {
      return;
    }

    const sessionId = message.sessionId ?? null;
    for (const listener of this.listeners) {
      if (listener.method !== message.method) {
        continue;
      }
      if (listener.sessionId !== null && listener.sessionId !== sessionId) {
        continue;
      }
      listener.handler({ method: message.method, params: message.params ?? {}, sessionId });
    }
  }

  #handleClose(event) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const error = new Error(`CDP socket closed: ${event.code} ${event.reason || ''}`.trim());
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  #handleSocketError(_event) {
    if (this.closed) {
      return;
    }
  }
}
