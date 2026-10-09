import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security';
import { phoneSchema } from '@shiv/shared';
const phone = phoneSchema.parse(process.argv[2]);
const db = new PrismaClient();
async function main() {
  try {
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!password)
      throw new Error(
        'Set ADMIN_BOOTSTRAP_PASSWORD securely in the environment (12–200 characters). It will not be logged.',
      );
    const passwordHash = await hashPassword(password);
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
        create: { phone, role: 'ADMIN', name: process.argv[3] || 'Store owner' },
        update: { role: 'ADMIN', ...(process.argv[3] ? { name: process.argv[3] } : {}) },
      });
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
