// Makes the database match content/advisor. Run after migrations on each release:
//   node apps/api/dist/advisor/sync-cli.js        (or `npm run advisor:sync -w @shiv/api`)
// An edited article drops out here until its new text is signed. Needs a role that can delete
// chunks, so it runs with the migration credentials, not the API's own.
import { PrismaClient, Prisma } from '@prisma/client';
import { loadContent, syncContent } from './content';

async function main() {
  const db = new PrismaClient();
  try {
    const result = await syncContent(
      {
        atomic: (run) =>
          db.$transaction(run, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 60000,
          }),
      },
      loadContent(),
    );
    console.log(
      JSON.stringify({
        event: 'ADVISOR_SYNC',
        published: result.published,
        drafts: result.drafts.length,
        retired: result.retired,
        refused: result.refused,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
