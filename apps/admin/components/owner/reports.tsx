'use client';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button, EmptyState } from '@shiv/design';
import { istToday, money, shortDayLabel, type MoneyReport } from '@shiv/shared';
import { isMessageKey, type MessageKey } from '@shiv/i18n';
import { api, download } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { PageHeader, Problem, QueryStatus } from './common';
import { NotYourPage } from './not-your-page';
import {
  datesOf,
  minuteTop,
  moneyScale,
  shortMoney,
  tickText,
  unitWord,
  waitText,
  type RangeName,
  type Scale,
} from './report-helpers';
import css from './owner.module.css';
import own from './reports.module.css';

type Trends = {
  historyDays: number;
  shops: {
    id: string;
    name: string;
    totalPaise: number;
    days: { date: string; moneyInPaise: number }[];
  }[];
  items: { productId: string; name: string; unit: string; quantity: number; totalPaise: number }[];
  otherItems: { products: number; totalPaise: number };
  sources: { source: string; orders: number }[];
  confirm: { date: string; orders: number; medianMinutes: number | null }[];
};
type UdhaarAge = {
  totalPaise: number;
  steps: { step: '0-30' | '31-60' | '61-90' | '90+'; paise: number }[];
};
type DayValue = { date: string; value: number };

const ranges: RangeName[] = ['7', '30', 'month'];
const THIN_BELOW_DAYS = 7;
const rampClass = [own.ramp1, own.ramp2, own.ramp3, own.ramp4];
const count = (value: number) => value.toLocaleString('en-IN');

/** A chart and, one tap away, a real table with the same numbers. */
function ChartCard({
  title,
  note,
  wide = false,
  table,
  children,
}: {
  title: string;
  note?: string;
  wide?: boolean;
  table: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={`${css.card} ${own.chart} ${wide ? own.wide : ''}`}>
      <figcaption className={own.chartHead}>
        <h2>{title}</h2>
        <Button
          type="button"
          variant="ghost"
          className={own.toggle}
          onClick={() => setAsTable(!asTable)}
        >
          {t(asTable ? 'owner.reports.seeChart' : 'owner.reports.seeTable')}
        </Button>
      </figcaption>
      {note && <p className={css.hint}>{note}</p>}
      {asTable ? <div className={own.tableWrap}>{table}</div> : children}
    </figure>
  );
}
function NumbersTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className={`${css.table} ${own.data}`}>
      <thead>
        <tr>
          {head.map((label, index) => (
            <th key={index} scope="col" className={index ? own.num : undefined}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {row.map((cell, index) => (
              <td key={index} className={index ? own.num : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function GridLines({ scale, labels = true }: { scale: Scale; labels?: boolean }) {
  return (
    <>
      {scale.lines.map((line) => (
        <span
          key={line}
          className={own.gridLine}
          style={{ insetBlockEnd: `${(line / scale.top) * 100}%` }}
        >
          {labels && <i>{shortMoney(line)}</i>}
        </span>
      ))}
    </>
  );
}
/** Columns in ink. Closed days are gaps, and only today gets the lamp. */
function Columns({
  days,
  today,
  scale,
  small = false,
}: {
  days: DayValue[];
  today: string;
  scale: Scale;
  small?: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const [active, setActive] = useState<string | null>(null);
  const shown = days.find((row) => row.date === active);
  const first = days[0];
  const last = days.at(-1);
  const middle = days[Math.floor(days.length / 2)];
  const dayName = (date: string) => shortDayLabel(date, language);
  return (
    <div>
      <div className={`${own.plot} ${small ? own.plotSmall : ''}`}>
        <GridLines scale={scale} labels={!small} />
        <div className={own.columns}>
          {days.map((row) => {
            const lit = row.date === today;
            return (
              <button
                key={row.date}
                type="button"
                className={`${own.column} ${lit ? own.today : ''}`}
                aria-label={`${dayName(row.date)}: ${money(row.value)}`}
                onMouseEnter={() => setActive(row.date)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(row.date)}
                onClick={() => setActive(row.date)}
              >
                <span
                  className={row.value > 0 ? own.hasValue : undefined}
                  style={{ blockSize: `${(Math.max(0, row.value) / scale.top) * 100}%` }}
                />
                {lit && !small && <em>{money(row.value)}</em>}
              </button>
            );
          })}
        </div>
      </div>
      {first && last && (
        <div className={`${own.axisX} ${small ? own.axisXSmall : ''}`}>
          <span>{dayName(first.date)}</span>
          {middle && days.length > 2 && <span>{dayName(middle.date)}</span>}
          <span>{last.date === today ? t('owner.reports.today') : dayName(last.date)}</span>
        </div>
      )}
      <p className={own.readout} aria-live="polite">
        {shown ? `${dayName(shown.date)}: ${money(shown.value)}` : ''}
      </p>
    </div>
  );
}
function Thin() {
  const t = useT();
  return <p className={own.thin}>{t('owner.reports.thin')}</p>;
}
function MoneyByDay({
  report,
  today,
  thin,
}: {
  report: MoneyReport;
  today: string;
  thin: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const days = report.days.map((row) => ({
    date: row.date,
    value: row.collectedPaise + row.counterPaise - row.refundsPaise,
  }));
  const max = Math.max(0, ...days.map((row) => row.value));
  return (
    <ChartCard
      wide
      title={t('owner.reports.moneyByDay')}
      table={
        <NumbersTable
          head={[t('owner.reports.col.day'), t('owner.reports.col.moneyIn')]}
          rows={days.map((row) => [shortDayLabel(row.date, language), money(row.value)])}
        />
      }
    >
      {thin ? (
        <Thin />
      ) : max ? (
        <Columns days={days} today={today} scale={moneyScale(max)} />
      ) : (
        <EmptyState title={t('owner.reports.noMoney')} />
      )}
    </ChartCard>
  );
}
/** One small chart per shop on one scale, so a small shop never looks as big as the main one. */
function ShopsCompared({
  shops,
  today,
  thin,
}: {
  shops: Trends['shops'];
  today: string;
  thin: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const first = shops[0];
  if (shops.length < 2 || !first) return null;
  const max = Math.max(0, ...shops.flatMap((shop) => shop.days.map((row) => row.moneyInPaise)));
  const scale = moneyScale(max);
  const todayIn = (shop: Trends['shops'][number]) =>
    shop.days.find((row) => row.date === today)?.moneyInPaise ?? 0;
  return (
    <ChartCard
      wide
      title={t('owner.reports.shops')}
      table={
        <NumbersTable
          head={[t('owner.reports.col.day'), ...shops.map((shop) => shop.name)]}
          rows={first.days.map((row, index) => [
            shortDayLabel(row.date, language),
            ...shops.map((shop) => money(shop.days[index]?.moneyInPaise ?? 0)),
          ])}
        />
      }
    >
      {thin ? (
        <Thin />
      ) : (
        <>
          <div className={own.shops}>
            {shops.map((shop) => (
              <div key={shop.id}>
                <div className={own.shopHead}>
                  <span>{shop.name}</span>
                  <span>{t('owner.reports.todayValue', { value: money(todayIn(shop)) })}</span>
                </div>
                <Columns
                  small
                  today={today}
                  scale={scale}
                  days={shop.days.map((row) => ({ date: row.date, value: row.moneyInPaise }))}
                />
              </div>
            ))}
          </div>
          <p className={css.hint}>
            {t('owner.reports.shopsScale', { step: shortMoney(scale.step) })}
          </p>
        </>
      )}
    </ChartCard>
  );
}
type Bar = {
  key: string;
  label: string;
  value: number;
  valueText: string;
  small?: string;
  lighter?: boolean;
};
function HBars({ bars }: { bars: Bar[] }) {
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return (
    <ul className={own.hbars}>
      {bars.map((bar) => (
        <li key={bar.key}>
          <button
            type="button"
            className={`${own.hbar} ${bar.lighter ? own.lighter : ''}`}
            aria-label={[bar.label, bar.valueText, bar.small].filter(Boolean).join(': ')}
          >
            <span className={own.hbarName}>{bar.label}</span>
            <span className={own.hbarValue}>
              {bar.valueText}
              {bar.small && <small>{bar.small}</small>}
            </span>
            <span className={own.hbarTrack}>
              <span
                className={own.hbarFill}
                style={{
                  inlineSize: bar.value ? `max(0.125rem, ${(bar.value / max) * 100}%)` : 0,
                }}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
function MoneyByItem({ trends }: { trends: Trends }) {
  const t = useT();
  const { language } = useLanguage();
  const bars: Bar[] = trends.items.map((item) => ({
    key: `${item.productId}:${item.unit}`,
    label: item.name,
    value: item.totalPaise,
    valueText: money(item.totalPaise),
    small: `${count(item.quantity)} ${unitWord(item.unit, language)}`,
  }));
  if (trends.otherItems.totalPaise > 0)
    bars.push({
      key: 'other',
      label: t('owner.reports.otherItems'),
      value: trends.otherItems.totalPaise,
      valueText: money(trends.otherItems.totalPaise),
      small: t('owner.reports.otherCount', { count: count(trends.otherItems.products) }),
      lighter: true,
    });
  return (
    <ChartCard
      title={t('owner.reports.items')}
      note={t('owner.reports.itemsNote')}
      table={
        <NumbersTable
          head={[
            t('owner.reports.col.item'),
            t('owner.reports.col.amount'),
            t('owner.reports.col.quantity'),
          ]}
          rows={bars.map((bar) => [bar.label, bar.valueText, bar.small ?? ''])}
        />
      }
    >
      {bars.length ? <HBars bars={bars} /> : <EmptyState title={t('owner.reports.noItems')} />}
    </ChartCard>
  );
}
function Sources({ trends }: { trends: Trends }) {
  const t = useT();
  const bars: Bar[] = trends.sources.map((row) => {
    const key = `owner.reports.source.${row.source}`;
    return {
      key: row.source,
      label: isMessageKey(key) ? t(key) : row.source,
      value: row.orders,
      valueText: count(row.orders),
    };
  });
  return (
    <ChartCard
      title={t('owner.reports.sources')}
      table={
        <NumbersTable
          head={[t('owner.reports.col.door'), t('owner.reports.col.orders')]}
          rows={bars.map((bar) => [bar.label, bar.valueText])}
        />
      }
    >
      {bars.some((bar) => bar.value > 0) ? (
        <HBars bars={bars} />
      ) : (
        <EmptyState title={t('owner.reports.noOrders')} />
      )}
    </ChartCard>
  );
}
function AgeOfUdhaar({ age }: { age: UdhaarAge }) {
  const t = useT();
  const stepName = (step: UdhaarAge['steps'][number]['step']) =>
    t(`owner.reports.ageStep.${step}` as MessageKey);
  return (
    <ChartCard
      title={t('owner.reports.age')}
      table={
        <NumbersTable
          head={[t('owner.reports.col.age'), t('owner.reports.col.due')]}
          rows={[
            ...age.steps.map((row) => [stepName(row.step), money(row.paise)]),
            [t('owner.reports.col.total'), money(age.totalPaise)],
          ]}
        />
      }
    >
      {age.totalPaise ? (
        <>
          <div className={own.stackBar}>
            {age.steps.map((row, index) => {
              if (!row.paise) return null;
              const share = row.paise / age.totalPaise;
              return (
                <button
                  key={row.step}
                  type="button"
                  className={`${own.segment} ${rampClass[index]}`}
                  style={{ flexGrow: row.paise }}
                  aria-label={`${stepName(row.step)}: ${money(row.paise)}`}
                >
                  {share > 0.2 ? `${Math.round(share * 100)}%` : ''}
                </button>
              );
            })}
          </div>
          <ul className={own.legend}>
            {age.steps.map((row, index) => (
              <li key={row.step}>
                <i className={rampClass[index]} aria-hidden="true" />
                {stepName(row.step)}
                <b>{money(row.paise)}</b>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState title={t('owner.reports.noUdhaar')} />
      )}
    </ChartCard>
  );
}
/** The middle wait, ending in a written label. No target line until the paper baseline exists. */
function ConfirmLine({
  rows,
  today,
  thin,
}: {
  rows: Trends['confirm'];
  today: string;
  thin: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const [active, setActive] = useState<string | null>(null);
  const dayName = (date: string) => shortDayLabel(date, language);
  const said = (row: Trends['confirm'][number]) =>
    row.medianMinutes === null ? t('owner.reports.noneTapped') : waitText(row.medianMinutes, t);
  const known = rows.flatMap((row) => (row.medianMinutes === null ? [] : [row.medianMinutes]));
  const scaleTop = minuteTop(Math.max(0, ...known));
  const point = (index: number, minutes: number) => ({
    x: ((index + 0.5) / rows.length) * 100,
    y: 100 - (minutes / scaleTop) * 100,
  });
  // A day with no orders breaks the line rather than pretending it was zero.
  const pieces: string[] = [];
  let piece: string[] = [];
  rows.forEach((row, index) => {
    if (row.medianMinutes === null) {
      if (piece.length) pieces.push(piece.join(' '));
      piece = [];
      return;
    }
    const { x, y } = point(index, row.medianMinutes);
    piece.push(`${x},${y}`);
  });
  if (piece.length) pieces.push(piece.join(' '));
  const lastIndex = rows.length - 1;
  const last = rows[lastIndex];
  const ending =
    last && last.date === today && last.medianMinutes !== null
      ? { minutes: last.medianMinutes, y: point(lastIndex, last.medianMinutes).y }
      : null;
  const shown = rows.find((row) => row.date === active);
  const first = rows[0];
  return (
    <ChartCard
      title={t('owner.reports.confirm')}
      note={t('owner.reports.confirmNote')}
      table={
        <NumbersTable
          head={[
            t('owner.reports.col.day'),
            t('owner.reports.col.wait'),
            t('owner.reports.col.orders'),
          ]}
          rows={rows.map((row) => [dayName(row.date), said(row), row.orders])}
        />
      }
    >
      {thin ? (
        <Thin />
      ) : known.length ? (
        <div>
          <div className={`${own.plot} ${own.line} ${own.plotWide}`}>
            {[0, scaleTop / 2, scaleTop].map((tick) => (
              <span
                key={tick}
                className={own.gridLine}
                style={{ insetBlockEnd: `${(tick / scaleTop) * 100}%` }}
              >
                <i>{tickText(tick, t)}</i>
              </span>
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {pieces.map((points) => (
                <polyline key={points} points={points} />
              ))}
            </svg>
            {rows.map((row, index) =>
              row.medianMinutes === null ? null : (
                <span
                  key={row.date}
                  className={own.dot}
                  style={{
                    insetInlineStart: `${point(index, row.medianMinutes).x}%`,
                    insetBlockStart: `${point(index, row.medianMinutes).y}%`,
                  }}
                />
              ),
            )}
            {ending && (
              <span
                className={`${own.endLabel} ${ending.y > 70 ? own.endLabelUp : ''}`}
                style={{ insetBlockStart: `${ending.y}%` }}
              >
                {t('owner.reports.todayWait', { time: waitText(ending.minutes, t) })}
              </span>
            )}
            <div className={own.hits}>
              {rows.map((row) => (
                <button
                  key={row.date}
                  type="button"
                  className={own.hit}
                  aria-label={`${dayName(row.date)}: ${said(row)}`}
                  onMouseEnter={() => setActive(row.date)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(row.date)}
                  onClick={() => setActive(row.date)}
                />
              ))}
            </div>
          </div>
          {first && last && (
            <div className={`${own.axisX} ${own.axisXWide}`}>
              <span>{dayName(first.date)}</span>
              <span>{last.date === today ? t('owner.reports.today') : dayName(last.date)}</span>
            </div>
          )}
          <p className={own.readout} aria-live="polite">
            {shown ? `${dayName(shown.date)}: ${said(shown)}` : ''}
          </p>
        </div>
      ) : (
        <EmptyState title={t('owner.reports.noConfirm')} />
      )}
    </ChartCard>
  );
}
function ReportPage() {
  const t = useT();
  const [range, setRange] = useState<RangeName>('30');
  const today = istToday();
  const { from, to } = datesOf(range, today);
  // Each block loads and fails on its own, so one slow chart never holds up the others.
  const report = useQuery({
    queryKey: ['owner-reports', 'money', from, to],
    queryFn: () => api<MoneyReport>(`/admin/reports/money?from=${from}&to=${to}`),
  });
  const trends = useQuery({
    queryKey: ['owner-reports', 'trends', from, to],
    queryFn: () => api<Trends>(`/admin/reports/trends?from=${from}&to=${to}`),
  });
  const age = useQuery({
    queryKey: ['owner-reports', 'udhaar-age'],
    queryFn: () => api<UdhaarAge>('/admin/reports/udhaar-age'),
  });
  const exportFile = useAction(() =>
    download(`/admin/reports/export?from=${from}&to=${to}`, `shiv-${from}-${to}.csv`),
  );
  const thin = !!trends.data && trends.data.historyDays < THIN_BELOW_DAYS;
  return (
    <div className={own.page}>
      <PageHeader title={t('owner.reports.title')} sub={t('owner.reports.subtitle')}>
        <Button
          variant="secondary"
          disabled={exportFile.isPending}
          onClick={() => exportFile.mutate(undefined)}
        >
          <Download size={18} aria-hidden="true" />
          {t('owner.reports.csv')}
        </Button>
      </PageHeader>
      <Problem error={exportFile.error} />
      <div className={own.ranges} role="group" aria-label={t('owner.reports.rangeLabel')}>
        {ranges.map((name) => (
          <Button
            key={name}
            variant={name === range ? 'primary' : 'secondary'}
            aria-pressed={name === range}
            onClick={() => setRange(name)}
          >
            {t(`owner.reports.range.${name}` as MessageKey)}
          </Button>
        ))}
      </div>
      <QueryStatus query={report} />
      {report.data && (
        <div className={own.figures}>
          {(
            [
              ['owner.reports.figure.moneyIn', money(report.data.netPaise)],
              ['owner.reports.figure.orders', count(report.data.orders.placed)],
              ['owner.reports.figure.given', money(report.data.creditSalesPaise)],
              ['owner.reports.figure.back', money(report.data.creditPaymentsPaise)],
            ] as const
          ).map(([label, value]) => (
            <div className={own.figure} key={label}>
              <strong>{value}</strong>
              <span>{t(label)}</span>
            </div>
          ))}
        </div>
      )}
      <div className={own.charts}>
        {report.data && <MoneyByDay report={report.data} today={today} thin={thin} />}
        <QueryStatus query={trends} />
        {trends.data && (
          <>
            <ShopsCompared shops={trends.data.shops} today={today} thin={thin} />
            <MoneyByItem trends={trends.data} />
            <Sources trends={trends.data} />
          </>
        )}
        <QueryStatus query={age} />
        {age.data && <AgeOfUdhaar age={age.data} />}
        {trends.data && <ConfirmLine rows={trends.data.confirm} today={today} thin={thin} />}
      </div>
    </div>
  );
}
/** Money received, shop by shop and day by day. Reads only. */
export function Reports() {
  const { can } = useOwner();
  return can('reports.read') ? <ReportPage /> : <NotYourPage />;
}
