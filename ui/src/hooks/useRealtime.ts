import { useEffect, useRef, useState } from 'react';
import { managementToken } from '../api/client';

export interface RealtimeEvent {
  type: string;
  payload: unknown;
  timestamp: string;
}

interface ConnectRealtimeOptions {
  token?: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  onConnected?: (connected: boolean) => void;
  onEvent?: (event: RealtimeEvent) => void;
}

function parseSseBlock(block: string) {
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return { type, data: data.join('\n') };
}

export async function connectRealtime({
  token = '',
  signal,
  fetchImpl = fetch,
  onConnected = () => {},
  onEvent
}: ConnectRealtimeOptions) {
  const headers = new Headers({ accept: 'text/event-stream' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetchImpl('/api/management/events', { headers, signal });
  if (!response.ok || !response.body) throw new Error(`realtime_http_${response.status}`);

  onConnected(true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    for (;;) {
      const separator = buffer.match(/\r?\n\r?\n/);
      if (!separator || separator.index === undefined) break;
      const block = buffer.slice(0, separator.index);
      buffer = buffer.slice(separator.index + separator[0].length);
      const event = parseSseBlock(block);
      if (event.type === 'heartbeat') {
        onConnected(true);
        continue;
      }
      if (!event.data) continue;
      try {
        const payload = JSON.parse(event.data);
        if (event.type === 'connected') onConnected(true);
        onEvent?.({ type: event.type, payload, timestamp: new Date().toISOString() });
      } catch {}
    }
  }
}

export function useRealtime(onEvent?: (event: RealtimeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const eventCallbackRef = useRef(onEvent);
  eventCallbackRef.current = onEvent;

  useEffect(() => {
    let controller: AbortController | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    const connect = async () => {
      if (isUnmounted) return;
      controller = new AbortController();
      try {
        await connectRealtime({
          token: managementToken(),
          signal: controller.signal,
          onConnected: setConnected,
          onEvent: (event) => eventCallbackRef.current?.(event)
        });
      } catch {
        if (controller.signal.aborted || isUnmounted) return;
      }
      if (isUnmounted) return;
      setConnected(false);
      reconnectTimeout = setTimeout(() => void connect(), 3000);
    };

    void connect();
    return () => {
      isUnmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      controller?.abort();
    };
  }, []);

  return { connected };
}
