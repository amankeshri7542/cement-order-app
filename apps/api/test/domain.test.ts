import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { cartItemSchema, checkoutSchema, productSchema, totals, transitions } from '@shiv/shared';
import { verifySignature } from '../src/payments';
describe('Financial and state invariants', () => {
  it('calculates exact integer paise and threshold boundaries', () => {
    expect(totals([{ pricePaise: 42550, quantity: 10 }], 50000, 5000000)).toEqual({
      subtotalPaise: 425500,
      deliveryFeePaise: 50000,
      totalPaise: 475500,
    });
    expect(totals([{ pricePaise: 10001, quantity: 3 }], 500, 30003).totalPaise).toBe(30003);
    expect(totals([{ pricePaise: 10001, quantity: 3 }], 500, 30004).totalPaise).toBe(30503);
  });
  it('rejects fractional, negative and overflowing money', () => {
    for (const pricePaise of [1.25, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      expect(() => totals([{ pricePaise, quantity: 2 }], 0, null)).toThrow();
    expect(() => totals([{ pricePaise: 2_000_000_000, quantity: 1 }], 1, null)).toThrow();
    expect(() => totals([{ pricePaise: 100, quantity: 0 }], 0, null)).toThrow();
  });
  it('rejects price injection and quantity manipulation at the input boundary', () => {
    expect(cartItemSchema.safeParse({ productId: 'p', quantity: 1, pricePaise: 1 }).success).toBe(
      false,
    );
    expect(cartItemSchema.safeParse({ productId: 'p', quantity: 0.1 }).success).toBe(false);
    expect(
      checkoutSchema.safeParse({
        addressId: 'a',
        deliveryDate: '2026-11-01',
        paymentMethod: 'COD',
        totalPaise: 1,
      }).success,
    ).toBe(false);
    expect(productSchema.safeParse({}).success).toBe(false);
  });
  it('prevents backwards and skipped fulfilment transitions', () => {
    expect(transitions.CONFIRMED).not.toContain('DELIVERED');
    expect(transitions.OUT_FOR_DELIVERY).toEqual(['DELIVERED']);
    expect(transitions.DELIVERED).toEqual([]);
  });
  it('verifies exact raw webhook bytes, rejects mutation and malformed signatures', () => {
    const body = '{ "event": "payment.captured" }';
    const secret = 'test-secret';
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    expect(verifySignature(body, signature, secret)).toBe(true);
    expect(verifySignature(body.replace(' ', ''), signature, secret)).toBe(false);
    expect(verifySignature(body, 'bad', secret)).toBe(false);
    expect(verifySignature(body, signature, 'wrong-secret')).toBe(false);
  });
});
