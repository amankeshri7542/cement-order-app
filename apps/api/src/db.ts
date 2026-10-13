import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Scripts pass their own database URL; Nest passes nothing.
  constructor(@Optional() options: { datasourceUrl?: string } = {}) {
    // Owner-only product settings stay out of every customer response unless a staff endpoint
    // asks for them with `omit: { lowStockAt: false }`.
    super({ ...options, omit: { product: { lowStockAt: true } } });
  }
  async onModuleInit() {
    await this.$connect();
    if (process.env.NODE_ENV === 'production') await this.assertRuntimeRole();
  }
  async assertRuntimeRole() {
    const [role] = await this.$queryRaw<{ unsafe: boolean }[]>`
      SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
        OR has_schema_privilege(current_user, 'public', 'CREATE')
        OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid)
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = 'public' AND c.relowner = pg_roles.oid)) AS unsafe
      FROM pg_roles WHERE rolname = current_user`;
    if (!role || role.unsafe)
      throw new Error(
        'API requires a restricted runtime database role, separate from migration credentials',
      );
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async atomic<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(run, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 3
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }
}
