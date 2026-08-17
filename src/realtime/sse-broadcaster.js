/**
 * Server-Sent Events (SSE) Broadcaster
 * Manages active HTTP connections, heartbeats, and broadcasts live events
 * (inbound messages, AI decisions, audit logs, WhatsApp session status).
 */

export class SseBroadcaster {
  constructor({ heartbeatIntervalMs = 15000, logger = console } = {}) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.logger = logger;
    this.clients = new Set();
    this.heartbeatTimer = null;

    if (this.heartbeatIntervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.broadcast('heartbeat', { timestamp: new Date().toISOString() });
      }, this.heartbeatIntervalMs);
      if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    }
  }

  addClient(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    res.flushHeaders?.();

    // Initial greeting / connection established
    res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() })}\n\n`);

    this.clients.add(res);

    res.on('close', () => {
      this.clients.delete(res);
    });

    return () => {
      this.clients.delete(res);
    };
  }

  broadcast(eventType, payload = {}) {
    if (this.clients.size === 0) return;

    const data = JSON.stringify(payload);
    const message = `event: ${eventType}\ndata: ${data}\n\n`;

    for (const client of this.clients) {
      try {
        client.write(message);
      } catch (err) {
        this.logger.debug?.('[sse] failed writing to client, removing:', err);
        this.clients.delete(client);
      }
    }
  }

  clientCount() {
    return this.clients.size;
  }

  close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const client of this.clients) {
      try {
        client.end();
      } catch {}
    }
    this.clients.clear();
  }
}
