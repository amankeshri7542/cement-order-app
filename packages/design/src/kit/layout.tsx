'use client';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import kit from './kit.module.css';
import { useKitWords } from './words';

/**
 * The top of every page (DESIGN.md, the Eye-Level Rule): the title, one context line, the quiet
 * actions and the one main action. KPI tiles or a status line follow it, within the first 200 px.
 */
export function PageHeader({
  title,
  context,
  actions,
  main,
}: {
  title: string;
  context?: ReactNode;
  actions?: ReactNode;
  main?: ReactNode;
}) {
  return (
    <header className={kit.pageHeader}>
      <div className={kit.pageTitle}>
        <h1>{title}</h1>
        {context && <p className={kit.context}>{context}</p>}
      </div>
      {(actions || main) && (
        <div className={kit.pageActions}>
          {actions}
          {main}
        </div>
      )}
    </header>
  );
}

/** A titled part of a page, named for screen readers by its own heading. */
export function Section({
  title,
  actions,
  children,
  level = 2,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  level?: 2 | 3;
}) {
  const id = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby={id} className={kit.section}>
      <div className={kit.sectionHead}>
        <Heading id={id}>{title}</Heading>
        {actions && <div className={kit.sectionActions}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** A sheet of paper: square corners, a hairline, no shadow (DESIGN.md, Shapes). */
export function Card({
  title,
  children,
  footer,
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  return (
    <article className={kit.card} aria-labelledby={title ? id : undefined}>
      {title && (
        <h3 id={id} className={kit.cardTitle}>
          {title}
        </h3>
      )}
      <div className={kit.cardBody}>{children}</div>
      {footer && <footer className={kit.cardFoot}>{footer}</footer>}
    </article>
  );
}

/**
 * A row of related buttons (ARIA toolbar): one Tab stop, and the arrow keys move between them, so
 * the keyboard does not walk through ten buttons to reach the table.
 */
export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const items = () =>
    Array.from(
      bar.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], [role="switch"]',
      ) ?? [],
    );
  const roving = () => {
    const all = items();
    const current = all.find((item) => item.tabIndex === 0) ?? all[0];
    for (const item of all) item.tabIndex = item === current ? 0 : -1;
  };
  return (
    <div
      ref={(node) => {
        bar.current = node;
        if (node) roving();
      }}
      role="toolbar"
      aria-label={label}
      className={kit.toolbar}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const all = items();
        const at = all.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        const next =
          event.key === 'ArrowRight'
            ? (at + 1) % all.length
            : event.key === 'ArrowLeft'
              ? (at - 1 + all.length) % all.length
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? all.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        for (const item of all) item.tabIndex = -1;
        all[next]!.tabIndex = 0;
        all[next]!.focus();
      }}
    >
      {children}
    </div>
  );
}

/**
 * A list and the open item side by side on a laptop (the queue template). Below 1024 px the open
 * item takes the screen, with a back button to the list.
 */
export function SplitView({
  list,
  detail,
  open,
  onBack,
  label,
}: {
  list: ReactNode;
  detail: ReactNode;
  open: boolean;
  onBack: () => void;
  label: string;
}) {
  const say = useKitWords();
  return (
    <div className={kit.split} data-open={open || undefined}>
      <div className={kit.splitList}>{list}</div>
      <section className={kit.splitDetail} aria-label={label}>
        {open && (
          <button type="button" className={kit.splitBack} onClick={onBack}>
            <span aria-hidden="true">←</span> {say('kit.back')}
          </button>
        )}
        {detail}
      </section>
    </div>
  );
}
