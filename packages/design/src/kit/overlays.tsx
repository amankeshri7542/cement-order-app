'use client';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './actions';
import kit from './kit.module.css';
import { place } from './place';
import { useKitWords } from './words';

const canPopover = () =>
  typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
const useBrowserLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Only after the first paint: portals and the top layer exist in the browser, not on the server. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * A panel tied to an anchor (menus, pickers, tooltips). It lives in the browser's top layer, so a
 * table's scroll area or a card never clips it, and it stays on screen: below the anchor, or above
 * when there is no room. Escape and a press outside close it.
 */
export function Popover({
  open,
  onClose,
  anchor,
  children,
  role,
  label,
  id,
  align = 'start',
  className = '',
  dismiss = true,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
  role?: 'menu' | 'dialog' | 'tooltip' | 'listbox';
  label?: string;
  id?: string;
  align?: 'start' | 'end' | 'center';
  className?: string;
  /** Close on Escape and on a press outside (tooltips manage this themselves). */
  dismiss?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const mounted = useMounted();
  const position = useCallback(() => {
    const box = panel.current;
    const at = anchor.current?.getBoundingClientRect();
    if (!box || !at) return;
    const spot = place(
      { top: at.top, left: at.left, width: at.width, height: at.height },
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { align },
    );
    box.style.top = `${spot.top}px`;
    box.style.left = `${spot.left}px`;
    box.dataset.side = spot.side;
  }, [anchor, align]);
  useBrowserLayout(() => {
    const box = panel.current;
    if (!box || !mounted) return;
    if (open) {
      if (canPopover() && !box.matches(':popover-open')) box.showPopover();
      position();
    } else if (canPopover() && box.matches(':popover-open')) box.hidePopover();
  }, [open, mounted, position]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close.current();
      anchor.current?.focus();
    };
    const move = () => position();
    if (dismiss) {
      document.addEventListener('pointerdown', away);
      document.addEventListener('keydown', key);
    }
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', move);
      window.removeEventListener('scroll', move, true);
    };
  }, [open, dismiss, anchor, position]);
  if (!mounted) return null;
  return createPortal(
    <div
      ref={panel}
      id={id}
      popover={canPopover() ? 'manual' : undefined}
      role={role}
      aria-label={label}
      hidden={!canPopover() && !open ? true : undefined}
      className={`${kit.popover} ${className}`}
    >
      {open && children}
    </div>,
    document.body,
  );
}

export type MenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/**
 * A button that opens a short list of actions (ARIA menu button). Arrows, Home and End move;
 * Enter chooses; Escape and Tab close and give focus back to the button.
 */
export function Menu({
  label,
  items,
  icon,
  variant = 'secondary',
  size = 'md',
  align = 'end',
}: {
  /** The button's words, or with `icon` its name for screen readers. */
  label: string;
  items: readonly MenuItem[];
  icon?: ReactNode;
  variant?: 'secondary' | 'quiet';
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open)
      list.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open]);
  if (!items.length) return null;
  const shut = () => {
    setOpen(false);
    button.current?.focus();
  };
  const trigger = {
    ref: button,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      setOpen(!open);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'ArrowDown' && !open) {
        event.preventDefault();
        setOpen(true);
      }
    },
  };
  return (
    <>
      {icon ? (
        <IconButton label={label} icon={icon} variant={variant} size={size} {...trigger} />
      ) : (
        <Button type="button" variant={variant} size={size} {...trigger}>
          {label}
          <span aria-hidden="true">▾</span>
        </Button>
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={button}
        role="menu"
        label={label}
        id={menuId}
        align={align}
      >
        <div
          ref={list}
          className={kit.menuList}
          onKeyDown={(event) => {
            event.stopPropagation();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]:not(:disabled)',
              ),
            );
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const go = (index: number) =>
              buttons[(index + buttons.length) % buttons.length]?.focus();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              go(at + 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              go(at - 1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              go(0);
            } else if (event.key === 'End') {
              event.preventDefault();
              go(buttons.length - 1);
            } else if (event.key === 'Tab') {
              setOpen(false);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              shut();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`${kit.menuItem} ${item.danger ? kit.menuDanger : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                shut();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

/**
 * A short explanation for a control, on hover and on keyboard focus (WCAG 1.4.13): it stays while
 * the pointer is over it, and Escape hides it. Never the only place a fact lives.
 */
export function Tooltip({ text, children }: { text: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const id = useId();
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (leave.current) clearTimeout(leave.current);
    setOpen(true);
  };
  const hide = () => {
    leave.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open]);
  useEffect(
    () => () => {
      if (leave.current) clearTimeout(leave.current);
    },
    [],
  );
  if (!isValidElement<Record<string, unknown>>(children)) return children;
  const child = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      anchor.current = node;
    },
    'aria-describedby': id,
    onPointerEnter: show,
    onPointerLeave: hide,
    onFocus: show,
    onBlur: () => setOpen(false),
  });
  return (
    <>
      {child}
      <span id={id} className={kit.hidden}>
        {text}
      </span>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        align="center"
        className={kit.tooltip}
        dismiss={false}
      >
        <span aria-hidden="true" onPointerEnter={show} onPointerLeave={hide}>
          {text}
        </span>
      </Popover>
    </>
  );
}

/**
 * The row's detail beside the list (DESIGN.md, the Drawer Rule). On a laptop it sits on the right
 * and the list stays usable; below 600 px it covers the screen with a back button. Escape closes it
 * and focus goes back to where it was. Pair it with `useOpenParam` so it has its own URL.
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const say = useKitWords();
  const heading = useId();
  const panel = useRef<HTMLElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const mounted = useMounted();
  useEffect(() => {
    if (!open) return;
    before.current = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('h2')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) close.current();
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      if (before.current?.isConnected) before.current.focus();
    };
  }, [open]);
  if (!mounted || !open) return null;
  return createPortal(
    <aside
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={heading}
      className={kit.drawer}
    >
      <header className={kit.drawerHead}>
        <button type="button" className={kit.drawerBack} onClick={onClose}>
          <span aria-hidden="true">←</span> {say('kit.back')}
        </button>
        <h2 id={heading} tabIndex={-1}>
          {title}
        </h2>
        <IconButton
          label={say('kit.close')}
          icon="×"
          className={kit.drawerClose}
          onClick={onClose}
        />
      </header>
      <div className={kit.drawerBody}>{children}</div>
      {footer && <footer className={kit.drawerFoot}>{footer}</footer>}
    </aside>,
    document.body,
  );
}

/**
 * The open row in the address (`?open=<id>`), so a link, a refresh or the back button lands on the
 * same row. Only letters, digits, `-` and `_` are accepted from the address.
 */
export function useOpenParam(name = 'open'): [string | null, (id: string | null) => void] {
  const read = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get(name);
    return value && /^[\w-]{1,100}$/.test(value) ? value : null;
  }, [name]);
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    setValue(read());
    const back = () => setValue(read());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [read]);
  const set = useCallback(
    (next: string | null) => {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set(name, next);
      else url.searchParams.delete(name);
      if (url.href !== window.location.href)
        window.history.pushState(window.history.state, '', url);
      setValue(next);
    },
    [name],
  );
  return [value, set];
}

/** A rare, blocking question (DESIGN.md: no modal when a drawer or an inline edit works). */
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const say = useKitWords();
  const box = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog
      ref={box}
      aria-labelledby={heading}
      className={kit.dialog}
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      {open && (
        <>
          <header className={kit.drawerHead}>
            <h2 id={heading}>{title}</h2>
            <IconButton label={say('kit.close')} icon="×" onClick={onClose} />
          </header>
          <div className={kit.dialogBody}>{children}</div>
          {actions && <footer className={kit.dialogActions}>{actions}</footer>}
        </>
      )}
    </dialog>
  );
}
