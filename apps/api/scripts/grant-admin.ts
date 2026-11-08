import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security';
import { phoneSchema } from '@shiv/shared';
const phone = phoneSchema.parse(process.argv[2]);
const db = new PrismaClient();
async function main() {
  try {
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!password && process.env.STAFF_PASSPHRASE_REQUIRED === 'true')
      throw new Error(
        'Set ADMIN_BOOTSTRAP_PASSWORD securely in the environment (12–200 characters). It will not be logged.',
      );
    const passwordHash = password ? await hashPassword(password) : undefined;
    await db.$transaction(async (tx) => {
      await tx.storeSettings.upsert({
        where: { id: 'store' },
        update: {},
        create: {
          id: 'store',
          deliveryFeePaise: 0,
          onlinePaymentsEnabled: false,
          deliveryMessage: 'Contact the store to confirm delivery coverage and charges.',
        },
      });
      const user = await tx.user.upsert({
        where: { phone },
        create: {
          phone,
          role: 'ADMIN',
          language: 'hinglish',
          name: process.argv[3] || 'Store owner',
        },
        update: {
          role: 'ADMIN',
          staffPausedAt: null,
          ...(process.argv[3] ? { name: process.argv[3] } : {}),
        },
      });
      // Rights come from the membership. An owner holds one with no shop on it.
      const active = await tx.staffMembership.findMany({
        where: { userId: user.id, endedAt: null },
      });
      if (!active.some((membership) => membership.role === 'OWNER')) {
        await tx.staffMembership.updateMany({
          where: { userId: user.id, endedAt: null },
          data: { endedAt: new Date(), endedById: 'bootstrap-cli' },
        });
        await tx.staffMembership.create({
          data: { userId: user.id, locationId: null, role: 'OWNER', grantedById: 'bootstrap-cli' },
        });
      }
      if (passwordHash)
        await tx.adminCredential.upsert({
          where: { userId: user.id },
          create: { userId: user.id, passwordHash },
          update: { passwordHash },
        });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: { actorId: 'bootstrap-cli', event: 'ADMIN_GRANTED', entityId: user.id, details: {} },
      });
    });
    console.log(
      'Store admin access granted. Sign in using this phone number and your staff passphrase. Previous sessions were revoked.',
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
