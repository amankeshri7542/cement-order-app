import sharp from 'sharp';
import { palette, type RateCardItem } from '@shiv/shared';
import { displayFamily, registerCardFonts } from './fonts';

export type CardSnapshot = {
  heading: string;
  deliveryMessage: string;
  promotionalCopy: string;
  contactLabel: string;
  phone: string;
  whatsapp: string;
  publishedAt: string;
  items: RateCardItem[];
};

const dimensions = { STATUS: [1080, 1920], SQUARE: [1080, 1080], SHEET: [1240, 1754] } as const;
// The shared palette (packages/shared/src/theme.ts): warm paper ground, steel ink, white slip
// paper, and amber only for the शिव stamp and the counter's signboard rule (amber text on a
// light page is accentInk). Teko 600 sets the shop name, the
// heading, item names and prices, as on the website; the fixed-width face keeps labels,
// specifications and contact lines easy to check digit by digit.
const colors = {
  ink: palette.ink,
  ground: palette.ground,
  surface: palette.surface,
  paper: palette.paper,
  rule: palette.rule,
  muted: palette.muted,
  onInk: palette.onInk,
  onInkMuted: palette.onInkMuted,
  accent: palette.accent,
  accentInk: palette.accentInk,
  onAccent: palette.onAccent,
};
const mono = 'DejaVu Sans Mono, monospace';
const display = displayFamily;
const invalid = () => new Error('Rate card could not be rendered. Check the approved content.');

function escape(value: string): string {
  // XML forbids these control characters even after entity escaping.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value)) throw invalid();
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
  );
}

function money(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0 || paise > 2_000_000_000) throw invalid();
  return `₹${Math.floor(paise / 100).toLocaleString('en-IN')}.${String(paise % 100).padStart(2, '0')}`;
}

// Conservative character widths: the fixed-width detail font, or condensed Teko (its widest
// Latin letters are listed, every other Latin letter is at most half an em, and no Devanagari
// letter is wider than 0.92 em). Split long tokens, never truncate a specification; oversized
// rows continue on the following page.
function wrap(value: string, width: number, size: number, family = mono): string[] {
  const teko = family === display;
  const latin = (letter: string) => (!teko ? 0.69 : /[%@Wm~w^M#&]/.test(letter) ? 0.81 : 0.5);
  const other = (letter: string) => (teko && /[\u0900-\u097F]/u.test(letter) ? 0.92 : 1.2);
  const space = teko ? 0.5 : 0.69;
  const lines: string[] = [];
  let line = '';
  let occupied = 0;
  for (const word of value.trim().split(/\s+/u).filter(Boolean)) {
    const letters = Array.from(word);
    const measure = (letter: string) =>
      /\p{Mark}/u.test(letter)
        ? 0
        : size * (/^[\x20-\x7E]$/.test(letter) ? latin(letter) : other(letter));
    const wordWidth = letters.reduce((sum, letter) => sum + measure(letter), 0);
    if (line && occupied + size * space + wordWidth > width) {
      lines.push(line);
      line = '';
      occupied = 0;
    }
    if (line) {
      line += ' ';
      occupied += size * space;
    }
    for (const letter of letters) {
      const amount = measure(letter);
      if (line && occupied + amount > width) {
        lines.push(line);
        line = '';
        occupied = 0;
      }
      line += letter;
      occupied += amount;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type Line = {
  value: string;
  size: number;
  color: string;
  weight: number;
  height: number;
  family: string;
};
type Segment = { index: number; continued: boolean; lines: Line[]; height: number };
const text = (
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  weight = 400,
  family = mono,
) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}">${escape(value)}</text>`;

export function renderRateCardPages(
  snapshot: CardSnapshot,
  format: 'STATUS' | 'SQUARE' | 'SHEET',
  template: 'COUNTER' | 'BULLETIN',
): string[] {
  if (
    !dimensions[format] ||
    !['COUNTER', 'BULLETIN'].includes(template) ||
    !snapshot.items.length ||
    snapshot.items.length > 100
  )
    throw invalid();
  for (const value of [
    snapshot.heading,
    snapshot.deliveryMessage,
    snapshot.promotionalCopy,
    snapshot.contactLabel,
    snapshot.phone,
    snapshot.whatsapp,
    ...snapshot.items.flatMap((item) => [item.name, item.brand, item.specification, item.unit]),
  ]) {
    if (typeof value !== 'string' || value.length > 1000) throw invalid();
    escape(value);
  }
  if (!snapshot.heading.trim() || !snapshot.phone.trim() || !snapshot.whatsapp.trim())
    throw invalid();
  const instant = new Date(snapshot.publishedAt);
  if (!Number.isFinite(instant.getTime())) throw invalid();
  const date = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  const [width, height] = dimensions[format];
  const margin = 56;
  const inner = width - margin * 2;
  // Teko's Devanagari vowel signs rise 0.85 em and its lower signs drop 0.27 em, so heading
  // lines sit 1.15 em apart.
  const heading = wrap(snapshot.heading, inner, 48, display);
  const headerEnd = 166 + heading.length * 56;
  const footerLines: Line[] = [];
  const addFooter = (value: string, color: string, weight = 400) => {
    for (const line of wrap(value, inner - 40, 22))
      footerLines.push({ value: line, size: 22, height: 30, color, weight, family: mono });
  };
  addFooter(snapshot.promotionalCopy, colors.ink, 700);
  addFooter(snapshot.deliveryMessage, colors.ink);
  addFooter(snapshot.contactLabel, colors.accentInk, 700);
  // These values come only from the persisted, server-owned store snapshot.
  addFooter(`CALL ${snapshot.phone}`, colors.ink, 700);
  addFooter(`WHATSAPP ${snapshot.whatsapp}`, colors.ink, 700);
  const footerHeight = footerLines.length * 30 + 68;
  const footerTop = height - margin - footerHeight;
  const tableTop = headerEnd + 42;
  const capacity = footerTop - 22 - tableTop;
  if (capacity < 150) throw invalid();
  const pages: Segment[][] = [[]];
  let used = 0;
  for (const [index, item] of snapshot.items.entries()) {
    money(item.pricePaise);
    if (!item.name.trim() || !item.unit.trim()) throw invalid();
    const lines: Line[] = [];
    for (const [value, size, color, weight, family, height] of [
      [item.brand, 22, colors.muted, 700, mono, 31],
      [item.name, 38, colors.ink, 600, display, 44],
      [item.specification, 22, colors.ink, 400, mono, 31],
      [`PER ${item.unit}`, 22, colors.ink, 700, mono, 31],
    ] as const) {
      for (const line of wrap(value, inner - 48, size, family))
        lines.push({ value: line, size, color, weight, height, family });
    }
    let continued = false;
    while (lines.length) {
      const wholeHeight = 92 + lines.reduce((sum, line) => sum + line.height, 0);
      // Start a fresh page if the complete row fits there. Split only when a row
      // is taller than an entire page, preserving readable fixed font sizes.
      if (used && wholeHeight > capacity - used) {
        pages.push([]);
        used = 0;
      }
      let rowHeight = 92;
      const chunk: Line[] = [];
      while (lines.length && rowHeight + lines[0]!.height <= capacity - used) {
        const line = lines.shift()!;
        chunk.push(line);
        rowHeight += line.height;
      }
      if (!chunk.length) throw invalid();
      pages.at(-1)!.push({ index, continued, lines: chunk, height: rowHeight });
      used += rowHeight + 14;
      continued = true;
    }
  }
  return pages.map((segments, pageIndex) => {
    const counter = template === 'COUNTER';
    const pageColor = counter ? colors.ground : colors.paper;
    const headingColor = counter ? colors.onInk : colors.ink;
    const stamp = 104;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
      `<title id="title">${escape(`Shiv Cement Store — ${snapshot.heading} — ${pageIndex + 1}/${pages.length}`)}</title>`,
      `<desc id="description">${escape(`Approved rates published ${date} IST. Prices and units are printed for each material. Page ${pageIndex + 1} of ${pages.length}.`)}</desc>`,
      `<metadata>${escape(JSON.stringify({ format, template, page: pageIndex + 1, pages: pages.length, publishedAt: snapshot.publishedAt, phone: snapshot.phone, whatsapp: snapshot.whatsapp, items: segments.map(({ index }) => ({ ...snapshot.items[index], formattedPrice: money(snapshot.items[index]!.pricePaise) })) }))}</metadata>`,
      `<rect width="${width}" height="${height}" fill="${pageColor}"/>`,
      counter
        ? `<rect width="${width}" height="${headerEnd}" fill="${colors.ink}"/><rect y="${headerEnd - 8}" width="${width}" height="8" fill="${colors.accent}"/>`
        : `<rect x="0" width="16" height="${height}" fill="${colors.ink}"/><path d="M${margin} ${headerEnd - 8}H${width - margin}" stroke="${colors.ink}" stroke-width="3"/>`,
      // The shop's stamp: an amber square with शिव, as on the signboard, the app and the website.
      `<rect x="${width - margin - stamp}" y="36" width="${stamp}" height="${stamp}" fill="${colors.accent}"/>`,
      `<text x="${width - margin - stamp / 2}" y="${36 + stamp / 2 + 24}" text-anchor="middle" font-family="${display}" font-size="62" font-weight="600" fill="${colors.onAccent}">शिव</text>`,
      text('SHIV', margin, 98, 84, headingColor, 600, display),
      text('CEMENT STORE', margin + 146, 98, 44, headingColor, 600, display),
      text(
        'MATERIAL RATE BULLETIN',
        margin,
        130,
        18,
        counter ? colors.onInkMuted : colors.muted,
        700,
      ),
    ];
    heading.forEach((line, index) =>
      parts.push(text(line, margin, 186 + index * 56, 48, headingColor, 600, display)),
    );
    parts.push(text(`PUBLISHED / AS OF ${date} IST`, margin, headerEnd + 27, 18, colors.ink, 700));
    let y = tableTop;
    for (const segment of segments) {
      const item = snapshot.items[segment.index]!;
      parts.push(
        `<g data-item-index="${segment.index}" data-continued="${segment.continued}"><title>${escape(`${item.name}: ${money(item.pricePaise)} per ${item.unit}`)}</title>`,
      );
      parts.push(
        `<rect x="${margin}" y="${y}" width="${inner}" height="${segment.height}" fill="${counter ? colors.paper : colors.surface}" stroke="${counter ? colors.paper : colors.rule}" stroke-width="2"/>`,
      );
      parts.push(
        `<rect x="${margin}" y="${y}" width="6" height="${segment.height}" fill="${colors.ink}"/>`,
      );
      parts.push(
        text(
          `${String(segment.index + 1).padStart(2, '0')} / ${segment.continued ? 'CONTINUED' : 'APPROVED RATE'}`,
          margin + 24,
          y + 37,
          18,
          colors.muted,
          700,
        ),
      );
      const amount = money(item.pricePaise);
      parts.push(
        `<text x="${width - margin - 24}" y="${y + 50}" text-anchor="end" font-family="${display}" font-size="52" font-weight="600" fill="${colors.ink}" data-price-paise="${item.pricePaise}">${escape(amount)}</text>`,
      );
      let lineY = y + 64;
      for (const line of segment.lines) {
        lineY += line.height;
        parts.push(
          text(line.value, margin + 24, lineY, line.size, line.color, line.weight, line.family),
        );
      }
      parts.push('</g>');
      y += segment.height + 14;
    }
    parts.push(
      `<path d="M${margin} ${footerTop}H${width - margin}" stroke="${colors.ink}" stroke-width="2"/>`,
    );
    footerLines.forEach((line, index) =>
      parts.push(
        text(line.value, margin, footerTop + 34 + index * 30, line.size, line.color, line.weight),
      ),
    );
    parts.push(text('SHIV / RATE STUDIO', margin, height - margin, 17, colors.muted, 700));
    parts.push(
      `<text x="${width - margin}" y="${height - margin}" text-anchor="end" font-family="${mono}" font-size="17" fill="${colors.ink}">PAGE ${pageIndex + 1} / ${pages.length}</text></svg>`,
    );
    return parts.join('');
  });
}

export async function rateCardPng(svg: string): Promise<Buffer> {
  registerCardFonts();
  try {
    return await sharp(Buffer.from(svg), { limitInputPixels: 3_000_000, density: 72 })
      .png()
      .toBuffer();
  } catch {
    throw new Error(
      'Rate card image could not be generated. Try downloading the SVG or retry later.',
    );
  }
}
