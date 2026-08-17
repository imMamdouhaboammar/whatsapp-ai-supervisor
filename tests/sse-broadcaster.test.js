import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SseBroadcaster } from '../src/realtime/sse-broadcaster.js';

class FakeResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = {};
    this.written = [];
    this.ended = false;
  }
  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }
  write(data) {
    this.written.push(data);
  }
  end() {
    this.ended = true;
    this.emit('close');
  }
}

test('SseBroadcaster sets up SSE headers, sends connected event, and tracks client count', () => {
  const broadcaster = new SseBroadcaster({ heartbeatIntervalMs: 0 });
  const res = new FakeResponse();

  const cleanup = broadcaster.addClient(res);
  assert.equal(broadcaster.clientCount(), 1);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.match(res.written[0], /event: connected/);

  broadcaster.broadcast('message:new', { text: 'Hello' });
  assert.equal(res.written.length, 2);
  assert.match(res.written[1], /event: message:new/);
  assert.match(res.written[1], /"text":"Hello"/);

  cleanup();
  assert.equal(broadcaster.clientCount(), 0);
  broadcaster.close();
});

test('SseBroadcaster automatically handles client disconnects', () => {
  const broadcaster = new SseBroadcaster({ heartbeatIntervalMs: 0 });
  const res = new FakeResponse();

  broadcaster.addClient(res);
  assert.equal(broadcaster.clientCount(), 1);

  res.emit('close');
  assert.equal(broadcaster.clientCount(), 0);
  broadcaster.close();
});
