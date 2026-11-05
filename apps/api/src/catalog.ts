import { approvedAssets } from './product-assets';
import {
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Subject, finalize, interval, map, merge, takeUntil } from 'rxjs';
import { z } from 'zod';
import {
  addressSchema,
  personSchema,
  categorySchema,
  productSchema,
  productUpdateSchema,
  profileSchema,
  settingsSchema,
} from '@shiv/shared';
import { clientIp } from './abuse';
import { blindShops } from './blind-count';
import { Db } from './db';
import { Lifecycle } from './lifecycle';
import { AdvisorReadiness } from './advisor/readiness';
import { shopContent } from './public-content';
import {
  accountView,
  AuthRequest,
  Can,
  Contract,
  fail,
  Input,
  Public,
  scoped,
  Self,
  shopWhere,
} from './http';
import { paginate } from './pagination';
import { moveStock, pastBalance } from './inventory';
import { getConfig, onlineReady } from './config';
import { availabilityOf, type Access } from '@shiv/shared';

@Injectable()
export class Events {
  readonly stream = new Subject<{ type: string; productId?: string; priceVersion?: number }>();
  publish(event: { type: string; productId?: string; priceVersion?: number }) {
    this.stream.next(event);
  }
  // Open public streams in this process. Each idle stream holds a socket and memory, and the
  // request throttle only counts opens, so connections are capped per client IP and in total.
  private open = new Map<string, number>();
  private total = 0;
  /** Counts a new stream, or refuses it with 429. The returned release is safe to call twice. */
  admit(ip: string) {
    const c = getConfig();
    const mine = this.open.get(ip) || 0;
    if (mine >= c.EVENT_STREAMS_PER_IP || this.total >= c.EVENT_STREAMS_TOTAL)
      fail('RATE_LIMITED', 'Too many live connections. Close other tabs and try again.', 429);
    this.open.set(ip, mine + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const left = (this.open.get(ip) || 1) - 1;
      if (left) this.open.set(ip, left);
      else this.open.delete(ip);
    };
  }
}
/**
 * Anyone can read these routes: a stranger, and the person counting. There or not there is enough
 * for buying, and placing an order checks the real figure as always. The count itself never leaves.
 */
export const stockDuringCount = 10_000;
export const stockFor = (product: { stock: number }) =>
  product.stock > 0 ? stockDuringCount : product.stock;

/** Availability sits beside stock until every client has moved to it; levels stay private. */
function publicProduct<
  T extends {
    id: string;
    stock: number;
    pricePaise: number;
    sourcing: string;
    stockMode: string;
    stockLevels: { isOn: boolean }[];
  },
>({ stockLevels, ...product }: T) {
  return {
    ...product,
    stock: stockFor(product),
    // An item the shop only gets to order has no public rate, on any route.
    pricePaise: product.sourcing === 'ON_REQUEST' ? null : product.pricePaise,
    availability: availabilityOf({ ...product, stockLevels }),
  };
}
@ApiTags('Catalogue')
@Controller()
export class CatalogController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
    @Inject(Lifecycle) private lifecycle: Lifecycle,
    @Inject(AdvisorReadiness) private advisor: AdvisorReadiness,
  ) {}
  @Public()
  @Get('products')
  products(@Query() query: Record<string, string>) {
    return this.productPage(query, false);
  }
  async productPage(
    query: Record<string, string>,
    admin: boolean,
    shops: { locationId?: { in: string[] } } = {},
    access?: Access,
  ) {
    const parsed = z
      .object({
        q: z.string().trim().max(100).default(''),
        category: z.string().max(60).default(''),
        brand: z.string().max(80).default(''),
        availability: z.enum(['all', 'in', 'out']).default('all'),
        sort: z.enum(['name', 'price_asc', 'price_desc', 'newest']).default('name'),
        lowStock: z.enum(['true', 'false']).optional(),
      })
      .safeParse(query);
    if (!parsed.success) fail('INVALID_FILTER', 'Check the catalogue filters.');
    const f = parsed.data;
    const page = paginate(
      query,
      JSON.stringify({ admin, ...f }),
      f.sort.startsWith('price') ? 'pricePaise' : f.sort === 'newest' ? 'createdAt' : 'name',
      ['price_desc', 'newest'].includes(f.sort) ? 'desc' : 'asc',
    );
    const rows = await this.db.product.findMany({
      where: {
        AND: [
          admin ? {} : { active: true },
          admin && f.lowStock === 'true'
            ? { active: true, stock: { lte: this.db.product.fields.lowStockAt } }
            : {},
          page.after,
          f.q
            ? {
                OR: [
                  { name: { contains: f.q, mode: 'insensitive' } },
                  { nameHi: { contains: f.q, mode: 'insensitive' } },
                  { brand: { contains: f.q, mode: 'insensitive' } },
                  { grade: { contains: f.q, mode: 'insensitive' } },
                ],
              }
            : {},
          f.category ? { category: { slug: f.category } } : {},
          f.brand ? { brand: f.brand } : {},
          f.availability === 'in'
            ? { stock: { gt: 0 } }
            : f.availability === 'out'
              ? { stock: 0 }
              : {},
        ],
      },
      include: {
        category: true,
        stockLevels: admin
          ? { where: shops, select: { locationId: true, quantity: true, isOn: true } }
          : { where: { location: { active: true } }, select: { isOn: true } },
      },
      ...(admin ? { omit: { lowStockAt: false } } : {}),
      orderBy: page.orderBy,
      take: page.take,
    });
    if (!admin) {
      return page.finish(rows.map((row) => publicProduct(row)));
    }
    const blind = access ? await blindShops(this.db, access) : new Set<string>();
    // A person limited to certain shops sees those shops' count, not the whole firm's, and nobody
    // being kept blind sees a figure for the shop being counted.
    return page.finish(
      rows.map((row) => {
        const levels = row.stockLevels as { locationId: string; quantity: number; isOn: boolean }[];
        const open = levels.filter((level) => !blind.has(level.locationId));
        const hiding = open.length !== levels.length;
        if (!hiding && !('locationId' in shops)) return row;
        return {
          ...row,
          stock:
            hiding && !open.length ? null : open.reduce((sum, level) => sum + level.quantity, 0),
          stockHidden: hiding,
          stockLevels: levels.map((level) =>
            blind.has(level.locationId) ? { ...level, quantity: null } : level,
          ),
        };
      }),
    );
  }
  @Public() @Get('brands') brands(@Query('q') q = '') {
    if (typeof q !== 'string' || q.length > 80) fail('INVALID_FILTER', 'Check the brand search.');
    return this.db.$queryRaw<
      { brand: string }[]
    >`SELECT DISTINCT brand FROM "Product" WHERE active=true AND brand ILIKE ${'%' + q + '%'} ORDER BY brand LIMIT 50`;
  }
  @Public()
  @Get('products/:id')
  async product(@Param('id') id: string) {
    const product = await this.db.product.findFirst({
      where: { id, active: true },
      include: {
        category: true,
        stockLevels: { where: { location: { active: true } }, select: { isOn: true } },
      },
    });
    if (!product) fail('NOT_FOUND', 'This product is not available.', 404);
    return publicProduct(product);
  }
  @Public() @Get('categories') categories() {
    return this.db.category.findMany({ orderBy: { name: 'asc' } });
  }
  @Public() @Get('shop-content') content() {
    return shopContent;
  }
  @Public() @Get('client-config') async clientConfig() {
    const c = getConfig();
    return {
      android: {
        minimumVersion: c.ANDROID_MINIMUM_VERSION,
        latestVersion: c.ANDROID_LATEST_VERSION,
        storeUrl: c.ANDROID_STORE_URL,
      },
      askEnabled: await this.advisor.askEnabled(),
      awardsUrl: c.AWARDS_URL ?? null,
    };
  }
  @Public() @Get('store') async store() {
    const settings = await this.db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
    return {
      ...settings,
      storeName: 'Shiv Cement Store',
      onlinePaymentsAvailable: settings.onlinePaymentsEnabled && onlineReady(),
    };
  }
  @Public() @Sse('events') eventsStream(@Req() req: AuthRequest) {
    const release = this.events.admit(clientIp(req));
    // The response closes on disconnect, completion and shutdown alike.
    req.res?.once('close', release);
    return merge(this.events.stream, interval(25000).pipe(map(() => ({ type: 'HEARTBEAT' })))).pipe(
      // Ends open streams on shutdown so the server can drain; browsers reconnect automatically.
      takeUntil(this.lifecycle.closing),
      map((data) => ({ data })),
      finalize(release),
    );
  }

  @Can('stock.read', scoped) @Get('admin/products') async adminProducts(
    @Query() query: Record<string, string>,
    @Req() req: AuthRequest,
  ) {
    const page = await this.productPage(query, true, shopWhere(req, 'stock.read'), req.access);
    if (req.access['orders.read.money']) return page;
    // No rupee value for anyone who loads goods but does not see money.
    return {
      ...page,
      items: page.items.map((product) =>
        Object.fromEntries(Object.entries(product).filter(([key]) => !/paise$/i.test(key))),
      ),
    };
  }
  @Can('products.edit')
  @Post('admin/products')
  @Contract(productSchema)
  async create(@Input(productSchema) body: z.infer<typeof productSchema>, @Req() req: AuthRequest) {
    if (body.minQuantity % body.quantityStep)
      fail('INVALID_QUANTITY', 'Minimum quantity must be a multiple of the quantity step.');
    const product = await this.db.atomic(async (tx) => {
      await approvedAssets(tx, body.images);
      const p = await tx.product.create({
        data: { ...body, stock: 0 },
        include: { category: true },
      });
      if (body.stock)
        await moveStock(tx, {
          productId: p.id,
          kind: 'PURCHASE_IN',
          quantity: body.stock,
          actorId: req.user.id,
          reference: 'Opening stock',
          note: 'Initial product stock',
          idempotencyKey: `opening:${p.id}`,
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'PRODUCT_CREATED',
          entityId: p.id,
          details: { pricePaise: p.pricePaise, stock: p.stock },
        },
      });
      return tx.product.findUniqueOrThrow({
        where: { id: p.id },
        include: { category: true },
        omit: { lowStockAt: false },
      });
    });
    this.events.publish({ type: 'CATALOG_UPDATED', productId: product.id });
    return product;
  }
  @Can('products.edit')
  @Patch('admin/products/:id')
  @Contract(productUpdateSchema)
  async update(
    @Param('id') id: string,
    @Input(productUpdateSchema) input: z.infer<typeof productUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    // Stock is never written here: it changes only through the ledger. The editor still sends
    // the balance it loaded, which orders may have moved since; a balance the product never had
    // is an attempt to replace stock and is refused.
    const { expectedVersion, stock, ...data } = input;
    if (data.minQuantity % data.quantityStep)
      fail('INVALID_QUANTITY', 'Minimum quantity must be a multiple of the quantity step.');
    const product = await this.db.atomic(async (tx) => {
      await approvedAssets(tx, data.images);
      const old = await tx.product.findUniqueOrThrow({ where: { id } });
      if (old.version !== expectedVersion)
        fail('CONFLICT', 'Product changed. Refresh before saving.', 409);
      if (stock !== old.stock && !(await pastBalance(tx, id, stock)))
        fail(
          'USE_INVENTORY_MOVEMENT',
          'Record a stock movement instead of replacing the balance.',
          409,
        );
      const monetaryChanged = old.pricePaise !== data.pricePaise;
      const changed =
        monetaryChanged ||
        old.unit !== data.unit ||
        old.packSize !== data.packSize ||
        old.minQuantity !== data.minQuantity ||
        old.quantityStep !== data.quantityStep;
      const p = await tx.product.update({
        where: { id },
        data: {
          ...data,
          version: { increment: 1 },
          ...(changed ? { priceVersion: { increment: 1 }, priceUpdatedAt: new Date() } : {}),
        },
        include: { category: true },
        omit: { lowStockAt: false },
      });
      if (monetaryChanged)
        await tx.productPriceHistory.create({
          data: {
            productId: id,
            oldPricePaise: old.pricePaise,
            newPricePaise: p.pricePaise,
            version: p.priceVersion,
            actorId: req.user.id,
          },
        });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: monetaryChanged
            ? 'PRICE_CHANGED'
            : changed
              ? 'PRODUCT_TERMS_CHANGED'
              : 'PRODUCT_UPDATED',
          entityId: id,
          details: {
            oldPricePaise: old.pricePaise,
            newPricePaise: p.pricePaise,
            oldStock: old.stock,
            newStock: p.stock,
            active: p.active,
          },
        },
      });
      return p;
    });
    this.events.publish({
      type: 'PRODUCT_PRICE_UPDATED',
      productId: id,
      priceVersion: product.priceVersion,
    });
    return product;
  }
  @Can('products.edit')
  @Post('admin/categories')
  @Contract(categorySchema)
  category(@Input(categorySchema) body: z.infer<typeof categorySchema>) {
    return this.db.category.create({ data: body });
  }
  @Can('store.edit')
  @Patch('admin/store')
  @Contract(settingsSchema)
  async updateStore(
    @Input(settingsSchema) input: z.infer<typeof settingsSchema>,
    @Req() req: AuthRequest,
  ) {
    const { expectedVersion, ...data } = input;
    if (data.onlinePaymentsEnabled && !onlineReady())
      fail(
        'PAYMENTS_NOT_CONFIGURED',
        'Configure Razorpay credentials before enabling online payments.',
      );
    await this.db.atomic(async (tx) => {
      const updated = await tx.storeSettings.updateMany({
        where: { id: 'store', version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (!updated.count) fail('CONFLICT', 'Delivery policy changed. Refresh before saving.', 409);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'STORE_SETTINGS_UPDATED',
          entityId: 'store',
          // The shop phone may be someone's own number, and this log can never be changed.
          details: { fields: Object.keys(data) },
        },
      });
    });
    this.events.publish({ type: 'STORE_UPDATED' });
    return this.store();
  }
}

@ApiTags('Account')
@Controller('me')
export class AccountController {
  constructor(@Inject(Db) private db: Db) {}
  @Self() @Get() me(@Req() req: AuthRequest) {
    return accountView(req.user);
  }
  @Self()
  @Patch()
  @Contract(profileSchema)
  async profile(
    @Input(profileSchema) body: z.infer<typeof profileSchema>,
    @Req() req: AuthRequest,
  ) {
    const user = await this.db.user.update({
      where: { id: req.user.id },
      data: {
        name: body.name,
        language: body.language,
        ...(req.user.role !== 'ADMIN' && body.contractor && req.user.contractorStatus !== 'VERIFIED'
          ? { contractorStatus: 'PENDING' }
          : {}),
      },
    });
    return accountView(user);
  }
  @Self() @Get('addresses') addresses(@Req() req: AuthRequest) {
    return this.db.address.findMany({
      where: { userId: req.user.id },
      orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }
  @Self()
  @Post('addresses')
  @Contract(addressSchema)
  async addAddress(
    @Input(addressSchema) body: z.infer<typeof addressSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      if ((await tx.address.count({ where: { userId: req.user.id } })) >= 20)
        fail('ADDRESS_LIMIT', 'You can save up to 20 addresses.');
      return tx.address.create({ data: { ...body, userId: req.user.id } });
    });
  }
  @Self()
  @Patch('addresses/:id')
  @Contract(addressSchema)
  async editAddress(
    @Param('id') id: string,
    @Input(addressSchema) body: z.infer<typeof addressSchema>,
    @Req() req: AuthRequest,
  ) {
    const result = await this.db.address.updateMany({
      where: { id, userId: req.user.id },
      data: body,
    });
    if (!result.count) fail('NOT_FOUND', 'Address not found.', 404);
    return this.db.address.findUniqueOrThrow({ where: { id } });
  }

  @Self() @Delete('addresses/:id') async deleteAddress(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    const result = await this.db.address.deleteMany({ where: { id, userId: req.user.id } });
    if (!result.count) fail('NOT_FOUND', 'Address not found.', 404);
    return { ok: true };
  }
  /** My people. Only an account the shop allows credit on may add anyone (plan 04 section 2). */
  @Self() @Get('people') async people(@Req() req: AuthRequest) {
    const rows = await this.db.accountDelegate.findMany({
      where: { accountId: req.user.id, endedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, phone: true, name: true, createdAt: true },
    });
    return rows;
  }
  @Self()
  @Post('people')
  @Contract(personSchema)
  async addPerson(
    @Input(personSchema) body: z.infer<typeof personSchema>,
    @Req() req: AuthRequest,
  ) {
    if (!req.user.creditAllowed)
      fail('FORBIDDEN', 'The shop has not opened udhaar on this account.', 403);
    if (body.phone === req.user.phone) fail('SELF_CHANGE', 'This is your own number.');
    return this.db.atomic(async (tx) => {
      const active = await tx.accountDelegate.count({
        where: { accountId: req.user.id, endedAt: null, phone: { not: body.phone } },
      });
      if (active >= 10) fail('PEOPLE_LIMIT', 'You can add up to 10 people.');
      const person = await tx.accountDelegate.upsert({
        where: { accountId_phone: { accountId: req.user.id, phone: body.phone } },
        create: { accountId: req.user.id, ...body },
        // Adding someone again reopens the same row, with no more rights than a new one has.
        update: { name: body.name, endedAt: null, canUseUdhaar: false },
        select: { id: true, phone: true, name: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'PERSON_ADDED',
          entityId: person.id,
          // The number is someone else's, and this log can never be changed.
          details: { accountId: req.user.id },
        },
      });
      return person;
    });
  }
  @Self() @Delete('people/:id') async removePerson(
    @Param('id') id: string,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const ended = await tx.accountDelegate.updateMany({
        where: { id, accountId: req.user.id, endedAt: null },
        data: { endedAt: new Date(), canUseUdhaar: false },
      });
      if (!ended.count) fail('NOT_FOUND', 'That person is not on your list.', 404);
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'PERSON_REMOVED',
          entityId: id,
          details: { accountId: req.user.id },
        },
      });
      return { ok: true };
    });
  }
  @Self() @Get('notifications') notifications(@Req() req: AuthRequest) {
    return this.db.notification.findMany({
      where: {
        userId: req.user.id,
        OR: [{ sendAfter: null }, { sendAfter: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
