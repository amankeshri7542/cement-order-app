'use client';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from '../design.module.css';
import kit from './kit.module.css';
import { useKitWords } from './words';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md';

/**
 * Plain and firm (DESIGN.md, Buttons): one amber primary per screen, secondary on paper, quiet for
 * everything else, danger as red text. `sm` is for dense laptop toolbars; below 1024 px every
 * button keeps the 48 px touch size. `loading` keeps the label, shows it is working and refuses a
 * second press, so a slow network never makes two of anything.
 */
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
  }
>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    className = '',
    children,
    disabled,
    ...props
  },
  ref,
) {
  const say = useKitWords();
  // 'ghost' is the old name of 'quiet'; pages written before the kit still pass it.
  const look = variant === 'ghost' ? 'ghost' : variant;
  return (
    <button
      ref={ref}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${styles.button} ${styles[look]} ${size === 'sm' ? kit.small : ''} ${className}`}
    >
      {loading && <span className={kit.spinner} aria-hidden="true" />}
      {children}
      {loading && <span className={kit.hidden}>{say('kit.busy')}</span>}
    </button>
  );
});

/** A button that is only an icon. It always has a name for screen readers. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
    label: string;
    icon: ReactNode;
    variant?: Exclude<ButtonVariant, 'primary'>;
    size?: ButtonSize;
  }
>(function IconButton(
  { label, icon, variant = 'quiet', size = 'md', className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={`${styles.button} ${styles[variant]} ${kit.iconButton} ${size === 'sm' ? kit.small : ''} ${className}`}
    >
      <span aria-hidden="true" className={kit.icon}>
        {icon}
      </span>
    </button>
  );
});

/** A key on the keyboard, as in "press /". */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={kit.kbd}>{children}</kbd>;
}
