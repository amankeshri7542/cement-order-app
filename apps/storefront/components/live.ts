'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';

export type Connection = 'connecting' | 'connected' | 'disconnected' | 'offline';
export function useLiveRefresh(refresh: () => void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const [connection, setConnection] = useState<Connection>('connecting');
  useEffect(() => {
    let source: EventSource;
    const connect = () => {
      source?.close();
      source = new EventSource(`${API_URL}/events`, { withCredentials: false });
      source.onopen = () => {
        setConnection('connected');
        latest.current();
      };
      source.onerror = () => setConnection(navigator.onLine ? 'disconnected' : 'offline');
      source.onmessage = (event) => {
        try {
          const message: unknown = JSON.parse(event.data);
          if (
            message &&
            typeof message === 'object' &&
            'type' in message &&
            ['CATALOG_UPDATED', 'PRODUCT_PRICE_UPDATED', 'STORE_UPDATED'].includes(
              String(message.type),
            )
          )
            latest.current();
        } catch {
          /* Ignore malformed notifications; focus and reconnect still refresh. */
        }
      };
    };
    const hide = () => source.close();
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setConnection('connecting');
        connect();
      }
    };
    connect();
    const focus = () => {
      if (source.readyState === EventSource.CLOSED) connect();
      latest.current();
    };
    const offline = () => setConnection('offline');
    const online = () => {
      setConnection('connecting');
      latest.current();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') latest.current();
    };
    if (!navigator.onLine) setConnection('offline');
    window.addEventListener('focus', focus);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      source.close();
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('beforeunload', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return connection;
}
