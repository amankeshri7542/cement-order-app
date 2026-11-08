import type { PrismaClient } from '@prisma/client';
import { istInstant } from '../calendar';
import { PLACES, type SeedContext } from '../context';

/**
 * Two firms, two shops and a godown site that holds one location per firm. The first firm and the
 * main shop come from the migrations; the rest are demo rows. Firm names are placeholders: the real
 * ones are entered by the owners, never committed.
 */
export const SHOPS = [PLACES.shopA, PLACES.shopB] as const;
export const GODOWNS = [PLACES.godownA, PLACES.godownB] as const;
export const firmOf: Record<string, string> = {
  [PLACES.shopA]: PLACES.firmA,
  [PLACES.godownA]: PLACES.firmA,
  [PLACES.shopB]: PLACES.firmB,
  [PLACES.godownB]: PLACES.firmB,
};
/** Each shop is restocked from its own firm's godown location: no transfer crosses firms. */
export const godownFor: Record<string, string> = {
  [PLACES.shopA]: PLACES.godownA,
  [PLACES.shopB]: PLACES.godownB,
};

export async function seedPlaces(db: PrismaClient, ctx: SeedContext) {
  const started = istInstant(ctx.firstDay, 7, 0);
  await db.firm.create({
    data: {
      id: PLACES.firmB,
      legalName: 'Demo Firm B (sample)',
      tradeName: 'Demo Firm B',
      createdAt: started,
    },
  });
  await db.location.update({
    where: { id: PLACES.shopA },
    data: {
      name: 'Shop A (demo)',
      kind: 'SHOP',
      siteId: 'demo-site-shop-a',
      stockStartedAt: started,
      attendanceOn: true,
    },
  });
  await db.location.createMany({
    data: [
      {
        id: PLACES.shopB,
        firmId: PLACES.firmB,
        slug: 'demo-shop-b',
        name: 'Shop B (demo)',
        kind: 'SHOP',
        siteId: 'demo-site-shop-b',
        stockStartedAt: started,
        attendanceOn: true,
        createdAt: started,
      },
      {
        id: PLACES.godownA,
        firmId: PLACES.firmA,
        slug: 'demo-godown-a',
        name: 'Godown · Firm A (demo)',
        kind: 'GODOWN',
        siteId: PLACES.godownSite,
        stockStartedAt: started,
        createdAt: started,
      },
      {
        id: PLACES.godownB,
        firmId: PLACES.firmB,
        slug: 'demo-godown-b',
        name: 'Godown · Firm B (demo)',
        kind: 'GODOWN',
        siteId: PLACES.godownSite,
        stockStartedAt: started,
        createdAt: started,
      },
    ],
  });
  await db.deliveryZone.create({
    data: {
      id: 'demo-zone-patna',
      name: 'Patna (demo)',
      active: true,
      deliveryFeePaise: 40000,
      minimumOrderPaise: 0,
      freeDeliveryAbovePaise: 5000000,
      estimate: 'Demo zone. The shop calls to fix the time.',
      locationId: PLACES.shopA,
      pincodes: {
        create: [
          '800001',
          '800002',
          '800007',
          '800011',
          '800013',
          '800014',
          '800016',
          '800020',
        ].map((pincode) => ({ pincode })),
      },
    },
  });
  await db.deliveryZone.create({
    data: {
      id: 'demo-zone-west',
      name: 'Danapur side (demo)',
      active: true,
      deliveryFeePaise: 50000,
      minimumOrderPaise: 0,
      freeDeliveryAbovePaise: 5000000,
      estimate: 'Demo zone. The shop calls to fix the time.',
      locationId: PLACES.shopB,
      pincodes: { create: ['801503', '801505', '801105'].map((pincode) => ({ pincode })) },
    },
  });
}
