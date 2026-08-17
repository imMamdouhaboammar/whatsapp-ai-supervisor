import test from 'node:test';
import assert from 'node:assert/strict';
import { connectRealtime } from './useRealtime.ts';

test('connectRealtime authenticates with bearer header and parses SSE without putting token in URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const body = [
    'event: connected',
    'data: {"ready":true}',
    '',
    'event: message:inbound',
    'data: {"tenantId":"acme","text":"hello"}',
    '',
    'event: heartbeat',
    'data: {}',
    '',
    ''
  ].join('\n');
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const controller = new AbortController();

  await connectRealtime({
    token: 'operator-secret',
    signal: controller.signal,
    fetchImpl,
    onEvent: (event) => events.push({ type: event.type, payload: event.payload })
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/management/events');
  assert.equal(calls[0].url.includes('operator-secret'), false);
  const headers = new Headers(calls[0].init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer operator-secret');
  assert.equal(headers.get('accept'), 'text/event-stream');
  assert.deepEqual(events, [
    { type: 'connected', payload: { ready: true } },
    { type: 'message:inbound', payload: { tenantId: 'acme', text: 'hello' } },
    { type: 'heartbeat', payload: {} }
  ]);
});
