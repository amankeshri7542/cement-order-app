import { PrismaClient } from '@prisma/client';
import { phoneSchema } from '@shiv/shared';
const phone = phoneSchema.parse(process.argv[2]);
const db = new PrismaClient();
async function main() {
  try {
    await db.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone },
        create: { phone, role: 'ADMIN', name: 'Store owner' },
        update: { role: 'ADMIN' },
      });
      await tx.auditLog.create({
        data: { actorId: 'bootstrap-cli', event: 'ADMIN_GRANTED', entityId: user.id, details: {} },
      });
    });
    console.log('Store admin access granted. Sign in using this phone number.');
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
