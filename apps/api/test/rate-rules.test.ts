import { describe, it, expect } from 'vitest';
import type { Product } from '@prisma/client';
import { rateExtractionSchema } from '@shiv/shared';
import { adjustedPrice, normalizeAlias, rowIssues, rupeesToPaise } from '../src/rate-studio/rules';
describe('Rate Studio deterministic rules', () => {
  it('parses only explicit INR decimal prices without guessing OCR characters or unit conversions', () => {
    for (const [text, paise] of [
      ['₹1,606', 160600],
      ['1,23,456.70', 12345670],
      ['Rs. 430/-', 43000],
      ['0.01', 1],
    ] as const)
      expect(rupeesToPaise(text)).toBe(paise);
    for (const text of [
      '1O60',
      '1.606.00',
      '1,6,06',
      '-430',
      '430 per kg',
      '0',
      '9999999999',
      '1.234',
    ])
      expect(rupeesToPaise(text)).toBeNull();
  });
  it('uses integer basis points and half-up paise rounding and rejects invalid results', () => {
    expect(adjustedPrice(42500, 'PERCENT', 'INCREASE', 250)).toBe(43563);
    expect(adjustedPrice(42500, 'FIXED', 'DECREASE', 500)).toBe(42000);
    expect(adjustedPrice(42500, 'PERCENT', 'DECREASE', 10000)).toBeNull();
    expect(adjustedPrice(100000000, 'FIXED', 'INCREASE', 1)).toBeNull();
  });
  it('normalizes spacing and known spelling while preserving material size', () => {
    expect(normalizeAlias('JSW Neo Steel 12 MM')).toBe(normalizeAlias('jsw neosteel 12mm'));
    expect(normalizeAlias('JSW 12mm')).not.toBe(normalizeAlias('JSW 16mm'));
  });
  it('flags deterministic financial anomalies, duplicate mappings and stale versions', () => {
    const product = {
      id: 'x',
      active: true,
      version: 3,
      pricePaise: 160600,
      unit: 'piece',
    } as Product;
    const row = {
      included: true,
      productId: 'x',
      product,
      proposedPricePaise: 1606000,
      oldPricePaise: 160600,
      expectedProductVersion: 2,
      reviewed: false,
      acknowledged: false,
      confidence: 0.4,
      unit: 'kg',
    };
    const issues = rowIssues(row, true);
    expect(issues.map((i) => i.code)).toEqual(
      expect.arrayContaining([
        'DUPLICATE',
        'PRODUCT_CHANGED',
        'NEEDS_REVIEW',
        'LOW_CONFIDENCE',
        'UNIT_MISMATCH',
        'LARGE_CHANGE',
      ]),
    );
    expect(issues.find((i) => i.code === 'LARGE_CHANGE')?.message).toContain('+900.0%');
    expect(rowIssues({ ...row, included: false }, true)).toEqual([]);
  });
  it('rejects unknown fields, fabricated confidence and oversized extraction rows', () => {
    expect(rateExtractionSchema.safeParse({ rows: [], publish: true }).success).toBe(false);
    expect(
      rateExtractionSchema.safeParse({ rows: Array.from({ length: 101 }, () => ({})) }).success,
    ).toBe(false);
  });
});
