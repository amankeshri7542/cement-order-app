'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Kbd } from './actions';
import { formatCount } from './format';
import kit from './kit.module.css';
import { useKitWords } from './words';

/** Is someone typing somewhere? Then "/" is a letter, not a shortcut. */
function typingIn(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) ||
    element.getAttribute('role') === 'combobox'
  );
}

/**
 * The list's own search (DESIGN.md: search first). "/" anywhere on the page puts the cursor here,
 * unless the person is already typing in a field. Escape clears it.
 */
export function SearchBox({
  label,
  value,
  onChange,
  placeholder,
  shortcut = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  shortcut?: boolean;
}) {
  const say = useKitWords();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const press = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingIn(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', press);
    return () => document.removeEventListener('keydown', press);
  }, [shortcut]);
  return (
    <div className={kit.searchBox} role="search">
      <label htmlFor={id} className={kit.hidden}>
        {label}
      </label>
      <input
        ref={input}
        id={id}
        type="search"
        className={kit.control}
        value={value}
        placeholder={placeholder ?? label}
        aria-keyshortcuts={shortcut ? '/' : undefined}
        enterKeyHint="search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
      />
      {shortcut && !value && (
        <span className={kit.searchHint} title={say('kit.search.hint')} aria-hidden="true">
          <Kbd>/</Kbd>
        </span>
      )}
      {value && (
        <button
          type="button"
          className={kit.clear}
          aria-label={say('kit.search.clear')}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

/** A filter that is on or off, with the live count of what it would show ("Kam 12"). */
export function FilterChip({
  label,
  count,
  pressed,
  onChange,
}: {
  label: string;
  count?: number;
  pressed: boolean;
  onChange: (pressed: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={kit.filterChip}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
    >
      <span>{label}</span>
      {count !== undefined && (
        <>
          {' '}
          <span className={kit.count}>{formatCount(count)}</span>
        </>
      )}
    </button>
  );
}

/**
 * The sticky row above a list: search, chips, a segmented control and a menu. It wraps on a phone
 * and never pushes the page sideways.
 */
export function FilterBar({
  label,
  search,
  chips,
  controls,
  end,
}: {
  label: string;
  search?: ReactNode;
  chips?: ReactNode;
  controls?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={kit.filterBar}>
      {search && <div className={kit.filterSearch}>{search}</div>}
      {chips && <div className={kit.filterChips}>{chips}</div>}
      {controls && <div className={kit.filterControls}>{controls}</div>}
      {end && <div className={kit.filterEnd}>{end}</div>}
    </div>
  );
}
