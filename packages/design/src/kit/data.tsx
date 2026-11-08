'use client';
import type { ReactNode } from 'react';
import { dateLabel, dayLabel, momentLabel } from '@shiv/shared';
import { Button } from './actions';
import { changeOf, formatCount, formatMoney, formatQty, pageRange, sparkPoints } from './format';
import kit from './kit.module.css';
import { useKitLanguage, useKitWords } from './words';

/**
 * Money, right-aligned in tabular figures. `exact` (the default, as pages before the kit expect)
 * keeps paise; pass `exact={false}` for whole rupees. `signed` colours a due red and an advance
 * green and drops the sign. `zero="dash"` shows "—" instead of a wall of ₹0.00.
 */
export function MoneyText({
  value,
  exact = true,
  signed = false,
  zero = 'show',
  strong = true,
}: {
  value: number;
  exact?: boolean;
  signed?: boolean;
  zero?: 'show' | 'dash';
  strong?: boolean;
}) {
  const say = useKitWords();
  if (zero === 'dash' && value === 0)
    return (
      <span className={kit.figure} aria-label={say('kit.none')}>
        —
      </span>
    );
  const tone = signed ? (value > 0 ? kit.due : value < 0 ? kit.advance : '') : '';
  return (
    <span className={`${kit.figure} ${strong ? kit.strong : ''} ${tone}`}>
      {formatMoney(signed ? Math.abs(value) : value, exact)}
    </span>
  );
}

export function QtyText({
  value,
  unit,
  zero = 'show',
}: {
  value: number;
  unit?: string;
  zero?: 'show' | 'dash';
}) {
  const say = useKitWords();
  if (zero === 'dash' && value === 0)
    return (
      <span className={kit.figure} aria-label={say('kit.none')}>
        —
      </span>
    );
  return <span className={kit.figure}>{formatQty(value, unit)}</span>;
}

/** A date or a moment in Patna time, in the page's language: "8 Nov 2026", "8 नव॰ 2026 · 14:56". */
export function DateText({ value, time = false }: { value: string; time?: boolean }) {
  const language = useKitLanguage();
  const text = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dayLabel(value, language)
    : time
      ? momentLabel(value, language)
      : dateLabel(value, language);
  return (
    <time dateTime={value} className={kit.figure}>
      {text}
    </time>
  );
}

/** The one vocabulary of statuses (DESIGN.md), each with one meaning and one colour. */
export const stamps = {
  due: 'warn',
  waiting: 'warn',
  open: 'neutral',
  onTheWay: 'neutral',
  closed: 'neutral',
  confirmed: 'ok',
  delivered: 'ok',
  paid: 'ok',
  difference: 'danger',
  cancelled: 'danger',
} as const;
export type StampKind = keyof typeof stamps;

export function StatusStamp({ kind }: { kind: StampKind }) {
  const say = useKitWords();
  return (
    <span className={`${kit.stamp} ${kit[`stamp_${stamps[kind]}`]}`} data-stamp={kind}>
      {say(`kit.stamp.${kind}`)}
    </span>
  );
}

/** A total under the ledger's double rule. */
export function LedgerTotal({
  label,
  value,
  exact = true,
  children,
}: {
  label: string;
  value: number;
  exact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={kit.ledgerTotal}>
      <span>{label}</span>
      {children}
      <MoneyText value={value} exact={exact} />
    </div>
  );
}

/** A small trend line for a KPI tile: the shape only, the numbers are elsewhere. */
export function Sparkline({ values }: { values: readonly number[] }) {
  const points = sparkPoints(values, 96, 24);
  if (!points) return null;
  return (
    <svg className={kit.spark} viewBox="0 0 96 24" aria-hidden="true" focusable="false">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * A figure at the top of a page (DESIGN.md, KPI tiles). With `onSelect` the tile is the filter it
 * names: pressing it shows only those rows, and it stays pressed while that filter is on.
 */
export function KpiTile({
  label,
  value,
  kind = 'money',
  exact = false,
  before,
  trend,
  goodWhen = 'up',
  selected,
  onSelect,
}: {
  label: string;
  value: number;
  kind?: 'money' | 'count';
  exact?: boolean;
  before?: number | null;
  trend?: readonly number[];
  goodWhen?: 'up' | 'down';
  selected?: boolean;
  onSelect?: () => void;
}) {
  const say = useKitWords();
  const change = changeOf(value, before);
  const figure = kind === 'money' ? formatMoney(value, exact) : formatCount(value);
  const changeText = change
    ? change.direction === 'same'
      ? say('kit.kpi.same')
      : say(change.direction === 'up' ? 'kit.kpi.up' : 'kit.kpi.down', {
          value: `${change.share}%`,
        })
    : null;
  const good = change && change.direction !== 'same' && change.direction === goodWhen;
  const body = (
    <>
      <span className={kit.kpiLabel}>{label}</span>
      <span className={`${kit.figure} ${kit.kpiFigure}`}>{figure}</span>
      {changeText && (
        <span
          className={`${kit.kpiChange} ${change?.direction === 'same' ? '' : good ? kit.goodChange : kit.badChange}`}
        >
          {changeText}
        </span>
      )}
      {trend && <Sparkline values={trend} />}
    </>
  );
  if (!onSelect) return <div className={kit.kpi}>{body}</div>;
  return (
    <button
      type="button"
      className={`${kit.kpi} ${kit.kpiButton}`}
      aria-pressed={selected ?? false}
      title={say('kit.kpi.filter', { name: label })}
      onClick={onSelect}
    >
      {body}
    </button>
  );
}

/**
 * "1–50 of 1,240" with previous and next. Cursor paging: the page keeps the cursors it has seen,
 * so previous is always one step back. A total above 10,000 is an estimate and says "about".
 */
export function Pager({
  offset,
  shown,
  total,
  onPrevious,
  onNext,
  busy = false,
}: {
  offset: number;
  shown: number;
  total?: { value: number; exact: boolean } | null;
  onPrevious?: () => void;
  onNext?: () => void;
  busy?: boolean;
}) {
  const say = useKitWords();
  const range = pageRange(offset, shown);
  const text = !range
    ? ''
    : !total
      ? say('kit.pager.rangeOpen', { from: formatCount(range.from), to: formatCount(range.to) })
      : say(total.exact ? 'kit.pager.range' : 'kit.pager.rangeAbout', {
          from: formatCount(range.from),
          to: formatCount(range.to),
          total: formatCount(total.value),
        });
  return (
    <nav className={kit.pager} aria-label={say('kit.pager.label')}>
      <span className={kit.figure} aria-live="polite">
        {text}
      </span>
      <span className={kit.pagerButtons}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!onPrevious || busy}
          onClick={onPrevious}
        >
          {say('kit.pager.prev')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!onNext || busy}
          loading={busy}
          onClick={onNext}
        >
          {say('kit.pager.next')}
        </Button>
      </span>
    </nav>
  );
}
