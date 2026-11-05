import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/db';
import * as config from '../src/config';
import {
  AdvisorTools,
  projectProduct,
  publicToolSchemas,
  shopWhatsappUrl,
} from '../src/advisor/tools';
import { costOf, worstCaseCost } from '../src/advisor/budgets';
import { shopContent } from '../src/public-content';

// The tool boundary, moved from the old assistant tests: only public reads, by strict schemas.
const record: Record<string, unknown> = {
  id: 'cement',
  name: 'Test cement',
  brand: 'Test',
  grade: 'PPC',
  unit: 'bag',
  packSize: '50 kg',
  minQuantity: 5,
  quantityStep: 5,
  pricePaise: 41000,
  priceVersion: 1,
  priceUpdatedAt: new Date('2026-11-01T00:00:00Z'),
  stock: 100,
  sourcing: 'STOCKED',
  stockMode: 'COUNTED',
  stockLevels: [],
  internalMarginPaise: 7000,
  supplierPrivateNote: 'PRIVATE_SUPPLIER',
  active: true,
};
function fixture() {
  const db = {
    product: {
      findMany: vi.fn(async ({ select }: { select: Record<string, unknown> }) => [
        Object.fromEntries(
          Object.keys(select)
            .filter((key) => select[key])
            .map((key) => [key, record[key]]),
        ),
      ]),
    },
    deliveryZone: {
      findFirst: vi.fn(async () => ({
        name: 'Test zone',
        deliveryFeePaise: 50000,
        minimumOrderPaise: 0,
        freeDeliveryAbovePaise: null,
      })),
    },
  };
  return { service: new AdvisorTools(db as unknown as Db), db };
}

let settings: config.Config;
beforeEach(() => {
  settings = config.configSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused/unused_test',
    OTP_HASH_SECRET: 'advisor-unit-test-secret-not-for-production',
  });
  vi.spyOn(config, 'getConfig').mockImplementation(() => settings);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the public tool boundary', () => {
  it('allows only public tools, and refuses private or prototype names without touching the database', async () => {
    const { service, db } = fixture();
    expect(Object.keys(publicToolSchemas).sort()).toEqual([
      'delivery',
      'estimate',
      'products',
      'rates',
      'shop',
    ]);
    for (const name of [
      'staff',
      'orders',
      'quotes',
      'attendance',
      'salary',
      'constructor',
      '__proto__',
    ])
      await expect(service.tool(name, {})).rejects.toMatchObject({
        response: { code: 'ADVISOR_TOOL_DENIED' },
      });
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
  it('refuses bad or extra arguments the same way', async () => {
    const { service, db } = fixture();
    for (const [name, args] of [
      ['products', { query: '', id: '', include: 'staff' }],
      ['products', { query: 'x'.repeat(81), id: '' }],
      ['delivery', { pincode: '080020' }],
      ['delivery', { pincode: '800020', customerId: 'someone' }],
      ['shop', { password: 'please' }],
      ['estimate', { kind: 'SLAB', areaSqFt: 1000 }],
      ['estimate', { kind: 'BRICKS', lengthFt: 10, heightFt: 10, thicknessInch: 12 }],
      ['estimate', { kind: 'SARIYA_WEIGHT', diameterMm: -1, lengthM: 10 }],
    ] as const)
      await expect(service.tool(name, args)).rejects.toMatchObject({
        response: { code: 'ADVISOR_TOOL_INVALID' },
      });
    expect(db.product.findMany).not.toHaveBeenCalled();
    expect(db.deliveryZone.findFirst).not.toHaveBeenCalled();
  });
  it('has no estimator for a slab, a column or anything structural', () => {
    expect(publicToolSchemas.estimate.safeParse({ kind: 'SLAB' }).success).toBe(false);
    expect(publicToolSchemas.estimate.safeParse({ kind: 'CONCRETE' }).success).toBe(false);
    expect(publicToolSchemas.estimate.safeParse({ kind: 'STEEL_FOR_SLAB' }).success).toBe(false);
  });
  it('projects only approved fields from active records', async () => {
    const { service, db } = fixture();
    const result = await service.tool('products', { query: '', id: 'cement' });
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true, id: 'cement' },
        orderBy: { name: 'asc' },
        take: 6,
      }),
    );
    const text = JSON.stringify(result);
    expect(text).not.toContain('"stock"');
    expect(text).toContain('"availability":"IN_STOCK"');
    expect(text).not.toMatch(/internalMargin|supplierPrivate|PRIVATE_SUPPLIER|sourcing|stockMode/);
  });
  it('searches by glossary words, so sariya finds steel', async () => {
    const { service, db } = fixture();
    await service.tool('products', { query: 'sarya', id: '' });
    const where = JSON.stringify(db.product.findMany.mock.calls[0]![0]);
    expect(where).toContain('steel');
    expect(where).toContain('tmt');
    expect(where).toContain('normalizedAlias');
  });
  it('reads shop facts only from approved content', async () => {
    const { service } = fixture();
    expect(await service.tool('shop', {})).toBe(shopContent);
    expect(shopWhatsappUrl()).toBeNull();
  });
  it('leaves the free-text delivery estimate out', async () => {
    const { service, db } = fixture();
    const result = await service.tool('delivery', { pincode: '800020' });
    expect(db.deliveryZone.findFirst).toHaveBeenCalledWith({
      where: { active: true, pincodes: { some: { pincode: '800020' } } },
      select: {
        name: true,
        deliveryFeePaise: true,
        minimumOrderPaise: true,
        freeDeliveryAbovePaise: true,
      },
    });
    expect(result).toEqual({
      pincode: '800020',
      serviceable: true,
      zone: 'Test zone',
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      freeDeliveryAbovePaise: null,
    });
  });
  it('an estimate with no signed coefficients says so', async () => {
    const { service } = fixture();
    expect(
      await service.tool('estimate', {
        kind: 'BRICKS',
        lengthFt: 30,
        heightFt: 10,
        thicknessInch: 9,
      }),
    ).toMatchObject({ status: 'NOT_AVAILABLE' });
    expect(
      await service.tool('estimate', { kind: 'SARIYA_WEIGHT', diameterMm: 12, lengthM: 12 }),
    ).toMatchObject({
      status: 'NOT_AVAILABLE',
    });
  });
});

describe('how a product reads', () => {
  const row = {
    id: 'p',
    name: 'P',
    brand: 'B',
    grade: 'G',
    unit: 'bag',
    packSize: '50 kg',
    minQuantity: 1,
    quantityStep: 1,
    pricePaise: 100,
    priceVersion: 1,
    priceUpdatedAt: new Date(),
    stock: 5,
    sourcing: 'STOCKED',
    stockMode: 'COUNTED',
    stockLevels: [],
  };
  it('has a sample tag until the family says rates are real', () => {
    const before = process.env.PUBLIC_RATES_REAL;
    delete process.env.PUBLIC_RATES_REAL;
    expect(projectProduct(row).isSample).toBe(true);
    process.env.PUBLIC_RATES_REAL = 'on';
    expect(projectProduct(row).isSample).toBe(false);
    if (before === undefined) delete process.env.PUBLIC_RATES_REAL;
    else process.env.PUBLIC_RATES_REAL = before;
  });
  it('has no list rate when the shop only gets it to order', () => {
    expect(projectProduct({ ...row, sourcing: 'ON_REQUEST' })).toMatchObject({
      pricePaise: null,
      availability: 'ON_REQUEST',
    });
  });
  it('says nothing about how many, in any stock mode', () => {
    expect(projectProduct({ ...row, stock: 0 }).availability).toBe('ASK_SHOP');
    expect(
      projectProduct({ ...row, stockMode: 'AVAILABILITY', stock: 0, stockLevels: [{ isOn: true }] })
        .availability,
    ).toBe('IN_STOCK');
  });
});

describe('what a call costs', () => {
  it('prices each kind of token at its own rate, rounding up', () => {
    // 1,000 in at $0.10, 2,000 cache write at $0.125, 10,000 cache read at $0.01, 100 out at $0.50.
    expect(
      costOf({
        inputTokens: 1000,
        cacheWriteTokens: 2000,
        cacheReadTokens: 10000,
        outputTokens: 100,
      }),
    ).toBe(100 + 250 + 100 + 50);
    expect(
      costOf({ inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 }),
    ).toBe(1);
  });
  it('the worst case holds more than any reply could use', () => {
    const worst = worstCaseCost(4000, 1024);
    expect(worst).toBe(Math.ceil((4000 * 100_000 + 1024 * 500_000) / 1_000_000));
    expect(worst).toBeGreaterThan(
      costOf({ inputTokens: 3000, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1024 }),
    );
  });
  it('the default caps are ₹10 a day and ₹300 a month at ₹95', () => {
    expect(settings.ADVISOR_DAILY_BUDGET_MICRO_USD).toBe(Math.floor((10 * 1_000_000) / 95));
    expect(settings.ADVISOR_MONTHLY_BUDGET_MICRO_USD).toBe(Math.floor((300 * 1_000_000) / 95));
  });
  it('the default model is Haiku 5.5, and the limits are decision 54', () => {
    expect(settings.ADVISOR_MODEL_TRIAGE).toBe('claude-haiku-5-5');
    expect(settings.ADVISOR_MODEL_ANSWER).toBe('claude-haiku-5-5');
    expect(settings.ADVISOR_QUESTIONS_PER_DEVICE_DAY).toBe(5);
    expect(settings.ADVISOR_QUESTIONS_PER_ACCOUNT_DAY).toBe(10);
    expect(settings.ADVISOR_QUESTIONS_PER_IP_DAY).toBe(20);
    expect(settings.ASK_ENABLED).toBe(false);
    expect(settings.ADVISOR_PROVIDER).toBe('fallback');
  });
});
