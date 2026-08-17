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
    let source: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isUnmounted = false;

    function connect() {
      if (isUnmounted) return;
      const token = managementToken();
      const url = `/api/management/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      source = new EventSource(url);

      source.onopen = () => {
        setConnected(true);
      };

      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (!isUnmounted) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      };

      source.addEventListener('connected', (e: MessageEvent) => {
        setConnected(true);
        try {
          const payload = JSON.parse(e.data);
          eventCallbackRef.current?.({ type: 'connected', payload, timestamp: new Date().toISOString() });
        } catch {}
      });

      source.addEventListener('message:inbound', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          eventCallbackRef.current?.({ type: 'message:inbound', payload, timestamp: new Date().toISOString() });
        } catch {}
      });

      source.addEventListener('message:decision', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          eventCallbackRef.current?.({ type: 'message:decision', payload, timestamp: new Date().toISOString() });
        } catch {}
      });

      source.addEventListener('heartbeat', () => {
        setConnected(true);
      });
    }

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (source) source.close();
    };
  }, []);

  return { connected };
}
