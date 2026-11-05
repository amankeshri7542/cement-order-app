import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

type Tx = Prisma.TransactionClient;
export const streamOf = (userId: string) => `att:${userId}`;

export type EventInput = {
  userId: string;
  kind: Prisma.AttendanceEventCreateInput['kind'];
  actorId: string;
  locationId?: string | null;
  captureId?: string | null;
  claimedAgeMs?: number | null;
  bootCount?: number | null;
  appVersion?: string | null;
  deviceId?: string | null;
  signature?: string | null;
  qrCounter?: number | null;
  screenId?: string | null;
  distanceM?: number | null;
  accuracyM?: number | null;
  mocked?: boolean | null;
  reasons?: string[];
  geoHash?: string | null;
  evidenceId?: string | null;
  result?: Prisma.AttendanceEventCreateInput['result'];
  reason?: string;
  refersToId?: string | null;
  correctsKind?: string | null;
  correctedAt?: Date | null;
};

const fields = [
  'userId',
  'kind',
  'actorId',
  'locationId',
  'captureId',
  'claimedAgeMs',
  'bootCount',
  'appVersion',
  'deviceId',
  'signature',
  'qrCounter',
  'screenId',
  'distanceM',
  'accuracyM',
  'mocked',
  'reasons',
  'geoHash',
  'evidenceId',
  'result',
  'reason',
  'refersToId',
  'correctsKind',
  'correctedAt',
  'serverAt',
] as const;
type Hashed = Partial<Record<(typeof fields)[number], unknown>>;
/** One fixed order and form, so the same row always hashes the same, whatever reads it back. */
export function eventHash(prevHash: string, seq: number, row: Hashed) {
  const canonical = JSON.stringify([
    seq,
    ...fields.map((name) => {
      const value = row[name];
      if (value instanceof Date) return value.toISOString();
      if (name === 'reasons') return value ?? [];
      if (name === 'reason') return value ?? '';
      return value ?? null;
    }),
  ]);
  return createHash('sha256').update(prevHash).update(canonical).digest('hex');
}

/** The only way an attendance event is written: each row carries the hash of the one before. */
export async function appendEvent(tx: Tx, input: EventInput) {
  const stream = streamOf(input.userId);
  // Scans by one person line up; scans by different people never wait for each other.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${stream}))`;
  const last = await tx.attendanceEvent.findFirst({
    where: { stream },
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  });
  const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? '';
  const serverAt = new Date(clock!.now.getTime());
  const hash = eventHash(prevHash, seq, { ...input, serverAt });
  return tx.attendanceEvent.create({
    data: { ...input, reasons: input.reasons ?? [], stream, seq, prevHash, hash, serverAt },
  });
}

/** The first row in a person's chain that no longer adds up, or null if the whole chain does. */
export function brokenAt(
  rows: readonly (Hashed & { seq: number; prevHash: string; hash: string })[],
) {
  let prev = '';
  let seq = 1;
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (row.seq !== seq || row.prevHash !== prev || eventHash(prev, row.seq, row) !== row.hash)
      return seq;
    prev = row.hash;
    seq++;
  }
  return null;
}

/** All chains' last rows together, so one code covers everyone's record. */
export function rootOf(heads: readonly { stream: string; hash: string }[], prevRoot: string) {
  const sorted = [...heads].sort((a, b) => a.stream.localeCompare(b.stream));
  const digest = createHash('sha256').update(prevRoot);
  for (const head of sorted) digest.update(`${head.stream}:${head.hash}\n`);
  return digest.digest('hex');
}
