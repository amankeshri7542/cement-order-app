'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@shiv/design';
import { qrStepSeconds, timeLabel } from '@shiv/shared';
import { screenApi } from '../../lib/api';
import { LanguageProvider, useT, useWords } from '../../lib/i18n';
import { startCodeLoop } from './hazri/code-loop';
import { QrCode } from './hazri/common';
import type { WallData } from './hazri/types';
import own from './shop-screen.module.css';

const tokenKey = 'shiv-shop-screen';
const readToken = () => {
  try {
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
};
const saveToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch {
    /* Storage is off: it works until this page is closed, then asks to be paired again. */
  }
};

/** Keeps the screen awake while this page is open. A browser that cannot simply does without. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const take = async () => {
      if (stopped || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) void lock.release();
      } catch {
        /* Low battery or no permission: the device's own screen settings take over. */
      }
    };
    void take();
    document.addEventListener('visibilitychange', take);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, []);
}

function Pairing({ gone, onPaired }: { gone: boolean; onPaired: (token: string) => void }) {
  const t = useT();
  const words = useWords();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await screenApi<{ token: string }>('/screen/pair', {
        method: 'POST',
        body: { code },
      });
      onPaired(token);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={own.page}>
      <div className={own.pair}>
        <h1>{t('owner.screen.pairTitle')}</h1>
        {gone && (
          <p className={own.gone} role="alert">
            {t('owner.screen.gone')}
          </p>
        )}
        <p>{t('owner.screen.pairBody')}</p>
        <form className={own.pairForm} onSubmit={(event) => void submit(event)}>
          <input
            className={own.digits}
            aria-label={t('owner.screen.digits')}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={6}
            pattern="[0-9]{6}"
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {!!error && (
            <p className={own.problem} role="alert">
              {words.error(error)}
            </p>
          )}
          <Button disabled={busy || code.length !== 6}>{t('owner.screen.pair')}</Button>
        </form>
      </div>
    </main>
  );
}

function Wall({ token, onGone }: { token: string; onGone: () => void }) {
  const t = useT();
  const [wall, setWall] = useState<WallData | null>(null);
  const [trouble, setTrouble] = useState(false);
  const [offline, setOffline] = useState(false);
  // Server time carried forward on a clock nobody can change, so the shop PC's own clock never shows.
  const clock = useRef<{ server: number; mono: number } | null>(null);
  const [shownAt, setShownAt] = useState<number | null>(null);
  useWakeLock();
  useEffect(() => {
    const loop = startCodeLoop({
      load: () => screenApi<WallData>('/screen/today', { token }),
      onWall: (next) => {
        const server = new Date(next.serverNow).getTime();
        clock.current = { server, mono: performance.now() };
        setShownAt(server);
        setWall(next);
        setTrouble(false);
      },
      onTrouble: () => setTrouble(true),
      onGone,
    });
    const look = () => {
      if (document.visibilityState === 'visible') loop.poke();
    };
    const lineChanged = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) loop.poke();
    };
    lineChanged();
    document.addEventListener('visibilitychange', look);
    window.addEventListener('online', lineChanged);
    window.addEventListener('offline', lineChanged);
    const tick = setInterval(() => {
      if (clock.current) setShownAt(clock.current.server + performance.now() - clock.current.mono);
    }, 1000);
    return () => {
      loop.stop();
      clearInterval(tick);
      document.removeEventListener('visibilitychange', look);
      window.removeEventListener('online', lineChanged);
      window.removeEventListener('offline', lineChanged);
    };
  }, [token, onGone]);
  const down = trouble || offline;
  return (
    <main className={`${own.page} ${down || wall?.attendanceOn === false ? own.banded : ''}`}>
      {down && (
        <p className={own.band} role="status">
          {t('owner.screen.offline')}
        </p>
      )}
      {wall && !wall.attendanceOn && (
        <p className={own.band} role="status">
          {t('owner.screen.notStarted')}
        </p>
      )}
      {wall ? (
        <div className={own.wall}>
          <div className={own.codeSide}>
            <QrCode text={wall.qr} className={own.qr} />
            <div className={own.life} aria-hidden="true">
              {!down && (
                <span
                  key={wall.qr}
                  style={
                    {
                      animationDuration: `${wall.msLeft}ms`,
                      '--life-from': Math.min(wall.msLeft / (qrStepSeconds * 1000), 1),
                    } as React.CSSProperties
                  }
                />
              )}
            </div>
          </div>
          <div className={own.info}>
            <h1 className={own.shop}>{wall.shopName}</h1>
            {shownAt !== null && <p className={own.time}>{timeLabel(new Date(shownAt))}</p>}
            {!!wall.people.length && (
              <ul className={own.people}>
                {wall.people.map((person, index) => (
                  <li key={`${person.name}-${index}`}>
                    <strong>{person.name}</strong>
                    <span>
                      {person.firstInAt ? timeLabel(person.firstInAt) : ''}
                      {person.lastOutAt ? ` - ${timeLabel(person.lastOutAt)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        !down && <p className={own.time} aria-busy="true" />
      )}
    </main>
  );
}

function Screen() {
  // Nothing is known until this page is running in the browser, so nothing is drawn before then.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    setToken(readToken());
  }, []);
  const paired = useCallback((next: string) => {
    saveToken(next);
    setGone(false);
    setToken(next);
  }, []);
  const turnedOff = useCallback(() => {
    saveToken(null);
    setGone(true);
    setToken(null);
  }, []);
  if (token === undefined) return <main className={own.page} />;
  return token ? (
    <Wall token={token} onGone={turnedOff} />
  ) : (
    <Pairing gone={gone} onPaired={paired} />
  );
}

/**
 * The shop screen: a browser on the shop PC or a spare phone, with nobody's login in it. It holds
 * one token that can read this wall and nothing else. A code, a clock and first names with times;
 * no "late", and nothing else, ever.
 */
export function ShopScreen() {
  return (
    <LanguageProvider>
      <Screen />
    </LanguageProvider>
  );
}
