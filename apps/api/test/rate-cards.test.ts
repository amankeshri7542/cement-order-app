import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { renderRateCardPages, rateCardPng, type CardSnapshot } from '../src/rate-studio/cards';

const snapshot: CardSnapshot = {
  heading: 'Today’s material rates',
  deliveryMessage: 'Delivery charges confirmed for your site.',
  promotionalCopy: 'Speak with our store team.',
  contactLabel: 'SHIV STORE DESK',
  phone: '+919297513707',
  whatsapp: '+919297513708',
  publishedAt: '2026-10-02T20:00:00.000Z',
  items: [
    {
      name: 'NeoSteel TMT',
      brand: 'JSW',
      specification: 'Fe 550D · 12 mm',
      unit: '12 m piece',
      pricePaise: 42550,
    },
  ],
};
const decode = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
const metadata = (svg: string) => JSON.parse(decode(/<metadata>(.*?)<\/metadata>/s.exec(svg)![1]!));

describe('Approved rate-card rendering', () => {
  it('renders both templates at every exact output size with authoritative prices and IST date', async () => {
    for (const [format, width, height] of [
      ['STATUS', 1080, 1920],
      ['SQUARE', 1080, 1080],
      ['SHEET', 1240, 1754],
    ] as const) {
      for (const template of ['COUNTER', 'BULLETIN'] as const) {
        const [svg] = renderRateCardPages(snapshot, format, template);
        expect(svg).toContain(`width="${width}" height="${height}"`);
        expect(svg).toContain('₹425.50');
        expect(svg).toContain('03 Oct 2026, 01:30 IST');
        expect(svg).toContain('CALL +919297513707');
        expect(svg).toContain('WHATSAPP +919297513708');
        expect(metadata(svg!).items[0]).toEqual({
          ...snapshot.items[0],
          formattedPrice: '₹425.50',
        });
        const png = await rateCardPng(svg!);
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width, height });
      }
    }
  });

  it('paginates maximum-length fields without truncating, losing rows, or mutating the snapshot', () => {
    const long: CardSnapshot = {
      ...snapshot,
      heading: 'H'.repeat(80),
      deliveryMessage: 'D'.repeat(160),
      promotionalCopy: 'P'.repeat(160),
      contactLabel: 'C'.repeat(40),
      items: Array.from({ length: 23 }, (_, index) => ({
        name: `${index}:` + 'N'.repeat(117),
        brand: 'B'.repeat(80),
        specification: 'S'.repeat(160),
        unit: 'U'.repeat(50),
        pricePaise: index * 100 + 1,
      })),
    };
    const original = JSON.stringify(long);
    for (const format of ['SQUARE', 'STATUS', 'SHEET'] as const) {
      const pages = renderRateCardPages(long, format, 'COUNTER');
      expect(pages.length).toBeGreaterThan(1);
      const saved = pages.flatMap((page) => metadata(page).items);
      for (const row of long.items)
        expect(saved).toContainEqual({
          ...row,
          formattedPrice: `₹${Math.floor(row.pricePaise / 100)}.01`,
        });
      for (const [index, page] of pages.entries()) {
        expect(page).toContain(`PAGE ${index + 1} / ${pages.length}`);
        expect(page).not.toContain('…');
        expect(
          [...page.matchAll(/font-size="(\d+)"/g)].every((match) => Number(match[1]) >= 17),
        ).toBe(true);
      }
    }
    expect(JSON.stringify(long)).toBe(original);
  });

  it('continues oversized Unicode rows with readable text instead of hiding product details', () => {
    const long = {
      ...snapshot,
      items: [
        {
          name: '建'.repeat(120),
          brand: '材'.repeat(80),
          specification: '規'.repeat(160),
          unit: '量'.repeat(50),
          pricePaise: 1606000,
        },
      ],
    };
    const pages = renderRateCardPages(long, 'SQUARE', 'BULLETIN');
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[1]).toContain('CONTINUED');
    const visibleText = pages
      .join('')
      .replace(/<metadata>.*?<\/metadata>|<title[^>]*>.*?<\/title>|<desc[^>]*>.*?<\/desc>/gs, '');
    expect((visibleText.match(/建/g) || []).length).toBe(120);
    expect((visibleText.match(/材/g) || []).length).toBe(80);
    expect((visibleText.match(/規/g) || []).length).toBe(160);
    expect((visibleText.match(/量/g) || []).length).toBe(50);
    expect(pages.every((page) => page.includes('₹16,060.00'))).toBe(true);
  });

  it('escapes all source fields so markup and URLs remain inert text', async () => {
    const hostile = '<script>alert("&")</script><image href="https://evil.test/x"/>';
    const data = {
      ...snapshot,
      heading: hostile,
      contactLabel: hostile,
      promotionalCopy: hostile,
      deliveryMessage: hostile,
      items: [
        {
          ...snapshot.items[0]!,
          name: hostile,
          brand: hostile,
          specification: hostile,
          unit: hostile,
        },
      ],
    };
    const pages = renderRateCardPages(data, 'STATUS', 'COUNTER');
    for (const page of pages) {
      expect(page).not.toMatch(/<script|<image|<foreignObject|<[^>]+\shref=/i);
      expect(page).toContain('&lt;script&gt;');
      expect(metadata(page).phone).toBe(snapshot.phone);
      await expect(rateCardPng(page)).resolves.toBeInstanceOf(Buffer);
    }
  });

  it('rejects non-integer financial values and invalid dates instead of publishing misleading cards', async () => {
    for (const pricePaise of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(() =>
        renderRateCardPages(
          { ...snapshot, items: [{ ...snapshot.items[0]!, pricePaise }] },
          'SQUARE',
          'COUNTER',
        ),
      ).toThrow();
    }
    expect(() =>
      renderRateCardPages({ ...snapshot, publishedAt: 'not-a-date' }, 'STATUS', 'COUNTER'),
    ).toThrow();
    expect(() =>
      renderRateCardPages({ ...snapshot, heading: '\u0000' }, 'STATUS', 'COUNTER'),
    ).toThrow();
    await expect(rateCardPng('not an SVG')).rejects.toThrow(
      'Rate card image could not be generated',
    );
  });
});
