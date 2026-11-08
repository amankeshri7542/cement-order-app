/**
 * Where a popover, menu or tooltip goes: below its anchor and lined up with its start, flipped above
 * when there is no room below, and always kept 8 px inside the screen. Free of the DOM so it is
 * tested directly; overlays.tsx feeds it the measured boxes.
 */
export type Box = { top: number; left: number; width: number; height: number };

export function place(
  anchor: Box,
  panel: { width: number; height: number },
  screen: { width: number; height: number },
  {
    gap = 4,
    edge = 8,
    align = 'start',
  }: { gap?: number; edge?: number; align?: 'start' | 'end' | 'center' } = {},
): { top: number; left: number; side: 'below' | 'above' } {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - panel.height;
  const roomBelow = screen.height - edge - below;
  const roomAbove = anchor.top - gap - edge;
  const side = panel.height <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above';
  let top = side === 'below' ? below : above;
  top = Math.max(edge, Math.min(top, screen.height - edge - panel.height));
  let left =
    align === 'end'
      ? anchor.left + anchor.width - panel.width
      : align === 'center'
        ? anchor.left + anchor.width / 2 - panel.width / 2
        : anchor.left;
  left = Math.max(edge, Math.min(left, screen.width - edge - panel.width));
  return { top: Math.round(top), left: Math.round(left), side };
}

/** Clean axis steps: 0, 2,000, 4,000… with the top at or just above the largest value. */
export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 1000; value += step)
    ticks.push(Math.round(value * 1000) / 1000);
  return ticks;
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** An axis label: in full under 10,000, then the Indian short form (1.2L, 3Cr). */
export function axisLabel(value: number, money = false): string {
  const text =
    Math.abs(value) < 10000 ? full.format(value) : compact.format(value).replace(/\s/g, '');
  return money ? `₹${text}` : text;
}
