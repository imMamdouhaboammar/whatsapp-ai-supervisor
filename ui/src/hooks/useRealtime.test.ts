import { describe, expect, it } from 'vitest';
import { connectRealtime } from './useRealtime';

describe('connectRealtime', () => {
  it('authenticates with bearer header and parses SSE without putting token in URL', async () => {
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

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/management/events');
    expect(calls[0].url).not.toContain('operator-secret');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('authorization')).toBe('Bearer operator-secret');
    expect(headers.get('accept')).toBe('text/event-stream');
    expect(events).toEqual([
      { type: 'connected', payload: { ready: true } },
      { type: 'message:inbound', payload: { tenantId: 'acme', text: 'hello' } },
      { type: 'heartbeat', payload: {} }
    ]);
  });
});
