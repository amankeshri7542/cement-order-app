'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from '../lib/api';

export type Connection = 'connecting' | 'connected' | 'disconnected' | 'offline';
/**
 * Calls `refresh` on catalogue, price and store notifications. By default it also calls it on
 * focus, visibility, `online` and every stream (re)open, which suits read-only views. Pass
 * `messagesOnly` when the callback discards customer work (a checkout review and its consent):
 * the server re-checks every term when the order is placed.
 */
export function useLiveRefresh(refresh: () => void, { messagesOnly = false } = {}) {
  const latest = useRef(refresh);
  latest.current = refresh;
  const onlyMessages = useRef(messagesOnly);
  onlyMessages.current = messagesOnly;
  const [connection, setConnection] = useState<Connection>('connecting');
  useEffect(() => {
    let source: EventSource | undefined;
    let paused = false;
    const updateConnection = () => {
      setConnection(
        !navigator.onLine
          ? 'offline'
          : source?.readyState === EventSource.OPEN
            ? 'connected'
            : source?.readyState === EventSource.CONNECTING
              ? 'connecting'
              : 'disconnected',
      );
    };
    const connect = () => {
      if (paused) return;
      if (!navigator.onLine || (source && source.readyState !== EventSource.CLOSED)) {
        updateConnection();
        return;
      }
      source = new EventSource(`${API_URL}/events`, { withCredentials: false });
      updateConnection();
      source.onopen = () => {
        updateConnection();
        if (!onlyMessages.current) latest.current();
      };
      source.onerror = updateConnection;
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
          /* Ignore malformed notifications; focus and reconnect still refresh views. */
        }
      };
    };
    const hide = () => {
      paused = true;
      source?.close();
    };
    const resume = () => {
      if (paused) return;
      connect();
      if (!onlyMessages.current) latest.current();
    };
    const show = (event: PageTransitionEvent) => {
      paused = false;
      if (event.persisted) resume();
    };
    connect();
    const focus = resume;
    const offline = () => setConnection('offline');
    const online = resume;
    const visibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('pagehide', hide);
    window.addEventListener('beforeunload', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      hide();
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
