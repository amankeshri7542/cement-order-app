// Sets up the database for the Maestro smoke run on the emulator, and prints what it needs.
// Run from the repo root: npx tsx apps/staff/e2e/android-seed.ts
import { randomUUID } from 'node:crypto';
import { adminPost, db, MAIN, pairScreen, resetWorld, tokenFor } from './world';

const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
async function order(number: string, loaded: boolean) {
  const row = await db.order.create({
    data: {
      number,
      locationId: MAIN,
      userId: 'customer',
      source: 'PHONE',
      createdById: 'manager',
      idempotencyKey: randomUUID(),
      status: loaded ? 'PREPARING' : 'CONFIRMED',
      confirmedAt: new Date(),
      confirmedById: 'manager',
      address: {
        name: 'Test Customer',
        phone: '+919000007100',
        line1: 'Plot 12',
        area: 'Kankarbagh',
        city: 'Patna',
        state: 'Bihar',
        pincode: '800020',
        landmark: 'Mandir ke paas',
      },
      deliveryDate: today(),
      notes: '',
      subtotalPaise: 1850000,
      deliveryFeePaise: 0,
      totalPaise: 1850000,
      items: {
        create: {
          productId: 'cement',
          name: 'Cement',
          unit: '50 kg bag',
          packSize: '',
          quantity: 50,
          pricePaise: 37000,
          listPricePaise: 37000,
          priceVersion: 1,
          lineTotalPaise: 1850000,
        },
      },
      payment: { create: { method: 'COD', status: 'PENDING', amountPaise: 1850000 } },
      ...(loaded
        ? {
            loads: {
              create: {
                locationId: MAIN,
                vehicle: 'BR01AB1234',
                loadedById: 'manager',
                idempotencyKey: randomUUID(),
              },
            },
          }
        : {}),
    },
  });
  return row;
}
async function main() {
  await resetWorld();
  await db.user.update({ where: { id: 'keeper' }, data: { name: 'Test Keeper' } });
  await db.session.updateMany({
    where: { userId: 'papa' },
    data: { expiresAt: new Date(Date.now() + 6 * 3600000) },
  });
  const { token } = await pairScreen();
  await order('SC-MAESTRO', false);
  const forTrip = await order('SC-TRIP', true);
  await adminPost('manager', 'trips', {
    locationId: MAIN,
    driverId: 'driver',
    vehicle: 'BR01AB1234',
    orderIds: [forTrip.id],
    idempotencyKey: randomUUID(),
  });
  console.log(JSON.stringify({ SCREEN_TOKEN: token, OWNER_TOKEN: tokenFor('papa') }));
  await db.$disconnect();
}
void main();
