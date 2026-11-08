'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { istToday } from '@shiv/shared';
import { formatCount, matchOptions, parseRupees, rupeesText, shiftDay } from './format';
import kit from './kit.module.css';
import { useKitWords } from './words';

type Described = { label: string; hint?: string; error?: string; hideLabel?: boolean };

/** Label above, the control, then a hint or the error that says what to fix (DESIGN.md, Inputs). */
function Shell({
  id,
  label,
  hint,
  error,
  hideLabel,
  children,
}: Described & { id: string; children: ReactNode }) {
  return (
    <div className={kit.field}>
      <label htmlFor={id} className={hideLabel ? kit.hidden : kit.label}>
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-error`} className={kit.error} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className={kit.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
const describedBy = (id: string, { hint, error }: Described) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

export function TextInput({
  label,
  hint,
  error,
  hideLabel,
  value,
  onChange,
  type = 'text',
  ...props
}: Native &
  Described & {
    value: string;
    onChange: (value: string) => void;
    type?: 'text' | 'tel' | 'email' | 'url' | 'password';
  }) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <input
        {...props}
        id={id}
        type={type}
        className={`${kit.control} ${error ? kit.invalid : ''}`}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        onChange={(event) => onChange(event.target.value)}
      />
    </Shell>
  );
}

/**
 * A number someone types. What they type stays on screen while they type; the value is null until
 * it is a number inside the limits, and the field says so.
 */
export function NumberInput({
  label,
  hint,
  error,
  hideLabel,
  value,
  onChange,
  min,
  max,
  decimals = 0,
  unit,
  ...props
}: Omit<Native, 'min' | 'max'> &
  Described & {
    value: number | null;
    onChange: (value: number | null) => void;
    min?: number;
    max?: number;
    decimals?: number;
    unit?: string;
  }) {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) setText(value === null ? '' : String(value));
    last.current = value;
  }, [value]);
  const read = (typed: string) => {
    const clean = typed.replace(/[,\s]/g, '');
    const pattern = decimals ? new RegExp(`^-?\\d+(?:\\.\\d{0,${decimals}})?$`) : /^-?\d+$/;
    if (!pattern.test(clean)) return null;
    const number = Number(clean);
    if (!Number.isFinite(number)) return null;
    if (min !== undefined && number < min) return null;
    if (max !== undefined && number > max) return null;
    return number;
  };
  return (
    <Shell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <span className={kit.affix}>
        <input
          {...props}
          id={id}
          inputMode={decimals ? 'decimal' : 'numeric'}
          className={`${kit.control} ${kit.number} ${error ? kit.invalid : ''}`}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          onChange={(event) => {
            setText(event.target.value);
            const next = read(event.target.value);
            last.current = next;
            onChange(next);
          }}
        />
        {unit && (
          <span className={kit.suffix} aria-hidden="true">
            {unit}
          </span>
        )}
      </span>
    </Shell>
  );
}

/**
 * Rupees in, paise out. Indian commas and ₹ are fine to type; more than two decimals, letters or
 * an amount over ₹2 crore give null, and the page says what to fix.
 */
export function MoneyInput({
  label,
  hint,
  error,
  hideLabel,
  value,
  onChange,
  allowNegative = false,
  ...props
}: Native &
  Described & {
    value: number | null;
    onChange: (paise: number | null) => void;
    allowNegative?: boolean;
  }) {
  const id = useId();
  const [text, setText] = useState(rupeesText(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) setText(rupeesText(value));
    last.current = value;
  }, [value]);
  return (
    <Shell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <span className={kit.affix}>
        <span className={kit.prefix} aria-hidden="true">
          ₹
        </span>
        <input
          {...props}
          id={id}
          inputMode="decimal"
          autoComplete="off"
          className={`${kit.control} ${kit.number} ${kit.withPrefix} ${error ? kit.invalid : ''}`}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          onChange={(event) => {
            setText(event.target.value);
            const next = event.target.value.trim()
              ? parseRupees(event.target.value, allowNegative)
              : null;
            last.current = next;
            onChange(next);
          }}
          onBlur={(event) => {
            if (last.current !== null) setText(rupeesText(last.current));
            props.onBlur?.(event);
          }}
        />
      </span>
    </Shell>
  );
}

export function Select({
  label,
  hint,
  error,
  hideLabel,
  value,
  onChange,
  options,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> &
  Described & {
    value: string;
    onChange: (value: string) => void;
    options: readonly { value: string; label: string; disabled?: boolean }[];
  }) {
  const id = useId();
  return (
    <Shell id={id} label={label} hint={hint} error={error} hideLabel={hideLabel}>
      <select
        {...props}
        id={id}
        className={`${kit.control} ${error ? kit.invalid : ''}`}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/** On or off, said as a switch. The label says what is on. */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={kit.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={kit.track} aria-hidden="true">
        <span className={kit.thumb} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  indeterminate = false,
  hideLabel = false,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
  hideLabel?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className={kit.check}>
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-checked={indeterminate ? 'mixed' : checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={hideLabel ? kit.hidden : undefined}>{label}</span>
    </label>
  );
}

/**
 * One choice of a few, shown side by side (shop, period, view). Native radios, so arrow keys move
 * between choices and a screen reader says "2 of 3".
 */
export function Segmented<V extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel = true,
}: {
  label: string;
  value: V;
  onChange: (value: V) => void;
  options: readonly { value: V; label: string; count?: number }[];
  hideLabel?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={kit.segmented}>
      <legend className={hideLabel ? kit.hidden : kit.label}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={kit.segment}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            {option.label}
            {option.count !== undefined && (
              <>
                {' '}
                <span className={kit.count}>{formatCount(option.count)}</span>
              </>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A day, with quick chips. Day sheets look back (Aaj, Kal = yesterday); deliveries look ahead
 * (Aaj, Kal = tomorrow). The picker keeps to `min` and `max`.
 */
export function DateInput({
  label,
  value,
  onChange,
  direction = 'past',
  today = istToday(),
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  direction?: 'past' | 'future';
  today?: string;
  min?: string;
  max?: string;
}) {
  const say = useKitWords();
  const id = useId();
  const chips =
    direction === 'past'
      ? [
          { day: today, text: say('kit.date.today') },
          { day: shiftDay(today, -1), text: say('kit.date.yesterday') },
        ]
      : [
          { day: today, text: say('kit.date.today') },
          { day: shiftDay(today, 1), text: say('kit.date.tomorrow') },
        ];
  const lowest = min ?? (direction === 'future' ? today : undefined);
  const highest = max ?? (direction === 'past' ? today : undefined);
  return (
    <fieldset className={kit.dateInput}>
      <legend className={kit.label}>{label}</legend>
      <div className={kit.chips}>
        {chips
          .filter(({ day }) => (!lowest || day >= lowest) && (!highest || day <= highest))
          .map(({ day, text }) => (
            <button
              key={day}
              type="button"
              className={kit.chip}
              aria-pressed={value === day}
              onClick={() => onChange(day)}
            >
              {text}
            </button>
          ))}
        <label htmlFor={id} className={kit.hidden}>
          {say('kit.date.pick')}
        </label>
        <input
          id={id}
          type="date"
          className={`${kit.control} ${kit.datePick}`}
          value={value}
          min={lowest}
          max={highest}
          onChange={(event) => {
            const day = event.target.value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
            if ((lowest && day < lowest) || (highest && day > highest)) return;
            onChange(day);
          }}
        />
      </div>
    </fieldset>
  );
}

export type ComboOption = { id: string; label: string; hint?: string };

/**
 * Type to find a customer, product or supplier (ARIA combobox). Give `options` to search a list on
 * the page, or `search` to ask the server; only the answer to the latest typing is shown, so a slow
 * reply never replaces a newer one.
 */
export function Combobox({
  label,
  hint,
  error,
  value,
  onSelect,
  options,
  search,
  placeholder,
  delay = 200,
}: Described & {
  value: ComboOption | null;
  onSelect: (option: ComboOption | null) => void;
  options?: readonly ComboOption[];
  search?: (query: string, signal: AbortSignal) => Promise<readonly ComboOption[]>;
  placeholder?: string;
  delay?: number;
}) {
  const say = useKitWords();
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<readonly ComboOption[]>([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const turn = useRef(0);
  useEffect(() => {
    setQuery(value?.label ?? '');
  }, [value]);
  useEffect(() => {
    if (!open) return;
    if (options) {
      setFound(matchOptions(options, query));
      setActive(-1);
      return;
    }
    if (!search) return;
    const mine = ++turn.current;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      search(query, controller.signal)
        .then((results) => {
          if (turn.current !== mine) return;
          setFound(results.slice(0, 50));
          setActive(-1);
        })
        .catch(() => {
          if (turn.current === mine) setFound([]);
        })
        .finally(() => {
          if (turn.current === mine) setBusy(false);
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, options, search, delay]);
  const choose = (option: ComboOption) => {
    onSelect(option);
    setQuery(option.label);
    setOpen(false);
  };
  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <div className={kit.combo}>
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, hint, error })}
          autoComplete="off"
          placeholder={placeholder}
          className={`${kit.control} ${error ? kit.invalid : ''}`}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onSelect(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((at) => Math.min(found.length - 1, at + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((at) => Math.max(0, at - 1));
            } else if (event.key === 'Enter' && open && active >= 0 && found[active]) {
              event.preventDefault();
              choose(found[active]);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <ul id={listId} role="listbox" aria-label={label} className={kit.listbox} hidden={!open}>
          {found.map((option, index) => (
            <li
              key={option.id}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              className={kit.option}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
            >
              <span>{option.label}</span>
              {option.hint && <span className={kit.hint}>{option.hint}</span>}
            </li>
          ))}
          {open && !busy && found.length === 0 && (
            <li role="presentation" className={kit.quietRow}>
              {say('kit.combobox.noMatch')}
            </li>
          )}
        </ul>
        <span className={kit.hidden} aria-live="polite">
          {open
            ? busy
              ? say('kit.combobox.searching')
              : say('kit.combobox.results', { count: found.length })
            : ''}
        </span>
      </div>
    </Shell>
  );
}
