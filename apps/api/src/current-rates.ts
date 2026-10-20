import { Controller, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Db } from './db';
import { Admin, AuthRequest, Contract, Input, fail } from './http';
import { t } from '@shiv/i18n';
import { rateCardPng, renderRateCardPages, type CardSnapshot } from './rate-studio/cards';
const schema = z.strictObject({ language: z.enum(['hi', 'en']).default('hi') });
@ApiTags('Owner current rates')
@Admin()
@Controller('admin/rate-cards')
export class CurrentRatesController {
  constructor(@Inject(Db) private db: Db) {}
  @Post('current')
  @Contract(schema)
  async current(@Input(schema) input: z.infer<typeof schema>, @Req() req: AuthRequest) {
    const snapshot = await this.db.atomic(async (tx) => {
      const products = await tx.product.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        take: 101,
      });
      if (!products.length) fail('EMPTY_BATCH', 'Add materials before sharing rates.');
      if (products.length > 100)
        fail('RESOURCE_LIMIT', 'Use Rate Studio to share a selected catalogue.', 409);
      const settings = await tx.storeSettings.findUniqueOrThrow({ where: { id: 'store' } });
      const snapshot: CardSnapshot = {
        heading: t('owner.shareRates', {}, input.language),
        deliveryMessage: settings.deliveryMessage,
        promotionalCopy: '',
        contactLabel: t('owner.storePhone', {}, input.language),
        phone: settings.phone,
        whatsapp: settings.phone,
        publishedAt: new Date().toISOString(),
        items: products.map((product) => ({
          name: input.language === 'hi' ? product.nameHi || product.name : product.name,
          brand: product.brand,
          specification: [product.grade, product.packSize].filter(Boolean).join(' · '),
          unit: product.unit,
          pricePaise: product.pricePaise,
        })),
      };
      await tx.auditLog.create({
        data: {
          actorId: req.user.id,
          event: 'CURRENT_RATES_SHARED',
          entityId: 'store',
          details: {
            products: products.map((product) => ({
              id: product.id,
              priceVersion: product.priceVersion,
            })),
            publishedAt: snapshot.publishedAt,
          },
        },
      });
      return snapshot;
    });
    const pages = [];
    for (const svg of renderRateCardPages(snapshot, 'SHEET', 'COUNTER'))
      pages.push({ pngBase64: (await rateCardPng(svg)).toString('base64') });
    return { publishedAt: snapshot.publishedAt, pages };
  }
}
