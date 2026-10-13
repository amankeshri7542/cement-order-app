import sharp from 'sharp';
import type { RateCardItem } from '@shiv/shared';

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
const colors = {
  ink: '#252C2B',
  concrete: '#E7E6E1',
  paper: '#F7F6F1',
  sand: '#D9C9A8',
  amber: '#E9AD32',
  green: '#386451',
};
const mono = 'DejaVu Sans Mono, monospace';
const sans = 'DejaVu Sans, sans-serif';
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

// Conservative character widths for the fixed-width detail font. Split long tokens,
// never truncate a specification; oversized rows continue on the following page.
function wrap(value: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = '';
  let occupied = 0;
  for (const word of value.trim().split(/\s+/u).filter(Boolean)) {
    const letters = Array.from(word);
    const measure = (letter: string) =>
      /\p{Mark}/u.test(letter) ? 0 : size * (/^[\x20-\x7E]$/.test(letter) ? 0.69 : 1.2);
    const wordWidth = letters.reduce((sum, letter) => sum + measure(letter), 0);
    if (line && occupied + size * 0.69 + wordWidth > width) {
      lines.push(line);
      line = '';
      occupied = 0;
    }
    if (line) {
      line += ' ';
      occupied += size * 0.69;
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

type Line = { value: string; size: number; color: string; weight: number; height: number };
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
  const heading = wrap(snapshot.heading, inner, 40);
  const headerEnd = 174 + heading.length * 48;
  const footerLines: Line[] = [];
  const addFooter = (value: string, color: string, weight = 400) => {
    for (const line of wrap(value, inner - 40, 22))
      footerLines.push({ value: line, size: 22, height: 30, color, weight });
  };
  addFooter(snapshot.promotionalCopy, colors.ink, 700);
  addFooter(snapshot.deliveryMessage, colors.ink);
  addFooter(snapshot.contactLabel, colors.green, 700);
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
    for (const [value, size, color, weight] of [
      [item.brand, 22, colors.green, 700],
      [item.name, 30, colors.ink, 700],
      [item.specification, 22, colors.ink, 400],
      [`PER ${item.unit}`, 22, colors.ink, 700],
    ] as const) {
      for (const line of wrap(value, inner - 48, size))
        lines.push({ value: line, size, color, weight, height: size + 9 });
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
    const pageColor = counter ? colors.concrete : colors.paper;
    const headingColor = counter ? colors.paper : colors.ink;
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">`,
      `<title id="title">${escape(`Shiv Cement Store — ${snapshot.heading} — ${pageIndex + 1}/${pages.length}`)}</title>`,
      `<desc id="description">${escape(`Approved rates published ${date} IST. Prices and units are printed for each material. Page ${pageIndex + 1} of ${pages.length}.`)}</desc>`,
      `<metadata>${escape(JSON.stringify({ format, template, page: pageIndex + 1, pages: pages.length, publishedAt: snapshot.publishedAt, phone: snapshot.phone, whatsapp: snapshot.whatsapp, items: segments.map(({ index }) => ({ ...snapshot.items[index], formattedPrice: money(snapshot.items[index]!.pricePaise) })) }))}</metadata>`,
      `<rect width="${width}" height="${height}" fill="${pageColor}"/>`,
      counter
        ? `<rect width="${width}" height="${headerEnd}" fill="${colors.ink}"/><rect y="${headerEnd - 8}" width="${width}" height="8" fill="${colors.amber}"/>`
        : `<rect x="0" width="16" height="${height}" fill="${colors.amber}"/><path d="M${margin} ${headerEnd - 8}H${width - margin}" stroke="${colors.ink}" stroke-width="3"/>`,
      text('SHIV', margin, 90, 62, headingColor, 900, sans),
      text('CEMENT STORE', margin + 200, 89, 29, headingColor, 700, sans),
      text('MATERIAL RATE BULLETIN', margin, 126, 18, counter ? colors.sand : colors.green, 700),
    ];
    heading.forEach((line, index) =>
      parts.push(text(line, margin, 176 + index * 48, 40, headingColor, 700)),
    );
    parts.push(text(`PUBLISHED / AS OF ${date} IST`, margin, headerEnd + 27, 18, colors.ink, 700));
    let y = tableTop;
    for (const segment of segments) {
      const item = snapshot.items[segment.index]!;
      parts.push(
        `<g data-item-index="${segment.index}" data-continued="${segment.continued}"><title>${escape(`${item.name}: ${money(item.pricePaise)} per ${item.unit}`)}</title>`,
      );
      parts.push(
        `<rect x="${margin}" y="${y}" width="${inner}" height="${segment.height}" fill="${colors.paper}" stroke="${counter ? colors.paper : colors.sand}" stroke-width="2"/>`,
      );
      parts.push(
        `<rect x="${margin}" y="${y}" width="6" height="${segment.height}" fill="${counter ? colors.amber : colors.green}"/>`,
      );
      parts.push(
        text(
          `${String(segment.index + 1).padStart(2, '0')} / ${segment.continued ? 'CONTINUED' : 'APPROVED RATE'}`,
          margin + 24,
          y + 37,
          18,
          colors.green,
          700,
        ),
      );
      const amount = money(item.pricePaise);
      parts.push(
        `<text x="${width - margin - 24}" y="${y + 43}" text-anchor="end" font-family="${mono}" font-size="34" font-weight="700" fill="${colors.ink}" data-price-paise="${item.pricePaise}">${escape(amount)}</text>`,
      );
      let lineY = y + 64;
      for (const line of segment.lines) {
        lineY += line.height;
        parts.push(text(line.value, margin + 24, lineY, line.size, line.color, line.weight));
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
    parts.push(text('SHIV / RATE STUDIO', margin, height - margin, 17, colors.green, 700));
    parts.push(
      `<text x="${width - margin}" y="${height - margin}" text-anchor="end" font-family="${mono}" font-size="17" fill="${colors.ink}">PAGE ${pageIndex + 1} / ${pages.length}</text></svg>`,
    );
    return parts.join('');
  });
}

export async function rateCardPng(svg: string): Promise<Buffer> {
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
