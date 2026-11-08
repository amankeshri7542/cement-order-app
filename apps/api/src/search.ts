import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import {
  canDo,
  indexProducts,
  rankProducts,
  searchQuerySchema,
  searchResponseSchema,
  type Permission,
  type SearchIndex,
  type SearchResponse,
  worksAt,
} from '@shiv/shared';
import { Db } from './db';
import { firmsOf, requireFirm } from './firms';
import { AuthRequest, Can, fail, Firm, forbid, Returns, scoped } from './http';
import { shownPhone } from './crm/common';

/*
 * The desk's search (plan v4, 02 section 3 and 09 section 5): customers, orders and goods in one
 * answer, grouped, a few of each. Each group is checked on its own permission, so a stock keeper
 * finds goods and never a customer, and a group this person may not read is left out entirely.
 * Bills and suppliers join when their tables exist (D4a, D1).
 */

/** A piece of text for LIKE, with its wildcards taken literally. */
const likeText = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);
const fullNumber = (text: string) => {
  const digits = text.replace(/[\s-]/g, '');
  const match = /^(?:\+?91)?([6-9]\d{9})$/.exec(digits);
  return match ? `+91${match[1]}` : null;
};

type ProductRow = {
  id: string;
  name: string;
  nameHi: string | null;
  brand: string;
  grade: string;
  type: string;
  unit: string;
  stockMode: 'COUNTED' | 'AVAILABILITY';
  category: string;
  words: string[];
};
// Goods are few (hundreds, a few thousand at most), so they are ranked in memory with the same
// code the phone uses. The index is rebuilt when a product or alias changes.
let productIndex: { key: string; index: SearchIndex<ProductRow> } | null = null;

@ApiTags('Desk search')
@Controller('admin')
export class SearchController {
  constructor(@Inject(Db) private db: Db) {}

  @Firm('own')
  @Can('desk.use', scoped)
  @Returns(searchResponseSchema)
  @Get('search')
  async search(@Query() query: Record<string, unknown>, @Req() req: AuthRequest) {
    const parsed = searchQuerySchema.safeParse(query);
    if (!parsed.success) fail('INVALID_FILTER', 'Type something to search for.');
    const { q, only, limit, locationId, firmId } = parsed.data;
    // The shop or firm chosen in the top bar. Either must be this person's; a tampered one is
    // refused, not quietly widened.
    if (locationId && !worksAt(req.access, locationId)) forbid(req, 'desk.use');
    if (firmId) requireFirm(req, firmId);
    const wants = (group: 'customers' | 'orders' | 'products', permission: Permission) =>
      (!only || only === group) && canDo(req.access, permission, locationId);
    const [customers, orders, products] = await Promise.all([
      wants('customers', 'customers.read') ? this.customers(req, q, limit, firmId) : undefined,
      wants('orders', 'orders.read') ? this.orders(req, q, limit, locationId, firmId) : undefined,
      wants('products', 'stock.read') || wants('products', 'rates.read')
        ? this.products(req, q, limit, locationId)
        : undefined,
    ]);
    const answer: SearchResponse = { query: q };
    if (customers) answer.customers = customers;
    if (orders) answer.orders = orders;
    if (products) answer.products = products;
    return answer;
  }

  /**
   * Customers by a piece of their name, or of their number for those who may hold numbers. Anyone
   * may find a customer by the whole number, as on the customer list. Someone limited to some
   * firms finds only the customers those firms have dealt with, and new ones.
   */
  private async customers(req: AuthRequest, q: string, limit: number, firmId?: string) {
    const text = q.toLowerCase().replace(/\s+/g, ' ');
    const seesPhones = canDo(req.access, 'customers.phone.read');
    const whole = fullNumber(q);
    const digits = q.replace(/\D/g, '');
    const byPhone =
      whole && !seesPhones
        ? Prisma.sql`OR u.phone = ${whole}`
        : seesPhones && digits.length >= 4 && digits.length === q.replace(/[\s+-]/g, '').length
          ? Prisma.sql`OR u.phone LIKE ${`%${likeText(digits)}%`}`
          : Prisma.empty;
    const firms = firmId ? [firmId] : firmsOf(req);
    // The same rule as customerFirmWhere (firms.ts), in SQL: dealt with one of these firms, or
    // with no firm at all yet.
    const list = firms !== 'ALL' && firms.length ? Prisma.join(firms) : null;
    const firmRule =
      firms === 'ALL'
        ? Prisma.sql`TRUE`
        : Prisma.sql`(${
            list
              ? Prisma.sql`EXISTS (SELECT 1 FROM "CustomerFirmBalance" b
                  WHERE b."customerId" = u.id AND b."firmId" IN (${list}))
                OR EXISTS (SELECT 1 FROM "Order" o WHERE o."userId" = u.id AND o."firmId" IN (${list}))
                OR `
              : Prisma.empty
          }(NOT EXISTS (SELECT 1 FROM "CustomerFirmBalance" b WHERE b."customerId" = u.id)
            AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."userId" = u.id)))`;
    const like = `%${likeText(text)}%`;
    const rows = await this.db.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM "User" u
      WHERE u."deletedAt" IS NULL AND u.role <> 'ADMIN' AND u.phone <> 'walk-in:store'
        AND (u.name ILIKE ${like} ${byPhone})
        AND ${firmRule}
      ORDER BY
        CASE
          WHEN lower(u.name) = ${text} THEN 0
          WHEN lower(u.name) LIKE ${`${likeText(text)}%`} THEN 1
          WHEN (' ' || lower(u.name)) LIKE ${`% ${likeText(text)}%`} THEN 2
          ELSE 3
        END,
        u."lastOrderAt" DESC NULLS LAST, u.id
      LIMIT ${limit}`;
    let ids = rows.map((row) => row.id);
    // A name typed a letter or two wrong ("Rmesh") still finds the person, after real matches.
    if (ids.length < limit && /\p{L}{4}/u.test(text)) {
      const near = await this.db.$queryRaw<{ id: string }[]>`
        SELECT u.id FROM "User" u
        WHERE u."deletedAt" IS NULL AND u.role <> 'ADMIN' AND u.phone <> 'walk-in:store'
          AND ${text} <% u.name AND ${firmRule}
        ORDER BY word_similarity(${text}, u.name) DESC, u.id
        LIMIT ${limit}`;
      ids = [...new Set([...ids, ...near.map((row) => row.id)])].slice(0, limit);
    }
    if (!ids.length) return [];
    const seesBalances = !!req.access['khata.read.list'];
    const found = await this.db.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        phone: true,
        area: true,
        khataBalancePaise: true,
        firmBalances: {
          where: firms === 'ALL' ? {} : { firmId: { in: firms } },
          select: { balancePaise: true },
        },
      },
    });
    const byId = new Map(found.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      if (!row) return [];
      const balance =
        firms === 'ALL'
          ? row.khataBalancePaise
          : row.firmBalances.reduce((total, entry) => total + entry.balancePaise, 0);
      return [
        {
          id: row.id,
          name: row.name,
          phone: shownPhone(req, row.phone),
          area: row.area,
          balancePaise: seesBalances ? balance : null,
        },
      ];
    });
  }

  /**
   * Orders by a piece of their number, at the shops this person reads orders at. By customer name
   * too for those who see order money, as on the order list.
   */
  private async orders(
    req: AuthRequest,
    q: string,
    limit: number,
    locationId?: string,
    firmId?: string,
  ) {
    const scope = req.access['orders.read'];
    const shops =
      locationId !== undefined
        ? { locationId }
        : scope && scope !== 'ALL'
          ? { locationId: { in: scope } }
          : {};
    const firms = firmId ? [firmId] : firmsOf(req);
    // By customer name only at the shops where this person sees order money: elsewhere a match
    // would tell them who ordered there, even with the name hidden on the row.
    const money = req.access['orders.read.money'];
    const rows = await this.db.order.findMany({
      where: {
        ...shops,
        ...(firms === 'ALL' ? {} : { firmId: { in: firms } }),
        OR: [
          // Prisma passes % and _ through to LIKE, so they are escaped here.
          { number: { contains: likeText(q), mode: 'insensitive' } },
          ...(money
            ? [
                {
                  user: { name: { contains: likeText(q), mode: 'insensitive' as const } },
                  ...(money === 'ALL' ? {} : { locationId: { in: money } }),
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        number: true,
        status: true,
        locationId: true,
        createdAt: true,
        totalPaise: true,
        user: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const upper = q.toUpperCase();
    // The order whose number was typed comes first, then numbers that end with what was typed
    // (people read out the last digits), then the newest.
    const rank = (number: string) =>
      number === upper ? 0 : number.endsWith(upper) ? 1 : number.includes(upper) ? 2 : 3;
    return rows
      .map((row, at) => ({ row, at }))
      .sort((a, b) => rank(a.row.number) - rank(b.row.number) || a.at - b.at)
      .slice(0, limit)
      .map(({ row }) => {
        const money = canDo(req.access, 'orders.read.money', row.locationId);
        return {
          id: row.id,
          number: row.number,
          status: row.status,
          locationId: row.locationId,
          createdAt: row.createdAt.toISOString(),
          customerName: money ? row.user.name : null,
          totalPaise: money ? row.totalPaise : null,
        };
      });
  }

  /** Goods, with stock at the shops this person may see stock at (or the one chosen). */
  private async products(req: AuthRequest, q: string, limit: number, locationId?: string) {
    const found = rankProducts(await this.productIndex(), q, limit);
    if (!found.length) return [];
    const stockScope = req.access['stock.read'];
    const shops = !stockScope
      ? null
      : locationId !== undefined
        ? canDo(req.access, 'stock.read', locationId)
          ? [locationId]
          : null
        : stockScope;
    const levels = shops
      ? await this.db.stockLevel.findMany({
          where: {
            productId: { in: found.map((product) => product.id) },
            ...(shops === 'ALL' ? {} : { locationId: { in: shops } }),
          },
          select: {
            productId: true,
            locationId: true,
            quantity: true,
            lowStockAt: true,
            isOn: true,
          },
          orderBy: { locationId: 'asc' },
        })
      : [];
    return found.map((product) => ({
      id: product.id,
      name: product.name,
      brand: product.brand,
      unit: product.unit,
      stockMode: product.stockMode,
      stock: levels
        .filter((level) => level.productId === product.id)
        .map((level) => ({
          locationId: level.locationId,
          quantity: product.stockMode === 'COUNTED' ? level.quantity : null,
          low: product.stockMode === 'COUNTED' ? level.quantity <= level.lowStockAt : !level.isOn,
        })),
    }));
  }

  private async productIndex() {
    const [stamp] = await this.db.$queryRaw<{ key: string }[]>`
      SELECT concat_ws(':',
        (SELECT count(*) FROM "Product" WHERE active),
        (SELECT max("updatedAt") FROM "Product"),
        (SELECT count(*) FROM "ProductAlias"),
        (SELECT max("createdAt") FROM "ProductAlias")) AS key`;
    const key = stamp?.key ?? '';
    if (productIndex?.key === key) return productIndex.index;
    const [products, aliases] = await Promise.all([
      this.db.product.findMany({
        where: { active: true },
        select: {
          id: true,
          name: true,
          nameHi: true,
          brand: true,
          grade: true,
          type: true,
          unit: true,
          stockMode: true,
          category: { select: { slug: true } },
        },
        orderBy: { id: 'asc' },
        take: 5000,
      }),
      this.db.productAlias.findMany({ select: { productId: true, alias: true }, take: 20000 }),
    ]);
    const words = new Map<string, string[]>();
    for (const alias of aliases) {
      const list = words.get(alias.productId) ?? [];
      list.push(alias.alias);
      words.set(alias.productId, list);
    }
    const index = indexProducts(
      products.map(({ category, ...product }) => ({
        ...product,
        category: category.slug,
        words: words.get(product.id) ?? [],
      })),
    );
    productIndex = { key, index };
    return index;
  }
}
