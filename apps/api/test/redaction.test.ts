import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryMovement, Prisma } from '@prisma/client';
import { OperationsController, redactAuditDetails, redactQuoteSnapshot } from '../src/operations';
import { Events } from '../src/catalog';
import type { Db } from '../src/db';
import type { AuthRequest } from '../src/http';

describe('Personal-data redaction preserves business evidence', () => {
  it('retains immutable quote prices, freight and material lines while removing contact/free text', () => {
    const result = redactQuoteSnapshot({
      id: 'quote-1',
      number: 'QT-1',
      status: 'SENT',
      revision: 2,
      deliveryDate: '2026-10-08',
      deliveryFeePaise: 50000,
      totalPaise: 2000000,
      validUntil: '2026-10-10T00:00:00.000Z',
      decisionSource: 'STORE_RECORDED',
      decisionActorId: 'owner-1',
      decisionAt: '2026-10-07T12:00:00.000Z',
      address: { name: 'Private person', phone: '+919999999991', line1: 'Private address' },
      company: 'Private business',
      gstin: 'Private tax identifier',
      notes: 'Call Private person',
      adminNote: 'Private note',
      decisionNote: 'Private WhatsApp conversation',
      unknown: { contact: 'Private person' },
      items: [
        {
          id: 'line-1',
          quoteId: 'quote-1',
          productId: 'cement',
          name: 'Cement',
          unit: '50 kg bag',
          quantity: 50,
          unitPricePaise: 39000,
          unexpectedContact: 'Private person',
        },
      ],
    });
    expect(result).toMatchObject({
      personalDataRemoved: true,
      id: 'quote-1',
      revision: 2,
      totalPaise: 2000000,
      deliveryFeePaise: 50000,
      decisionSource: 'STORE_RECORDED',
      decisionActorId: 'owner-1',
      items: [{ name: 'Cement', quantity: 50, unitPricePaise: 39000 }],
    });
    expect(JSON.stringify(result)).not.toContain('Private');
    expect(JSON.stringify(result)).not.toContain('+919999999991');
    expect(result.items).toEqual([
      {
        id: 'line-1',
        quoteId: 'quote-1',
        productId: 'cement',
        name: 'Cement',
        unit: '50 kg bag',
        quantity: 50,
        unitPricePaise: 39000,
      },
    ]);
    expect(redactQuoteSnapshot(result as Prisma.JsonValue)).toEqual(result);
  });

  it('retains financial audit amounts and provenance but excludes unknown and mistyped fields', () => {
    expect(
      redactAuditDetails({
        amountPaise: 2000000,
        paymentId: 'pay_test',
        refundId: 'rfnd_test',
        revision: 2,
        byStore: true,
        from: 'OUT_FOR_DELIVERY',
        to: 'DELIVERED',
        totalPaise: { phone: '+919999999991' },
        status: 'Private person',
        providerId: 'private@example.com',
        note: '+919999999991',
        contact: { name: 'Private person' },
      }),
    ).toEqual({
      personalDataRemoved: true,
      amountPaise: 2000000,
      paymentId: 'pay_test',
      refundId: 'rfnd_test',
      revision: 2,
      byStore: true,
      from: 'OUT_FOR_DELIVERY',
      to: 'DELIVERED',
    });
    expect(redactAuditDetails(null)).toEqual({ personalDataRemoved: true });
    expect(redactQuoteSnapshot(['private'])).toEqual({ personalDataRemoved: true });
  });

  it('records counter-sale money once at the original server price and stock-event time', async () => {
    const stockRows = new Map<string, InventoryMovement>();
    const moneyRows = new Map<string, Prisma.FinancialMovementCreateInput>();
    const product = { stock: 100, pricePaise: 39000 };
    const occurredAt = new Date('2026-10-07T12:00:00.000Z');
    const db = {
      inventoryMovement: {
        findUnique: async ({ where }: Prisma.InventoryMovementFindUniqueArgs) =>
          stockRows.get(where.idempotencyKey!),
        create: async ({ data }: { data: Omit<InventoryMovement, 'id' | 'createdAt'> }) => {
          const movement = { ...data, id: 'movement-1', createdAt: occurredAt };
          stockRows.set(data.idempotencyKey, movement);
          return movement;
        },
      },
      product: {
        updateMany: async ({ data }: { data: { stock: { increment: number } } }) => {
          product.stock += data.stock.increment;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => product,
      },
      financialMovement: {
        upsert: vi.fn(async ({ where, create, update }: Prisma.FinancialMovementUpsertArgs) => {
          expect(update).toEqual({});
          if (!moneyRows.has(where.inventoryMovementId!))
            moneyRows.set(where.inventoryMovementId!, create);
          return moneyRows.get(where.inventoryMovementId!);
        }),
      },
      atomic: async (run: (tx: unknown) => Promise<unknown>) => run(db),
    };
    const controller = new OperationsController(db as unknown as Db, new Events());
    const input = {
      kind: 'WALK_IN_SALE' as const,
      quantity: 50,
      reference: 'Counter',
      note: '',
      idempotencyKey: 'counter-sale-test-key',
    };
    const req = { user: { id: 'owner-1' } } as AuthRequest;
    await controller.movement('cement', input, req);
    product.pricePaise = 2_000_000_000;
    await controller.movement('cement', input, req);
    expect(product.stock).toBe(50);
    expect(stockRows.size).toBe(1);
    expect([...moneyRows.values()]).toEqual([
      {
        inventoryMovementId: 'movement-1',
        kind: 'COUNTER_SALE',
        amountPaise: 1950000,
        actorId: 'owner-1',
        occurredAt,
      },
    ]);
    await expect(
      controller.movement('cement', { ...input, quantity: 51 }, req),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(moneyRows.size).toBe(1);
  });
});
