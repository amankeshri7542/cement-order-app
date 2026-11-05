import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { Server } from 'node:http';
import { bridgeMessage, bridgePairMessage } from '@shiv/shared';
import request from 'supertest';
import { gzipSync } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';

/** A pretend shop PC: a real Ed25519 key, and every call signed the way the program signs it. */
export function makePc() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    id: '',
    seq: Date.now() * 1000,
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    sign: (message: string) => sign(null, Buffer.from(message), privateKey).toString('base64'),
  };
}
export type Pc = ReturnType<typeof makePc>;
export const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function pairBody(pc: Pc, code: string) {
  return { code, publicKey: pc.publicKey, proof: pc.sign(bridgePairMessage(code, pc.publicKey)) };
}
export type Options = {
  seq?: string;
  time?: string;
  signAs?: Pc;
  signPath?: string;
  signBody?: Buffer;
  device?: string;
  protocol?: string;
  drop?: string[];
};
/** A signed call. Every field can be set wrong, to test what a tampered request gets. */
export function signed(
  server: Server,
  pc: Pc,
  method: 'get' | 'post' | 'put',
  path: string,
  body?: object | Buffer,
  options: Options = {},
) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ? JSON.stringify(body) : '');
  const seq = options.seq ?? String(++pc.seq);
  const time = options.time ?? String(Date.now());
  const digest = sha(options.signBody ?? bytes);
  const message = bridgeMessage(method.toUpperCase(), options.signPath ?? path, time, seq, digest);
  const headers: Record<string, string> = {
    'X-Bridge-Protocol': options.protocol ?? '1',
    'X-Bridge-Device': options.device ?? pc.id,
    'X-Bridge-Time': time,
    'X-Bridge-Seq': seq,
    'X-Bridge-Body-Sha256': digest,
    'X-Bridge-Signature': (options.signAs ?? pc).sign(message),
  };
  for (const name of options.drop ?? []) delete headers[name];
  let sent = request(server)[method](path).set(headers);
  if (bytes.length) sent = sent.set('Content-Type', 'application/octet-stream').send(bytes);
  return sent;
}

export const utf16gz = (text: string) => gzipSync(Buffer.from(text, 'utf16le'));
export const smallAnswer = (text: string) => utf16gz(text).toString('base64');
export const rows = (list: string[][]) =>
  `<ENVELOPE>${list
    .map((row) =>
      row
        .map((cell, index) => {
          const tag = `F${String(index + 1).padStart(2, '0')}`;
          return `<${tag}>${cell}</${tag}>`;
        })
        .join(''),
    )
    .join('')}</ENVELOPE>`;
export const companyRow = (
  guid = 'co-guid-0001',
  name = 'Bench Traders',
  altMst = '10',
  altVch = '0',
  lastDate = '',
) => [guid, name, '2025-04-01', lastDate, altMst, altVch];
export const licenceRow = (educational = 'No') => [
  '7',
  '1',
  'TallyPrime 7.1',
  educational,
  'Yes',
  'Yes',
  'No',
  'No',
];
export const beat = (companies: string[][] = [companyRow()], licence = licenceRow()) => ({
  state: 'OK',
  version: '1.0.0',
  os: 'Test Windows x64',
  woke: false,
  caps: { diskFreeMb: 5000 },
  probe: {
    companies: smallAnswer(rows(companies)),
    licence: smallAnswer(rows([licence])),
  },
});

/** Every Tally table, cleaned the way the others are: the append-only ones with their guards lifted. */
export async function clearTally(db: PrismaClient) {
  for (const [table, trigger] of [
    ['TallyVoucherChange', 'tally_voucher_change_append_only'],
    ['KhataVoucherMatch', 'khata_voucher_match_append_only'],
  ]) {
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER ${trigger}`);
    await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    await db.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER ${trigger}`);
  }
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "KhataRecon", "TallyRelease", "TallyPartyLink", "TallyVoucherItem", "TallyVoucherLine", "TallyVoucher", "TallyLedger", "TallyStockItem", "TallyGodown", "TallyVoucherType", "TallyGroup", "TallyChunk", "TallySyncJob", "TallyCompany", "TallyPairingCode", "TallyDevice" CASCADE',
  );
}

/** Loads the real program from its own folder, as it has no package of its own to import. */
export const bridgeFile = (file: string) =>
  new URL(`../../tally-bridge/${file}`, `file://${__dirname}/`).href;
