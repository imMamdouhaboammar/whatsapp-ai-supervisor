import { useEffect, useState, useRef } from 'react';
import { managementToken } from '../api/client';
export interface RealtimeEvent {
  type: string;
  payload: any;
  timestamp: string;
}
export function useRealtime(onEvent?: (event: RealtimeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const eventCallbackRef = useRef(onEvent);
  eventCallbackRef.current = onEvent;
  useEffect(() => {
    let controller: AbortController | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;
    const emit = (type: string, data: string) => {
      if (type === 'heartbeat') return setConnected(true);
      try {
        const payload = JSON.parse(data);
        if (type === 'connected') setConnected(true);
        eventCallbackRef.current?.({ type, payload, timestamp: new Date().toISOString() });
      } catch {}
    };
    const consume = async (response: Response) => {
      if (!response.ok || !response.body) throw new Error(`realtime_http_${response.status}`);
      setConnected(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!isUnmounted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const match = buffer.match(/\r?\n\r?\n/);
          if (!match?.index && match?.index !== 0) break;
          const block = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          let type = 'message';
          const data: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) type = line.slice(6).trim();
            if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
          }
          if (data.length || type === 'heartbeat') emit(type, data.join('\n'));
        }
      }
    };

    const connect = async () => {
      if (isUnmounted) return;
      controller = new AbortController();
      const token = managementToken();
      const headers = new Headers({ accept: 'text/event-stream' });
      if (token) headers.set('authorization', `Bearer ${token}`);
      try {
        const response = await fetch('/api/management/events', { headers, signal: controller.signal });
        await consume(response);
      } catch {
        if (controller?.signal.aborted || isUnmounted) return;
      }
      setConnected(false);
      if (!isUnmounted) reconnectTimeout = setTimeout(() => void connect(), 3000);
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
