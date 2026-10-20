'use client';
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { istToday, money, phoneDigits } from '@shiv/shared';
import styles from './design.module.css';
export * from './tokens';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  return <button {...props} className={`${styles.button} ${styles[variant]} ${className}`} />;
}
export function MoneyText({ value, signed = false }: { value: number; signed?: boolean }) {
  return (
    <span
      className={`${styles.money} ${signed ? (value > 0 ? styles.due : value < 0 ? styles.paid : '') : ''}`}
    >
      {money(signed ? Math.abs(value) : value)}
    </span>
  );
}
export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'green' | 'red' | 'blue';
}) {
  return <span className={`${styles.pill} ${styles[tone]}`}>{label}</span>;
}
export function BigNumberCard({
  label,
  value,
  tone = 'green',
  children,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'red';
  children?: ReactNode;
}) {
  return (
    <section className={`${styles.bigNumber} ${styles[tone]}`}>
      <span>{label}</span>
      <MoneyText value={value} />
      {children}
    </section>
  );
}
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className={styles.listRow}>
      {leading}
      <div className={styles.rowBody}>
        <strong>{title}</strong>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {trailing}
    </div>
  );
}
export function Sheet({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.sheet}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close.current();
        }
      }}
    >
      <div className={styles.sheetHeader}>
        <h2 id={titleId}>{title}</h2>
        <Button variant="ghost" aria-label={closeLabel} onClick={onClose}>
          ×
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  closeLabel = cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  closeLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <Sheet
      title={title}
      closeLabel={closeLabel}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <p>{body}</p>
      {children}
      <div className={styles.actions}>
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </Sheet>
  );
}
export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const labelId = useId();
  const errorId = useId();
  return (
    <label className={styles.field}>
      <span id={labelId}>{label}</span>
      {isValidElement<{ 'aria-labelledby'?: string; 'aria-describedby'?: string }>(children) &&
      typeof children.type === 'string' &&
      ['input', 'select', 'textarea'].includes(children.type)
        ? cloneElement(children, {
            'aria-labelledby': labelId,
            ...(error ? { 'aria-describedby': errorId } : {}),
          })
        : children}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </label>
  );
}
export function PhoneField({
  label,
  value,
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <span className={styles.phone}>
        <span aria-hidden="true">+91</span>
        <input
          {...props}
          aria-label={label}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={value}
          maxLength={16}
          onChange={(e) => onChange(phoneDigits(e.target.value))}
        />
      </span>
    </Field>
  );
}
export function QuantityStepper({
  label,
  value,
  onChange,
  min = 1,
  step = 1,
  max = 10000,
  decreaseLabel,
  increaseLabel,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  max?: number;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div className={styles.stepper}>
      <Button
        type="button"
        variant="secondary"
        aria-label={decreaseLabel}
        disabled={!value}
        onClick={() => onChange(value <= min ? 0 : Math.max(min, value - step))}
      >
        −
      </Button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value || ''}
        placeholder="0"
        onChange={(event) =>
          onChange(Math.min(max, Number(event.target.value.replace(/\D/g, '')) || 0))
        }
      />
      <Button
        type="button"
        variant="secondary"
        aria-label={increaseLabel}
        disabled={value ? value + step > max : min > max}
        onClick={() => onChange(value ? value + step : min)}
      >
        +
      </Button>
    </div>
  );
}
export function DateChips({
  value,
  onChange,
  labels,
}: {
  value: string;
  onChange: (value: string) => void;
  labels: { today: string; tomorrow: string; dayAfter: string; pick: string };
}) {
  const today = istToday();
  const start = new Date(`${today}T00:00:00Z`);
  const dates = [0, 1, 2].map((offset) =>
    new Date(start.getTime() + offset * 86400000).toISOString().slice(0, 10),
  );
  return (
    <div className={styles.dateChips}>
      <div>
        {dates.map((date, index) => (
          <Button
            key={date}
            type="button"
            variant={value === date ? 'primary' : 'secondary'}
            aria-pressed={value === date}
            onClick={() => onChange(date)}
          >
            {[labels.today, labels.tomorrow, labels.dayAfter][index]}
          </Button>
        ))}
      </div>
      <Field label={labels.pick}>
        <input
          type="date"
          min={today}
          max={new Date(start.getTime() + 90 * 86400000).toISOString().slice(0, 10)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
export function Toast({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div role={error ? 'alert' : 'status'} className={styles.toast}>
      {children}
    </div>
  );
}
export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <p>{title}</p>
      {action}
    </div>
  );
}
export function SearchBar(props: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...input } = props;
  return (
    <Field label={label}>
      <input {...input} type="search" />
    </Field>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {name.trim().slice(0, 2)}
    </span>
  );
}
export function BottomNav({ children, label }: { children: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className={styles.bottomNav}>
      {children}
    </nav>
  );
}
export function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className={styles.skeleton}>
      <span />
      <span />
      <span />
    </div>
  );
}
