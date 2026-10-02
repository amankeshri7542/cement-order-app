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
import { Subject, interval, map, merge } from 'rxjs';
import { z } from 'zod';
import {
  addressSchema,
  categorySchema,
  productSchema,
  productUpdateSchema,
  profileSchema,
  settingsSchema,
} from '@shiv/shared';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, Public, fail } from './http';
import { paginate } from './pagination';
import { moveStock } from './inventory';
import { onlineReady } from './config';

@Injectable()
export class Events {
  readonly stream = new Subject<{ type: string; productId?: string; priceVersion?: number }>();
  publish(event: { type: string; productId?: string; priceVersion?: number }) {
    this.stream.next(event);
  }
}
@ApiTags('Catalogue')
@Controller()
export class CatalogController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(Events) private events: Events,
  ) {}
  @Public()
  @Get('products')
  products(@Query() query: Record<string, string>) {
    return this.productPage(query, false);
  }
  async productPage(query: Record<string, string>, admin: boolean) {
    const parsed = z
      .object({
        q: z.string().trim().max(100).default(''),
        category: z.string().max(60).default(''),
        brand: z.string().max(80).default(''),
        availability: z.enum(['all', 'in', 'out']).default('all'),
        sort: z.enum(['name', 'price_asc', 'price_desc', 'newest']).default('name'),
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
    return page.finish(
      await this.db.product.findMany({
        where: {
          AND: [
            admin ? {} : { active: true },
            page.after,
            f.q
              ? {
                  OR: [
                    { name: { contains: f.q, mode: 'insensitive' } },
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
        include: { category: true },
        orderBy: page.orderBy,
        take: page.take,
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
      include: { category: true },
    });
    if (!product) fail('NOT_FOUND', 'This product is not available.', 404);
    return product;
  }
  @Public() @Get('categories') categories() {
    return this.db.category.findMany({ orderBy: { name: 'asc' } });
  }
  @Public() @Get('store') async store() {
    const settings = await this.db.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
    return {
      ...settings,
      storeName: 'Shiv Cement Store',
      onlinePaymentsAvailable: settings.onlinePaymentsEnabled && onlineReady(),
    };
  }
  @Public() @Sse('events') eventsStream() {
    return merge(this.events.stream, interval(25000).pipe(map(() => ({ type: 'HEARTBEAT' })))).pipe(
      map((data) => ({ data })),
    );
  }

  @Admin() @Get('admin/products') adminProducts(@Query() query: Record<string, string>) {
    return this.productPage(query, true);
  }
  @Admin()
  @Post('admin/products')
  @Contract(productSchema)
  async create(@Input(productSchema) body: z.infer<typeof productSchema>, @Req() req: AuthRequest) {
    if (body.minQuantity % body.quantityStep)
      fail('INVALID_QUANTITY', 'Minimum quantity must be a multiple of the quantity step.');
    const product = await this.db.atomic(async (tx) => {
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
      return tx.product.findUniqueOrThrow({ where: { id: p.id }, include: { category: true } });
    });
    this.events.publish({ type: 'CATALOG_UPDATED', productId: product.id });
    return product;
  }
  @Admin()
  @Patch('admin/products/:id')
  @Contract(productUpdateSchema)
  async update(
    @Param('id') id: string,
    @Input(productUpdateSchema) input: z.infer<typeof productUpdateSchema>,
    @Req() req: AuthRequest,
  ) {
    const { expectedVersion, ...data } = input;
    if (data.minQuantity % data.quantityStep)
      fail('INVALID_QUANTITY', 'Minimum quantity must be a multiple of the quantity step.');
    const product = await this.db.atomic(async (tx) => {
      const old = await tx.product.findUniqueOrThrow({ where: { id } });
      if (old.version !== expectedVersion)
        fail('CONFLICT', 'Product changed. Refresh before saving.', 409);
      if (old.stock !== data.stock)
        fail(
          'USE_INVENTORY_MOVEMENT',
          'Record a stock movement instead of replacing the balance.',
          409,
        );
      const changed =
        old.pricePaise !== data.pricePaise ||
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
      });
      if (changed)
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
          event: changed ? 'PRICE_CHANGED' : 'PRODUCT_UPDATED',
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
  @Admin()
  @Post('admin/categories')
  @Contract(categorySchema)
  category(@Input(categorySchema) body: z.infer<typeof categorySchema>) {
    return this.db.category.create({ data: body });
  }
  @Admin()
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
          details: data,
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
  @Get() me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Patch()
  @Contract(profileSchema)
  profile(@Input(profileSchema) body: z.infer<typeof profileSchema>, @Req() req: AuthRequest) {
    return this.db.user.update({
      where: { id: req.user.id },
      data: {
        name: body.name,
        language: body.language,
        ...(req.user.role !== 'ADMIN' && body.contractor && req.user.contractorStatus !== 'VERIFIED'
          ? { contractorStatus: 'PENDING' }
          : {}),
      },
    });
  }
  @Get('addresses') addresses(@Req() req: AuthRequest) {
    return this.db.address.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
  }
  @Post('addresses')
  @Contract(addressSchema)
  async addAddress(
    @Input(addressSchema) body: z.infer<typeof addressSchema>,
    @Req() req: AuthRequest,
  ) {
    if ((await this.db.address.count({ where: { userId: req.user.id } })) >= 20)
      fail('ADDRESS_LIMIT', 'You can save up to 20 addresses.');
    return this.db.address.create({ data: { ...body, userId: req.user.id } });
  }
  @Delete('addresses/:id') async deleteAddress(@Param('id') id: string, @Req() req: AuthRequest) {
    const result = await this.db.address.deleteMany({ where: { id, userId: req.user.id } });
    if (!result.count) fail('NOT_FOUND', 'Address not found.', 404);
    return { ok: true };
  }
  @Get('notifications') notifications(@Req() req: AuthRequest) {
    return this.db.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
