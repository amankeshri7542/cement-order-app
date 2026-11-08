'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatCount, formatMoney } from './format';
import kit from './kit.module.css';
import { axisLabel, niceTicks } from './place';
import { useKitWords } from './words';

/**
 * Small themed SVG charts (DESIGN.md, Feedback and charts), following the dataviz method: one axis,
 * thin marks, hairline grids, a legend for two or more series, one selective label, a tooltip on
 * hover and on keyboard focus, and a table with the same numbers one tap away. Colours are the
 * chart tokens in fixed order, so a series keeps its colour whatever else is shown.
 */

export type ChartTable = { head: readonly string[]; rows: readonly (readonly ReactNode[])[] };

/** A chart with its title and a "see as table" toggle. The table is never hidden from anyone. */
export function ChartFrame({
  title,
  note,
  table,
  children,
}: {
  title: string;
  note?: string;
  table: ChartTable;
  children: ReactNode;
}) {
  const say = useKitWords();
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className={kit.chartFrame} aria-labelledby={id}>
      <figcaption className={kit.chartHead}>
        <h3 id={id}>{title}</h3>
        <button
          type="button"
          className={kit.chartToggle}
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          {say(asTable ? 'kit.chart.seeChart' : 'kit.chart.seeTable')}
        </button>
      </figcaption>
      {note && <p className={kit.hint}>{note}</p>}
      {asTable ? (
        <div className={kit.tableScroll}>
          <table className={kit.table} aria-labelledby={id}>
            <thead>
              <tr>
                {table.head.map((label, index) => (
                  <th key={index} scope="col" className={index ? kit.num : undefined}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={index} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={index} className={kit.num}>
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </figure>
  );
}

/** The chart's drawn width, following its box; 640 before the browser has measured it. */
function useWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, []);
  return { box, width };
}

const series = [kit.s1, kit.s2, kit.s3, kit.s4, kit.s5];
const PAD = { top: 16, right: 12, bottom: 28, left: 56 };

function valueText(value: number, money: boolean, exact: boolean) {
  return money ? formatMoney(value, exact) : formatCount(value);
}

/** A bar whose data end is rounded 4 px and whose baseline end stays square. */
function barPath(x: number, y: number, width: number, height: number, round: boolean) {
  if (height <= 0) return '';
  const r = round ? Math.min(4, width / 2, height) : 0;
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

type Point = { label: string; values: readonly number[] };

/**
 * The shared frame of the bar, stacked bar and line charts: axis, grid, keyboard and tooltip.
 * One tab stop for the whole chart; arrow keys move from point to point.
 */
function Plot({
  label,
  points,
  names,
  money,
  exact,
  height,
  stacked,
  draw,
}: {
  label: string;
  points: readonly Point[];
  names: readonly string[];
  money: boolean;
  exact: boolean;
  height: number;
  stacked: boolean;
  draw: (frame: {
    x: (index: number) => number;
    band: number;
    y: (value: number) => number;
    active: number;
  }) => ReactNode;
}) {
  const say = useKitWords();
  const { box, width } = useWidth();
  const [active, setActive] = useState(-1);
  if (!points.length) return <p className={kit.chartEmpty}>{say('kit.chart.empty')}</p>;
  const totals = points.map((point) =>
    stacked
      ? point.values.reduce((sum, value) => sum + Math.max(0, value), 0)
      : Math.max(0, ...point.values),
  );
  // Money arrives in paise; the axis steps and their labels are in rupees.
  const unit = money ? 100 : 1;
  const ticks = niceTicks(Math.max(...totals, 0) / unit).map((tick) => tick * unit);
  const top = ticks.at(-1) || 1;
  const inner = {
    width: Math.max(80, width - PAD.left - PAD.right),
    height: height - PAD.top - PAD.bottom,
  };
  const band = inner.width / points.length;
  const x = (index: number) => PAD.left + index * band + band / 2;
  const y = (value: number) => PAD.top + inner.height - (Math.max(0, value) / top) * inner.height;
  // As many category labels as fit, evenly spread, always the first and the last.
  const room = Math.max(2, Math.floor(inner.width / 64));
  const every = Math.ceil(points.length / room);
  const shown = (index: number) =>
    index === 0 ||
    index === points.length - 1 ||
    (index % every === 0 && points.length - 1 - index >= every / 2);
  const move = (event: KeyboardEvent) => {
    const next =
      event.key === 'ArrowRight'
        ? Math.min(points.length - 1, active + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, active - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? points.length - 1
              : event.key === 'Escape'
                ? -1
                : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };
  const tip = active >= 0 ? points[active] : null;
  const tipLeft = active >= 0 ? Math.min(Math.max(x(active), 80), width - 80) : 0;
  return (
    <div ref={box} className={kit.plot}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`${label}. ${say('kit.chart.keys')}`}
        tabIndex={0}
        className={kit.plotSvg}
        onKeyDown={move}
        onFocus={() => setActive((at) => (at < 0 ? points.length - 1 : at))}
        onBlur={() => setActive(-1)}
        onPointerLeave={() => setActive(-1)}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const at = Math.floor((event.clientX - rect.left - PAD.left) / band);
          setActive(at >= 0 && at < points.length ? at : -1);
        }}
      >
        {ticks.map((tick) => (
          <g key={tick} aria-hidden="true">
            <line
              className={kit.grid}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
            />
            <text className={kit.axis} x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
              {axisLabel(tick / unit, money)}
            </text>
          </g>
        ))}
        {points.map((point, index) =>
          shown(index) ? (
            <text
              key={index}
              className={kit.axis}
              aria-hidden="true"
              x={x(index)}
              y={height - 8}
              textAnchor="middle"
            >
              {point.label}
            </text>
          ) : null,
        )}
        {draw({ x, band, y, active })}
      </svg>
      {tip && (
        <div className={kit.chartTip} style={{ left: tipLeft }} role="status">
          <span className={kit.tipLabel}>{tip.label}</span>
          {tip.values.map((value, index) => (
            <span key={index} className={kit.tipRow}>
              {names.length > 1 && (
                <span className={`${kit.tipKey} ${series[index]}`} aria-hidden="true" />
              )}
              <strong className={kit.figure}>{valueText(value, money, exact)}</strong>
              {names.length > 1 && <span>{names[index]}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ names, line = false }: { names: readonly string[]; line?: boolean }) {
  if (names.length < 2) return null;
  return (
    <ul className={kit.legend}>
      {names.map((name, index) => (
        <li key={name}>
          <span
            className={`${line ? kit.legendLine : kit.legendBox} ${series[index]}`}
            aria-hidden="true"
          />
          {name}
        </li>
      ))}
    </ul>
  );
}

/** Columns from one baseline. The tallest one carries its value; the rest are in the tooltip and table. */
export function BarChart({
  label,
  data,
  money = false,
  exact = false,
  height = 220,
}: {
  label: string;
  data: readonly { label: string; value: number }[];
  money?: boolean;
  exact?: boolean;
  height?: number;
}) {
  const points = data.map((item) => ({ label: item.label, values: [item.value] }));
  const biggest = data.reduce(
    (best, item, index) => (item.value > (data[best]?.value ?? -Infinity) ? index : best),
    0,
  );
  return (
    <Plot
      label={label}
      points={points}
      names={[label]}
      money={money}
      exact={exact}
      height={height}
      stacked={false}
      draw={({ x, band, y, active }) => {
        const thick = Math.max(2, Math.min(24, band * 0.6));
        return data.map((item, index) => {
          const top = y(item.value);
          const base = y(0);
          return (
            <g key={index} aria-hidden="true">
              <path
                className={`${kit.mark} ${kit.s1} ${active === index ? kit.markActive : ''}`}
                d={barPath(x(index) - thick / 2, top, thick, base - top, true)}
              />
              {index === biggest && item.value > 0 && (
                <text className={kit.markLabel} x={x(index)} y={top - 6} textAnchor="middle">
                  {valueText(item.value, money, exact)}
                </text>
              )}
            </g>
          );
        });
      }}
    />
  );
}

/** Parts of a whole per category, in fixed colour order, 2 px apart, with a legend. */
export function StackedBarChart({
  label,
  names,
  data,
  money = false,
  exact = false,
  height = 220,
}: {
  label: string;
  /** The parts, at most five, always in the same order. */
  names: readonly string[];
  data: readonly { label: string; parts: readonly number[] }[];
  money?: boolean;
  exact?: boolean;
  height?: number;
}) {
  const parts = names.slice(0, 5);
  return (
    <div className={kit.chartBody}>
      <Legend names={parts} />
      <Plot
        label={label}
        points={data.map((item) => ({
          label: item.label,
          values: parts.map((_, index) => item.parts[index] ?? 0),
        }))}
        names={parts}
        money={money}
        exact={exact}
        height={height}
        stacked
        draw={({ x, band, y, active }) => {
          const thick = Math.max(2, Math.min(24, band * 0.6));
          return data.map((item, index) => {
            let floor = 0;
            const values = parts.map((_, part) => Math.max(0, item.parts[part] ?? 0));
            const last = values.reduce((at, value, part) => (value > 0 ? part : at), -1);
            return (
              <g key={index} aria-hidden="true">
                {values.map((value, part) => {
                  if (value <= 0) return null;
                  const bottom = y(floor);
                  floor += value;
                  const top = y(floor);
                  // The 2 px surface gap sits between parts, never below the first.
                  const gap = part > 0 ? 2 : 0;
                  return (
                    <path
                      key={part}
                      className={`${kit.mark} ${series[part]} ${active === index ? kit.markActive : ''}`}
                      d={barPath(
                        x(index) - thick / 2,
                        top,
                        thick,
                        bottom - top - gap,
                        part === last,
                      )}
                    />
                  );
                })}
              </g>
            );
          });
        }}
      />
    </div>
  );
}

/** Change over time: 2 px lines, a crosshair on the active point, and the last value labelled. */
export function LineChart({
  label,
  names,
  data,
  money = false,
  exact = false,
  height = 220,
}: {
  label: string;
  names: readonly string[];
  data: readonly { label: string; values: readonly number[] }[];
  money?: boolean;
  exact?: boolean;
  height?: number;
}) {
  const lines = names.slice(0, 5);
  return (
    <div className={kit.chartBody}>
      <Legend names={lines} line />
      <Plot
        label={label}
        points={data.map((item) => ({
          label: item.label,
          values: lines.map((_, index) => item.values[index] ?? 0),
        }))}
        names={lines}
        money={money}
        exact={exact}
        height={height}
        stacked={false}
        draw={({ x, y, active }) => (
          <>
            {active >= 0 && (
              <line
                className={kit.crosshair}
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={height - PAD.bottom}
                aria-hidden="true"
              />
            )}
            {lines.map((_, line) => {
              const path = data
                .map((item, index) => `${x(index)},${y(item.values[line] ?? 0)}`)
                .join(' ');
              const end = data.length - 1;
              const at = active >= 0 ? active : end;
              const value = data[at]?.values[line] ?? 0;
              return (
                <g key={line} aria-hidden="true">
                  <polyline className={`${kit.line} ${series[line]}`} points={path} />
                  <circle className={`${kit.dot} ${series[line]}`} cx={x(at)} cy={y(value)} r={4} />
                  {lines.length === 1 && active < 0 && (
                    <text className={kit.markLabel} x={x(end)} y={y(value) - 10} textAnchor="end">
                      {valueText(value, money, exact)}
                    </text>
                  )}
                </g>
              );
            })}
          </>
        )}
      />
    </div>
  );
}
