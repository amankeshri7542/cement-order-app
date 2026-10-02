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
  products(@Query('q') q?: string, @Query('category') category?: string) {
    return this.db.product.findMany({
      where: {
        active: true,
        ...(q
          ? {
              OR: [
                { name: { contains: q.slice(0, 100), mode: 'insensitive' } },
                { brand: { contains: q.slice(0, 100), mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(category ? { category: { slug: category } } : {}),
      },
      include: { category: true },
      orderBy: [{ stock: 'desc' }, { name: 'asc' }],
      take: 200,
    });
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

  @Admin() @Get('admin/products') adminProducts() {
    return this.db.product.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
  }
  @Admin()
  @Post('admin/products')
  @Contract(productSchema)
  async create(@Input(productSchema) body: z.infer<typeof productSchema>, @Req() req: AuthRequest) {
    const product = await this.db.atomic(async (tx) => {
      const p = await tx.product.create({ data: body, include: { category: true } });
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'PRODUCT_CREATED',
          entityId: p.id,
          details: { pricePaise: p.pricePaise, stock: p.stock },
        },
      });
      return p;
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
    const product = await this.db.atomic(async (tx) => {
      const old = await tx.product.findUniqueOrThrow({ where: { id } });
      if (old.version !== expectedVersion)
        fail('CONFLICT', 'Product changed. Refresh before saving.', 409);
      const changed = old.pricePaise !== data.pricePaise;
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
        ...(req.user.role !== 'ADMIN' && body.contractor !== undefined
          ? { role: body.contractor ? 'CONTRACTOR' : 'CUSTOMER' }
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
