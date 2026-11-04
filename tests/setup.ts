import { PrismaClient } from '@prisma/client';
import { grantOwners } from '../apps/api/test/staff-helper';
export default async function setup() {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  try {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
    );
    // Other test suites share this database and leave their shops open. Journeys start with one.
    await db.location.updateMany({ where: { id: { not: 'loc_main' } }, data: { active: false } });
    await db.category.create({ data: { id: 'cement', name: 'Cement', slug: 'cement' } });
    await db.product.create({
      data: {
        id: 'test-ultratech',
        categoryId: 'cement',
        name: 'UltraTech Super',
        brand: 'UltraTech',
        type: 'PPC Cement',
        grade: 'PPC',
        unit: '50 kg bag',
        pricePaise: 41000,
        stock: 500,
        images: [],
        description: 'Cement for strong foundations.',
        recommendedUse: 'Residential construction.',
      },
    });
    await db.storeSettings.create({
      data: { id: 'store', phone: '+919999997007', deliveryFeePaise: 50000 },
    });
    await db.deliveryZone.create({
      data: {
        id: 'test-zone',
        name: 'Patna test',
        deliveryFeePaise: 50000,
        minimumOrderPaise: 0,
        estimate: 'Test delivery',
        pincodes: { create: [{ pincode: '800020' }, { pincode: '800001' }] },
      },
    });
    await db.user.create({
      data: { phone: '+919999997009', name: 'Operations test admin', role: 'ADMIN' },
    });
    await db.user.create({ data: { phone: '+919999997007', name: 'Store owner', role: 'ADMIN' } });
    await db.user.createMany({
      data: ['+919999997010', '+919999997011', '+919999997012'].map((phone) => ({
        phone,
        name: 'Rate Studio test admin',
        role: 'ADMIN' as const,
      })),
    });
    await db.user.create({
      data: { phone: '+919999997008', name: 'Price test admin', role: 'ADMIN' },
    });
    await db.user.create({
      data: { phone: '+919999997013', name: 'Phase 4 desk admin', role: 'ADMIN' },
    });
    await grantOwners(db);
  } finally {
    await db.$disconnect();
  }
}
