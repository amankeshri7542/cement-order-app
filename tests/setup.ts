import { PrismaClient } from '@prisma/client';
export default async function setup() {
  const db = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
  try {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
    );
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
    await db.storeSettings.create({ data: { id: 'store', deliveryFeePaise: 50000 } });
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
      data: { phone: '+919297513709', name: 'Operations test admin', role: 'ADMIN' },
    });
    await db.user.create({ data: { phone: '+919297513707', name: 'Store owner', role: 'ADMIN' } });
    await db.user.create({
      data: { phone: '+919297513708', name: 'Price test admin', role: 'ADMIN' },
    });
  } finally {
    await db.$disconnect();
  }
}
