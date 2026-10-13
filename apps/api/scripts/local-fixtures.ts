import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security';

const url = new URL(process.env.DATABASE_URL || '');
if (
  process.env.NODE_ENV === 'production' ||
  process.env.OTP_PROVIDER !== 'mock' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname)
)
  throw new Error('Local fixtures require a loopback development database and mock OTP.');
const db = new PrismaClient();
async function main() {
  const passwordHash = await hashPassword('Local-owner-only-2026!');
  await db.$transaction(async (tx) => {
    await tx.storeSettings.upsert({
      where: { id: 'store' },
      update: {},
      create: {
        id: 'store',
        onlinePaymentsEnabled: false,
        deliveryFeePaise: 0,
        deliveryMessage: 'Local test store. Example coverage only; no real orders.',
      },
    });
    await tx.category.upsert({
      where: { slug: 'cement' },
      update: {},
      create: { id: 'cement', name: 'Cement', slug: 'cement' },
    });
    const category = await tx.category.findUniqueOrThrow({ where: { slug: 'cement' } });
    const product = await tx.product.upsert({
      where: { id: 'local-demo-cement' },
      update: {},
      create: {
        id: 'local-demo-cement',
        name: 'TEST — Cement PPC',
        brand: 'Local practice',
        categoryId: category.id,
        type: 'PPC Cement',
        grade: 'PPC',
        unit: '50 kg bag',
        packSize: '50 kg',
        minQuantity: 1,
        quantityStep: 1,
        pricePaise: 39000,
        stock: 1000,
        active: true,
        images: [],
        description: 'Practice product only. 50 bags at ₹390 plus ₹500 delivery = ₹20,000.',
        recommendedUse: 'Local workflow testing only; not a real offer.',
      },
    });
    await tx.inventoryMovement.upsert({
      where: { idempotencyKey: 'fixture:local-demo-cement' },
      update: {},
      create: {
        productId: product.id,
        kind: 'PURCHASE_IN',
        quantity: 1000,
        balanceAfter: 1000,
        actorId: 'local-fixtures',
        reference: 'LOCAL TEST',
        note: 'Test opening stock only',
        idempotencyKey: 'fixture:local-demo-cement',
      },
    });
    // A dedicated test pincode avoids changing any pre-existing delivery zones.
    await tx.deliveryZone.upsert({
      where: { id: 'local-practice-zone' },
      update: {},
      create: {
        id: 'local-practice-zone',
        name: 'LOCAL TEST — Patna practice',
        active: true,
        deliveryFeePaise: 50000,
        minimumOrderPaise: 0,
        freeDeliveryAbovePaise: null,
        estimate: 'Practice delivery; owner will confirm by phone.',
        pincodes: { create: { pincode: '800099' } },
      },
    });
    for (const [phone, name, role] of [
      ['+919900000001', 'पापा / Father — local retail', 'ADMIN'],
      ['+919900000002', 'चाचा / Uncle — local wholesale', 'ADMIN'],
      ['+919900000003', 'Ravi — local customer', 'CUSTOMER'],
      ['+919900000004', 'Technical operator — local', 'ADMIN'],
    ] as const) {
      const user = await tx.user.upsert({
        where: { phone },
        update: {},
        create: { phone, name, role, language: role === 'ADMIN' ? 'hi' : 'en' },
      });
      if (role === 'ADMIN')
        await tx.adminCredential.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id, passwordHash },
        });
      else if (!(await tx.address.count({ where: { userId: user.id } })))
        await tx.address.create({
          data: {
            userId: user.id,
            label: 'TEST Site',
            name: 'Ravi — local customer',
            phone,
            line1: 'TEST Plot 24',
            area: 'Patna practice site',
            city: 'Patna',
            state: 'Bihar',
            pincode: '800099',
            landmark: 'Local test only',
          },
        });
    }
  });
  console.log(
    'Local practice fixtures ready. Existing prices, balances, accounts and delivery coverage were preserved.',
  );
}
void main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
