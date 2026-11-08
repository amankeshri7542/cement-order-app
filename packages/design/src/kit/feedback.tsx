'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from '../design.module.css';
import { Button, IconButton } from './actions';
import kit from './kit.module.css';
import { useKitWords } from './words';

/**
 * A short message at the bottom of the screen. With `action` it carries an undo for an inline edit
 * (DESIGN.md: undo instead of a confirm). With `onClose` and `duration` it leaves by itself, but not
 * while the pointer or the keyboard is on it, so nobody loses an undo they are reaching for.
 */
export function Toast({
  children,
  error = false,
  action,
  onClose,
  duration = 6000,
}: {
  children: ReactNode;
  error?: boolean;
  action?: { label: string; onPress: () => void };
  onClose?: () => void;
  duration?: number;
}) {
  const say = useKitWords();
  const [held, setHeld] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!close.current || held) return;
    const timer = setTimeout(() => close.current?.(), duration);
    return () => clearTimeout(timer);
  }, [held, duration]);
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`${styles.toast} ${kit.toast} ${error ? kit.toastError : ''}`}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className={kit.toastText}>{children}</span>
      {action && (
        <button
          type="button"
          className={kit.toastAction}
          onClick={() => {
            action.onPress();
            close.current?.();
          }}
        >
          {action.label}
        </button>
      )}
      {onClose && (
        <IconButton
          label={say('kit.dismiss')}
          icon="×"
          className={kit.toastClose}
          onClick={onClose}
        />
      )}
    </div>
  );
}

/**
 * A notice at the top of the area it is about (DESIGN.md, Feedback). An error says what was saved
 * and what was not, and is announced at once; information and warnings wait their turn.
 */
export function Banner({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
}: {
  tone?: 'info' | 'warn' | 'error';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const say = useKitWords();
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`${kit.banner} ${kit[`banner_${tone}`]}`}
    >
      <span className={kit.bannerMark} aria-hidden="true">
        {tone === 'error' ? '!' : tone === 'warn' ? '!' : 'i'}
      </span>
      <div className={kit.bannerBody}>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className={kit.bannerAction}>{action}</div>}
      {onDismiss && (
        <IconButton label={say('kit.dismiss')} icon="×" size="sm" onClick={onDismiss} />
      )}
    </div>
  );
}

/**
 * What will appear here, and the one thing to do about it (DESIGN.md, states). `action` may be a
 * button or, as older pages pass it, a line of text.
 */
export function EmptyState({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`${styles.empty} ${kit.empty}`}>
      {icon && (
        <span className={kit.emptyIcon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={kit.emptyTitle}>{title}</p>
      {body && <p className={kit.emptyBody}>{body}</p>}
      {action}
    </div>
  );
}

/** Grey shapes where rows or tiles will be, so the page does not jump when they arrive. */
export function Skeleton({
  label,
  kind = 'page',
  count = 3,
}: {
  label: string;
  kind?: 'page' | 'rows' | 'tiles';
  count?: number;
}) {
  if (kind === 'page')
    return (
      <div role="status" aria-label={label} className={styles.skeleton}>
        <span />
        <span />
        <span />
      </div>
    );
  return (
    <div
      role="status"
      aria-label={label}
      className={kind === 'rows' ? kit.skeletonRows : kit.skeletonTiles}
    >
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={kind === 'rows' ? kit.skeletonRow : kit.skeletonTile} />
      ))}
    </div>
  );
}

/** Try again, for an action that failed: one button so every error offers the same. */
export function RetryButton({ onRetry }: { onRetry: () => void }) {
  const say = useKitWords();
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
      {say('kit.retry')}
    </Button>
  );
}
