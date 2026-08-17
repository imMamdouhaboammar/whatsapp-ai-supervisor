import assert from 'node:assert/strict';
import { connectRealtime, runRealtimeLoop, waitForRetry } from '../ui/src/hooks/useRealtime';

export async function runRealtimeTests() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const events: Array<{ type: string; payload: unknown }> = [];
  const connectionStates: boolean[] = [];
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
    onConnected: (connected) => connectionStates.push(connected),
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
    { type: 'message:inbound', payload: { tenantId: 'acme', text: 'hello' } }
  ]);
  assert.ok(connectionStates.length >= 2);
  assert.equal(connectionStates.every(Boolean), true);

  let attempts = 0;
  const loopController = new AbortController();
  const loopStates: boolean[] = [];
  await runRealtimeLoop({
    signal: loopController.signal,
    tokenProvider: () => 'operator-secret',
    onConnected: (connected) => loopStates.push(connected),
    retryDelayMs: 0,
    connectImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary_failure');
      loopController.abort();
    }
  });
  assert.equal(attempts, 2);
  assert.deepEqual(loopStates, [false]);

  let added = 0;
  let removed = 0;
  const fakeSignal = {
    aborted: false,
    addEventListener() { added += 1; },
    removeEventListener() { removed += 1; }
  } as unknown as AbortSignal;
  await waitForRetry(1, fakeSignal);
  assert.equal(added, 1);
  assert.equal(removed, 1);
}
