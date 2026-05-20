export class CdpClient {
  constructor(wsUrl, { timeoutMs = 30_000, WebSocketImpl = globalThis.WebSocket } = {}) {
    this.wsUrl = wsUrl;
    this.defaultTimeoutMs = timeoutMs;
    this.WebSocketImpl = WebSocketImpl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  async connect() {
    if (this.ws && !this.closed) {
      return;
    }
    if (!this.WebSocketImpl) {
      throw new Error('WebSocket implementation is not available');
    }
    const deadline = Date.now() + this.defaultTimeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        await new Promise((resolve, reject) => {
          const ws = new this.WebSocketImpl(this.wsUrl);
          let settled = false;
          let timer = null;

          const cleanup = () => {
            clearTimeout(timer);
            ws.removeEventListener('open', onOpen);
            ws.removeEventListener('error', onError);
          };

          const settle = (callback) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            callback();
          };

          const onOpen = () => {
            settle(() => {
              this.ws = ws;
              this.closed = false;
              ws.addEventListener('message', (event) => this.#handleMessage(event));
              ws.addEventListener('close', (event) => this.#handleClose(event));
              ws.addEventListener('error', (event) => this.#handleSocketError(event));
              resolve();
            });
          };

          const onError = (event) => {
            settle(() => {
              try {
                ws.close();
              } catch {
                // Ignore close errors on failed handshakes.
              }
              reject(new Error(`Failed to connect to CDP websocket: ${event?.message ?? 'unknown error'}`));
            });
          };

          timer = setTimeout(() => {
            settle(() => {
              try {
                ws.close();
              } catch {
                // Ignore close errors on timed-out handshakes.
              }
              reject(new Error(`Timed out connecting to CDP websocket after ${this.defaultTimeoutMs}ms`));
            });
          }, Math.max(1, deadline - Date.now()));

          ws.addEventListener('open', onOpen);
          ws.addEventListener('error', onError);
        });
        return;
      } catch (error) {
        lastError = error;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, remainingMs)));
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
    const payloadText = JSON.stringify(payload);

    return await new Promise((resolve, reject) => {
      let timer = null;
      const settle = (callback, value) => {
        clearTimeout(timer);
        this.pending.delete(id);
        callback(value);
      };

      timer = setTimeout(() => {
        settle(reject, new Error(`CDP timeout for ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => settle(resolve, value),
        reject: (error) => settle(reject, error),
        timer,
        method,
      });

      try {
        this.ws.send(payloadText);
      } catch (error) {
        const message = error?.message ?? String(error);
        this.pending.get(id)?.reject(new Error(`CDP ${method} send failed: ${message}`));
      }
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
    this.#rejectPending(new Error('CDP socket closed by client'));
    try {
      this.ws.close();
    } catch {
      // Ignore close errors after pending commands have been rejected.
    }
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
    this.#rejectPending(error);
  }

  #rejectPending(error) {
    for (const [id, pending] of [...this.pending]) {
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
