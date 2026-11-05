import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  availabilityOf,
  bricksForWall,
  ratesFrom,
  sariyaWeight,
  termsIn,
  type AdvisorDelivery,
  type AdvisorProduct,
  type Product,
} from '@shiv/shared';
import { Db } from '../db';
import { fail } from '../http';
import { shopContent } from '../public-content';

/**
 * Everything Ask can read, and all it can ever read: public rates, delivery terms and approved shop
 * facts, each through a strict schema. The server runs these itself. The model has no tools, so text
 * typed by a customer or hidden in an article has nothing to drive. This dispatcher has no access
 * path to staff, quotations, customers or private documents.
 */
export const publicToolSchemas = {
  products: z.strictObject({ query: z.string().max(80), id: z.string().max(100) }),
  rates: z.strictObject({}),
  delivery: z.strictObject({ pincode: z.string().regex(/^[1-9]\d{5}$/) }),
  shop: z.strictObject({}),
  estimate: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('BRICKS'),
      lengthFt: z.number().positive().max(1000),
      heightFt: z.number().positive().max(100),
      thicknessInch: z.union([z.literal(4.5), z.literal(9)]),
      openingsSqFt: z.number().min(0).max(100000).optional(),
    }),
    z.strictObject({
      kind: z.literal('SARIYA_WEIGHT'),
      diameterMm: z.number().positive().max(60),
      lengthM: z.number().positive().max(100000),
      rods: z.number().int().min(1).max(100000).optional(),
    }),
  ]),
};
type ToolName = keyof typeof publicToolSchemas;

const productSelect = {
  id: true,
  name: true,
  brand: true,
  grade: true,
  unit: true,
  packSize: true,
  minQuantity: true,
  quantityStep: true,
  pricePaise: true,
  priceVersion: true,
  priceUpdatedAt: true,
  stock: true,
  sourcing: true,
  stockMode: true,
  active: true,
  category: { select: { name: true, slug: true } },
  stockLevels: { where: { location: { active: true } }, select: { isOn: true } },
} as const;

type ProductRow = {
  id: string;
  name: string;
  brand: string;
  grade: string;
  unit: string;
  packSize: string;
  minQuantity: number;
  quantityStep: number;
  pricePaise: number;
  priceVersion: number;
  priceUpdatedAt: Date;
  stock: number;
  sourcing: string;
  stockMode: string;
  stockLevels: { isOn: boolean }[];
};

/** Counts and shops stay out of anything a client or a model reads, and on-request items show no rate. */
export function projectProduct({
  stock,
  sourcing,
  stockMode,
  stockLevels,
  ...row
}: ProductRow): AdvisorProduct {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    grade: row.grade,
    unit: row.unit,
    packSize: row.packSize,
    minQuantity: row.minQuantity,
    quantityStep: row.quantityStep,
    pricePaise: sourcing === 'ON_REQUEST' ? null : row.pricePaise,
    priceVersion: row.priceVersion,
    priceUpdatedAt: row.priceUpdatedAt.toISOString(),
    // True until the family says these are the shop's real rates, as on the website's board.
    isSample: process.env.PUBLIC_RATES_REAL !== 'on',
    availability: availabilityOf({ stock, sourcing, stockMode, stockLevels }),
  };
}

@Injectable()
export class AdvisorTools {
  constructor(@Inject(Db) private db: Db) {}

  async tool(name: string, args: unknown) {
    if (!Object.hasOwn(publicToolSchemas, name))
      fail('ADVISOR_TOOL_DENIED', 'This tool is not public.', 400);
    const parsed = publicToolSchemas[name as ToolName].safeParse(args);
    if (!parsed.success) fail('ADVISOR_TOOL_INVALID', 'Invalid public tool arguments.', 400);
    if (name === 'products') {
      const { query, id } = parsed.data as z.infer<typeof publicToolSchemas.products>;
      return this.products(query, id);
    }
    if (name === 'rates') return this.rates();
    if (name === 'delivery') {
      const { pincode } = parsed.data as z.infer<typeof publicToolSchemas.delivery>;
      return this.delivery(pincode);
    }
    if (name === 'shop') return shopContent;
    const input = parsed.data as z.infer<typeof publicToolSchemas.estimate>;
    return input.kind === 'BRICKS'
      ? bricksForWall(input)
      : sariyaWeight({
          diameterMm: input.diameterMm,
          lengthM: input.lengthM,
          ...(input.rods ? { rods: input.rods } : {}),
        });
  }

  /** Reads live rates each time, so a card never shows yesterday's price. */
  private async products(query: string, id: string): Promise<AdvisorProduct[]> {
    // Glossary words first: "sarya" and "balu" find what the catalogue calls them.
    const search = [...new Set([query, ...termsIn(query).flatMap((term) => term.search)])]
      .map((word) => word.trim())
      .filter((word) => word.length >= 2)
      .slice(0, 6);
    const rows = await this.db.product.findMany({
      where: {
        active: true,
        ...(id
          ? { id }
          : search.length
            ? {
                OR: search.flatMap((word) => [
                  { name: { contains: word, mode: 'insensitive' as const } },
                  { nameHi: { contains: word, mode: 'insensitive' as const } },
                  { brand: { contains: word, mode: 'insensitive' as const } },
                  { grade: { contains: word, mode: 'insensitive' as const } },
                  { category: { name: { contains: word, mode: 'insensitive' as const } } },
                  { category: { slug: { contains: word, mode: 'insensitive' as const } } },
                  { aliases: { some: { normalizedAlias: { contains: word.toLowerCase() } } } },
                ]),
              }
            : {}),
      },
      select: productSelect,
      orderBy: { name: 'asc' },
      take: 6,
    });
    return rows.map((row) => projectProduct(row));
  }

  /** "Aaj ka rate": the same board the website shows, cheapest in-stock item per material. */
  private async rates(): Promise<AdvisorProduct[]> {
    const rows = await this.db.product.findMany({
      where: { active: true },
      select: productSelect,
      orderBy: { name: 'asc' },
      take: 200,
    });
    const board = ratesFrom(rows as unknown as Product[]);
    return board.map(({ product }) => projectProduct(product as unknown as ProductRow));
  }

  /** Fee and minimum only. The free-text estimate stays out, as it could read as a promise of time. */
  private async delivery(pincode: string): Promise<AdvisorDelivery> {
    const zone = await this.db.deliveryZone.findFirst({
      where: { active: true, pincodes: { some: { pincode } } },
      select: {
        name: true,
        deliveryFeePaise: true,
        minimumOrderPaise: true,
        freeDeliveryAbovePaise: true,
      },
    });
    return {
      pincode,
      serviceable: !!zone,
      zone: zone?.name ?? null,
      deliveryFeePaise: zone?.deliveryFeePaise ?? null,
      minimumOrderPaise: zone?.minimumOrderPaise ?? null,
      freeDeliveryAbovePaise: zone?.freeDeliveryAbovePaise ?? null,
    };
  }

  /** Live cards for the products a stored turn showed, so a card read later is never stale. */
  async productsById(ids: readonly string[]): Promise<AdvisorProduct[]> {
    if (!ids.length) return [];
    const rows = await this.db.product.findMany({
      where: { id: { in: [...ids] }, active: true },
      select: productSelect,
      orderBy: { name: 'asc' },
      take: 12,
    });
    return rows.map((row) => projectProduct(row));
  }
}

/** A wa.me link only once the family has approved the number. Until then the client hides it. */
export function shopWhatsappUrl(): string | null {
  const content = shopContent as { contactApproved: boolean; whatsapp: string };
  if (!content.contactApproved || !content.whatsapp) return null;
  const digits = content.whatsapp.replace(/\D/g, '');
  return digits.length >= 10 ? `https://wa.me/${digits}` : null;
}
