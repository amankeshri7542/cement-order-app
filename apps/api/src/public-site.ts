import { Controller, Get, Header, Inject, Injectable, Post } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { availabilityOf, MAX_LINE_QUANTITY } from '@shiv/shared';
import { z } from 'zod';
import type { Subscription } from 'rxjs';
import { Events } from './catalog';
import { Db } from './db';
import { Contract, Input, Public } from './http';
import { shopContent } from './public-content';

/**
 * What the public website reads. One response feeds every page, so visitors never reach the API,
 * and it holds public facts only: never a stock count, a shop's level or anyone's own rate.
 */
// No database write per check: this is a read, and phones on one carrier address share the limit.
const PER_IP_MINUTE = () =>
  Number(process.env.LIST_CHECK_PER_IP_MINUTE) || (process.env.NODE_ENV === 'test' ? 10000 : 120);
/**
 * A line worth more than this goes to "Ask for a rate" instead of Place order. It is a fixed rupee
 * figure on purpose: comparing with live stock would let a stranger binary-search the exact count
 * (plan 12 m3, decision 35). The family can change it with ONLINE_LINE_LIMIT_PAISE.
 */
const ONLINE_LINE_LIMIT_PAISE = () => Number(process.env.ONLINE_LINE_LIMIT_PAISE) || 50_000_000;
/** True until the family says these are the shop's real rates. Shown on every rate, and noindex. */
export const sampleRates = () => process.env.PUBLIC_RATES_REAL !== 'on';

export const listCheckSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1)
    .max(50),
});
type ListCheck = z.infer<typeof listCheckSchema>;
export type ListLineStatus = 'ok' | 'over' | 'unavailable' | 'on_request' | 'invalid' | 'gone';

/** A rate is public unless the shop only gets the item to order. */
const publicRate = (product: { pricePaise: number; sourcing: string }) =>
  product.sourcing === 'ON_REQUEST' ? null : product.pricePaise;

@ApiTags('Public website')
@Controller('public')
export class PublicSiteController {
  constructor(@Inject(Db) private db: Db) {}

  @Public()
  @Get('catalog')
  // The blanket no-store is for private answers. This one is the same for everybody, and an
  // unchanged catalogue costs a client almost nothing through its ETag.
  @Header('Cache-Control', 'public, no-cache')
  async catalog() {
    const [rows, categories] = await Promise.all([
      this.db.product.findMany({
        where: { active: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 500,
        include: {
          category: { select: { id: true, name: true, slug: true } },
          aliases: { select: { alias: true } },
          stockLevels: { where: { location: { active: true } }, select: { isOn: true } },
        },
      }),
      this.db.category.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const products = rows.map((row) => {
      const checkedAt =
        row.priceCheckedAt && row.priceCheckedAt > row.priceUpdatedAt
          ? row.priceCheckedAt
          : row.priceUpdatedAt;
      return {
        id: row.id,
        name: row.name,
        brand: row.brand,
        type: row.type,
        grade: row.grade,
        unit: row.unit,
        packSize: row.packSize,
        minQuantity: row.minQuantity,
        quantityStep: row.quantityStep,
        pricePaise: publicRate(row),
        availability: availabilityOf(row),
        priceUpdatedAt: row.priceUpdatedAt,
        checkedAt,
        images: row.images,
        description: row.description,
        recommendedUse: row.recommendedUse,
        categorySlug: row.category.slug,
        // Words people search for. Never shown on a page; only matched against what they typed.
        searchTerms: [row.nameHi, ...row.aliases.map((item) => item.alias)].filter(Boolean),
      };
    });
    const dated = products.filter((product) => product.pricePaise !== null);
    return {
      products,
      categories: categories.map(({ id, name, slug }) => ({ id, name, slug })),
      // The oldest check, so "today" is true of every rate on the board, not just the newest one.
      ratesCheckedAt: dated.length
        ? new Date(Math.min(...dated.map((product) => product.checkedAt.getTime())))
        : null,
      sampleRates: sampleRates(),
      generatedAt: new Date(),
    };
  }

  /**
   * Yes or no per line, and the current rate. Compared with a fixed limit, so no answer here can
   * reveal how much the shop holds. Placing an order still checks everything on the server.
   */
  @Public()
  @Throttle({ default: { limit: PER_IP_MINUTE, ttl: 60000 } })
  @Post('list-check')
  @Contract(listCheckSchema)
  async listCheck(@Input(listCheckSchema) input: ListCheck) {
    const ids = [...new Set(input.lines.map((line) => line.productId))];
    const rows = await this.db.product.findMany({
      where: { id: { in: ids }, active: true },
      include: {
        stockLevels: { where: { location: { active: true } }, select: { isOn: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      lines: input.lines.map((line) => {
        const product = byId.get(line.productId);
        if (!product)
          return {
            productId: line.productId,
            status: 'gone' as ListLineStatus,
            pricePaise: null,
          };
        const shared = {
          productId: product.id,
          pricePaise: publicRate(product),
          minQuantity: product.minQuantity,
          quantityStep: product.quantityStep,
        };
        const availability = availabilityOf(product);
        if (availability === 'ON_REQUEST')
          return { ...shared, status: 'on_request' as ListLineStatus };
        if (availability === 'ASK_SHOP')
          return { ...shared, status: 'unavailable' as ListLineStatus };
        if (line.quantity < product.minQuantity || line.quantity % product.quantityStep !== 0)
          return { ...shared, status: 'invalid' as ListLineStatus };
        if (
          line.quantity > MAX_LINE_QUANTITY ||
          line.quantity * product.pricePaise > ONLINE_LINE_LIMIT_PAISE()
        )
          return { ...shared, status: 'over' as ListLineStatus };
        return { ...shared, status: 'ok' as ListLineStatus };
      }),
    };
  }

  /**
   * The shop's public facts. Nothing is returned until the family approved it: contact details
   * when contactApproved is set, the firm's legal identity when Firm.approvedAt is set.
   */
  @Public()
  @Get('shop')
  async shop() {
    // The first firm that is open and approved: the website speaks for the shop's main firm.
    const firm = await this.db.firm.findFirst({
      where: { approvedAt: { not: null }, active: true },
      orderBy: { createdAt: 'asc' },
      select: {
        legalName: true,
        tradeName: true,
        gstin: true,
        complaintOfficerName: true,
        complaintOfficerPhone: true,
      },
    });
    const { contactApproved, phone, whatsapp, address, hours, directionsUrl } = shopContent;
    return {
      name: shopContent.name,
      city: shopContent.city,
      story: shopContent.story.en,
      contactApproved,
      phone: contactApproved ? phone : '',
      whatsapp: contactApproved ? whatsapp : '',
      address: contactApproved ? address : '',
      hours: contactApproved ? hours : '',
      directionsUrl: contactApproved ? directionsUrl : '',
      family: shopContent.family,
      gallery: shopContent.gallery,
      firm,
    };
  }
}

const REFRESH_EVENTS = new Set(['PRODUCT_PRICE_UPDATED', 'CATALOG_UPDATED', 'STORE_UPDATED']);

/**
 * Tells the website its cached catalogue is out of date, so a published rate shows on the next page
 * load. A lost call does no harm: the website's cache ends within a minute by itself, and checkout
 * re-prices regardless. Does nothing until STOREFRONT_REVALIDATE_URL is set.
 */
@Injectable()
export class SiteRevalidator implements OnModuleInit, OnModuleDestroy {
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(@Inject(Events) private events: Events) {}

  onModuleInit() {
    if (!process.env.STOREFRONT_REVALIDATE_URL || !process.env.REVALIDATE_SECRET) return;
    this.subscription = this.events.stream.subscribe((event) => {
      if (!REFRESH_EVENTS.has(event.type)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.notify(), 2000);
      this.timer.unref?.();
    });
  }
  onModuleDestroy() {
    clearTimeout(this.timer);
    this.subscription?.unsubscribe();
  }
  async notify() {
    try {
      const response = await fetch(process.env.STOREFRONT_REVALIDATE_URL!, {
        method: 'POST',
        headers: { 'x-revalidate-secret': process.env.REVALIDATE_SECRET! },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        console.warn(JSON.stringify({ event: 'SITE_REVALIDATE_FAILED', status: response.status }));
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: 'SITE_REVALIDATE_FAILED',
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        }),
      );
    }
  }
}
