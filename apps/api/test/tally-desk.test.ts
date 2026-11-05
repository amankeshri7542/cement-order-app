import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { dayShift, istToday } from '@shiv/shared';
import request from 'supertest';
import { Db } from '../src/db';
import { TallyRecon } from '../src/tally/recon';
import { addPerson, tokenFor } from './staff-helper';
import { clearTally } from './tally-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'tally-desk-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');

let app: INestApplication;
let server: Server;
let db: Db;
let recon: TallyRecon;

const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const post = (who: string, path: string, body: object = {}) =>
  request(server).post(`/api/v1/admin/tally/${path}`).set(as(who)).send(body);
const get = (who: string, path: string) =>
  request(server).get(`/api/v1/admin/tally/${path}`).set(as(who));

const today = istToday();
const COPY_FROM = '2026-04-01';
const NOT_ALLOWED = ['manager', 'cashier', 'keeper', 'driver', 'helper', 'tech', 'customer'];
const ALLOWED = ['owner', 'accountant'];
let companyId: string;
let phone = 9000007000;

async function makeCompany(extra: object = {}) {
  const device = await db.tallyDevice.create({
    data: { name: 'Dukaan 1', publicKey: randomUUID(), createdById: 'owner' },
  });
  const company = await db.tallyCompany.create({
    data: {
      guid: randomUUID(),
      name: 'Bench Traders',
      role: 'PRIMARY',
      phase: 'LIVE',
      copyFrom: COPY_FROM,
      ownerDeviceId: device.id,
      freshAt: new Date(),
      ...extra,
    },
  });
  return company.id;
}
async function ledger(
  guid: string,
  name: string,
  closing: bigint,
  extra: {
    baseline?: bigint;
    phones?: string[];
    gstin?: string;
    className?: string;
    company?: string;
  } = {},
) {
  return db.tallyLedger.create({
    data: {
      companyId: extra.company ?? companyId,
      guid,
      alterId: 1n,
      name,
      parent: 'Sundry Debtors',
      class: extra.className ?? 'DEBTOR',
      closingPaise: closing,
      closingAsOf: new Date(),
      openingPaise: 0n,
      baselinePaise: extra.baseline ?? 0n,
      tieOutOk: true,
      tieOutGapPaise: 0n,
      phones: extra.phones ?? [],
      gstin: extra.gstin,
    },
  });
}
async function customer(id: string, name = id, extra: object = {}) {
  await db.user.create({ data: { id, name, phone: `+91${++phone}`, ...extra } });
}
/** A khata entry through the same rule the app has: entries add up to the customer's balance. */
async function entry(
  customerId: string,
  amountPaise: number,
  at: Date | string,
  extra: object = {},
) {
  const user = await db.user.findUniqueOrThrow({ where: { id: customerId } });
  const balance = user.khataBalancePaise + amountPaise;
  const row = await db.customerLedgerEntry.create({
    data: {
      customerId,
      kind: amountPaise >= 0 ? 'ADJUSTMENT' : 'PAYMENT_RECEIVED',
      amountPaise,
      balanceAfterPaise: balance,
      actorId: 'owner',
      occurredAt: typeof at === 'string' ? new Date(`${at}T12:00:00+05:30`) : at,
      ...extra,
    },
  });
  await db.user.update({ where: { id: customerId }, data: { khataBalancePaise: balance } });
  return row;
}
/** A voucher on a party, with Tally's sign: a sale is the party's debit, so negative. */
async function voucher(
  ledgerRow: { guid: string; name: string; companyId: string },
  guid: string,
  amount: bigint,
  date: string,
  extra: object = {},
) {
  return db.tallyVoucher.create({
    data: {
      companyId: ledgerRow.companyId,
      guid,
      alterId: 1n,
      date,
      type: amount < 0n ? 'Sales' : 'Receipt',
      baseType: amount < 0n ? 'Sales' : 'Receipt',
      number: guid.toUpperCase(),
      party: ledgerRow.name,
      partyGuid: ledgerRow.guid,
      partyAmountPaise: amount,
      lines: {
        create: [
          { ledgerGuid: ledgerRow.guid, ledgerName: ledgerRow.name, amountPaise: amount },
          { ledgerName: 'Sales Account', amountPaise: -amount },
        ],
      },
      ...extra,
    },
  });
}
const link = (who: string, ledgerId: string, body: object) =>
  post(who, `parties/${ledgerId}/link`, body);

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
  recon = app.get(TallyRecon);
}, 30000);
beforeEach(async () => {
  await clearTally(db);
  await db.$executeRawUnsafe('ALTER TABLE "CustomerLedgerEntry" DISABLE TRIGGER USER');
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "CustomerLedgerEntry", "User", "AuditLog", "AuthRateLimit", "OtpChallenge", "Notification", "Order", "Quote" RESTART IDENTITY CASCADE',
  );
  await db.$executeRawUnsafe('ALTER TABLE "CustomerLedgerEntry" ENABLE TRIGGER USER');
  for (const [id, role, shops] of [
    ['owner', 'OWNER', undefined],
    ['manager', 'MANAGER', ['loc_main']],
    ['cashier', 'CASHIER', ['loc_main']],
    ['accountant', 'ACCOUNTANT', undefined],
    ['keeper', 'STOCK_KEEPER', ['loc_main']],
    ['driver', 'DRIVER', ['loc_main']],
    ['helper', 'HELPER', ['loc_main']],
    ['tech', 'TECH_OPERATOR', undefined],
  ] as const)
    await addPerson(db, {
      id,
      role,
      phone: `+91${++phone}`,
      ...(shops ? { shops: [...shops] } : {}),
    });
  await addPerson(db, { id: 'customer', phone: `+91${++phone}` });
  companyId = await makeCompany();
});
afterAll(async () => {
  await app?.close();
});

describe('who may see what', () => {
  it.each(ALLOWED)('%s sees parties, numbers and differences', async (who) => {
    await ledger('l1', 'Asha', -100n);
    await get(who, 'parties').expect(200);
    await get(who, 'differences').expect(200);
    await get(who, 'customers/customer/numbers').expect(200);
  });
  it.each(NOT_ALLOWED)('%s sees no Tally number anywhere', async (who) => {
    const row = await ledger('l1', 'Asha', -100n);
    await get(who, 'parties').expect(403);
    await get(who, 'differences').expect(403);
    await get(who, 'customers/customer/numbers').expect(403);
    await link(who, row.id, { userId: 'customer' }).expect(403);
    await post(who, `parties/${row.id}/unlink`).expect(403);
    await post(who, `parties/${row.id}/not-customer`).expect(403);
    await post(who, 'matches', { items: [{ entryId: 'x', voucherId: 'y' }] }).expect(403);
    await post(who, 'matches/x/undo').expect(403);
  });
  it('nobody signed in sees anything', async () => {
    await request(server).get('/api/v1/admin/tally/parties').expect(401);
    await request(server).get('/api/v1/admin/tally/customers/customer/numbers').expect(401);
    await request(server).post('/api/v1/admin/tally/matches').send({}).expect(401);
  });
  it('someone paused loses it on their next request', async () => {
    await get('accountant', 'parties').expect(200);
    await db.user.update({ where: { id: 'accountant' }, data: { staffPausedAt: new Date() } });
    await get('accountant', 'parties').expect(403);
  });
  it('a customer never hears the word: their own account says nothing of Tally', async () => {
    const row = await ledger('l1', 'Asha', -123456n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const me = await request(server).get('/api/v1/me').set(as('customer')).expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(/tally|123456/i);
  });
  it('a manager’s customer page carries no Tally number', async () => {
    const row = await ledger('l1', 'Asha', -123456n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const page = await request(server)
      .get('/api/v1/admin/customers/customer/khata')
      .set(as('manager'))
      .expect(200);
    expect(JSON.stringify(page.body)).not.toMatch(/tally|123456/i);
  });
});

describe('the Parties list', () => {
  it('biggest balance first, whichever side it is on, with its time', async () => {
    await ledger('small', 'Small', -100n);
    await ledger('big', 'Big', -900000n);
    await ledger('mid', 'Mid', 50000n);
    const { body } = await get('accountant', 'parties').expect(200);
    expect(body.items.map((row: { name: string }) => row.name)).toEqual(['Big', 'Mid', 'Small']);
    expect(body.items[0].closingPaise).toBe('-900000');
    expect(body.items[0].asOf).toBeTruthy();
    expect(typeof body.items[0].closingPaise).toBe('string');
  });
  it('money past what the khata can hold comes through exactly, as text', async () => {
    await ledger('huge', 'Supplier', 90071992547409931n, { className: 'CREDITOR' });
    const { body } = await get('owner', 'parties?class=CREDITOR').expect(200);
    expect(body.items[0].closingPaise).toBe('90071992547409931');
  });
  it('progress is counted in money', async () => {
    const big = await ledger('big', 'Big', -800000n);
    await ledger('small', 'Small', -200000n);
    await link('owner', big.id, { userId: 'customer' }).expect(201);
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.progress).toEqual({
      linkedPaise: '800000',
      totalPaise: '1000000',
      linkedParties: 1,
      totalParties: 2,
    });
  });
  it('filters by what is left to do', async () => {
    const one = await ledger('a', 'One', -3n);
    const two = await ledger('b', 'Two', -2n);
    await ledger('c', 'Three', -1n);
    await link('owner', one.id, { userId: 'customer' }).expect(201);
    await post('owner', `parties/${two.id}/not-customer`).expect(201);
    const names = async (filter: string) =>
      (await get('owner', `parties?filter=${filter}`).expect(200)).body.items.map(
        (row: { name: string }) => row.name,
      );
    expect(await names('linked')).toEqual(['One']);
    expect(await names('notCustomer')).toEqual(['Two']);
    expect(await names('unlinked')).toEqual(['Three']);
    expect(await names('all')).toEqual(['One', 'Two', 'Three']);
  });
  it('searches by name, safely', async () => {
    await ledger('a', 'Asha Traders', -3n);
    await ledger('b', 'राम सीमेंट', -2n);
    const names = async (q: string) =>
      (await get('owner', `parties?q=${encodeURIComponent(q)}`).expect(200)).body.items.map(
        (row: { name: string }) => row.name,
      );
    expect(await names('asha')).toEqual(['Asha Traders']);
    expect(await names('राम')).toEqual(['राम सीमेंट']);
    expect(await names("' OR 1=1 --")).toEqual([]);
  });
  it('pages through', async () => {
    for (let index = 0; index < 5; index++)
      await ledger(`p${index}`, `P${index}`, BigInt(-(index + 1)));
    const first = (await get('owner', 'parties?limit=2').expect(200)).body;
    expect(first.items).toHaveLength(2);
    expect(first.nextSkip).toBe(2);
    const last = (await get('owner', 'parties?limit=2&skip=4').expect(200)).body;
    expect(last.items).toHaveLength(1);
    expect(last.nextSkip).toBeNull();
  });
  it('a tampered address bar gets a page, not a server error', async () => {
    await ledger('a', 'Asha', -3n);
    for (const query of [
      'limit=2.5',
      'limit=1e400',
      'skip=1e400',
      'skip=-5',
      'limit=abc&skip=xyz',
      'q=a&q=b',
      'filter=a&filter=b',
      'filter=nonsense',
      'class=a&class=b',
      'companyId=x&companyId=y',
      'skip=99999999999999999999',
      'limit=0',
    ]) {
      const { status } = await get('owner', `parties?${query}`);
      expect(status, query).toBe(200);
      expect((await get('owner', `differences?${query}`)).status, query).toBe(200);
    }
  });
  it('companies set aside stay out of it', async () => {
    const copy = await makeCompany({ guid: randomUUID(), role: 'BRANCH_COPY' });
    await ledger('c1', 'Copy Party', -500n, { company: copy });
    await ledger('l1', 'Real Party', -500n);
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.items.map((row: { name: string }) => row.name)).toEqual(['Real Party']);
  });
  it('a soft-deleted party is gone from the list', async () => {
    const row = await ledger('l1', 'Gone', -500n);
    await db.tallyLedger.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    expect((await get('owner', 'parties').expect(200)).body.items).toEqual([]);
  });
});

describe('suggestions, which only ever suggest', () => {
  it('finds by phone first', async () => {
    await customer('asha', 'Somebody Else', { phone: '+919812345678' });
    await ledger('l1', 'Asha Traders', -100n, { phones: ['+919812345678'] });
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.items[0].suggestions[0]).toMatchObject({ userId: 'asha', by: 'PHONE', score: 100 });
  });
  it('finds by GSTIN on a quote', async () => {
    await customer('firm', 'Other Name');
    await db.quote.create({
      data: {
        number: 'QT-TALLY-1',
        userId: 'firm',
        address: {},
        deliveryDate: today,
        company: 'Firm',
        gstin: '10ABCDE1234F1Z5',
        notes: '',
      },
    });
    await ledger('l1', 'Firm Traders', -100n, { gstin: '10ABCDE1234F1Z5' });
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.items[0].suggestions[0]).toMatchObject({ userId: 'firm', by: 'GSTIN', score: 95 });
  });
  it('finds by a name that looks alike, at most three', async () => {
    for (const [id, name] of [
      ['a1', 'Asha Traders'],
      ['a2', 'Asha Trader'],
      ['a3', 'Asha Trading'],
      ['a4', 'Asha T'],
      ['zz', 'Nothing Alike'],
    ])
      await customer(id!, name);
    await ledger('l1', 'ASHA TRADERS', -100n);
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.items[0].suggestions).toHaveLength(3);
    expect(body.items[0].suggestions[0]).toMatchObject({ userId: 'a1', by: 'NAME' });
    expect(body.items[0].suggestions.map((row: { userId: string }) => row.userId)).not.toContain(
      'zz',
    );
  });
  it('never suggests staff, a deleted account, or the walk-in', async () => {
    await customer('gone', 'Asha Traders', { deletedAt: new Date() });
    await customer('walkin', 'Asha Traders', { phone: 'walk-in:store' });
    await db.user.update({ where: { id: 'manager' }, data: { name: 'Asha Traders' } });
    await ledger('l1', 'Asha Traders', -100n);
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.items[0].suggestions).toEqual([]);
  });
  it('a suggestion links nothing by itself', async () => {
    await customer('asha', 'Asha Traders');
    await ledger('l1', 'Asha Traders', -100n);
    await get('owner', 'parties').expect(200);
    expect(await db.tallyPartyLink.count()).toBe(0);
  });
  it('a linked party has no suggestions', async () => {
    await customer('asha', 'Asha Traders');
    const row = await ledger('l1', 'Asha Traders', -100n);
    await link('owner', row.id, { userId: 'asha' }).expect(201);
    const { body } = await get('owner', 'parties').expect(200);
    expect(body.items[0].suggestions).toEqual([]);
    expect(body.items[0].customer.id).toBe('asha');
  });
});

describe('linking, by a person', () => {
  it.each(ALLOWED)('%s links a party, and the log says who', async (who) => {
    const row = await ledger('l1', 'Asha', -100n);
    const { body } = await link(who, row.id, {
      userId: 'customer',
      method: 'PHONE',
      score: 100,
    }).expect(201);
    expect(body).toMatchObject({ status: 'LINKED', userId: 'customer' });
    const saved = await db.tallyPartyLink.findFirstOrThrow();
    expect(saved).toMatchObject({
      userId: 'customer',
      confirmedById: who,
      method: 'PHONE',
      score: 100,
    });
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'TALLY_PARTY_LINKED' } });
    expect(log.actorId).toBe(who);
    expect(log.details).toMatchObject({ userId: 'customer', guid: 'l1', method: 'PHONE' });
    expect(JSON.stringify(log.details)).not.toContain('Asha');
  });
  it('linking twice to the same person is one link and one log line', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const again = await link('owner', row.id, { userId: 'customer' }).expect(201);
    expect(again.body.repeat).toBe(true);
    expect(await db.auditLog.count({ where: { event: 'TALLY_PARTY_LINKED' } })).toBe(1);
  });
  it('one ledger belongs to one account: undo first, so the log tells the story', async () => {
    await customer('other');
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const { body } = await link('owner', row.id, { userId: 'other' }).expect(409);
    expect(body.error.code).toBe('TALLY_LINK_TAKEN');
    expect((await db.tallyPartyLink.findFirstOrThrow()).userId).toBe('customer');
  });
  it('one account may hold many ledgers', async () => {
    const one = await ledger('l1', 'Asha Site 1', -100n);
    const two = await ledger('l2', 'Asha Site 2', -200n);
    await link('owner', one.id, { userId: 'customer' }).expect(201);
    await link('owner', two.id, { userId: 'customer' }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.tally.closingPaise).toBe('-300');
    expect(body.parties).toHaveLength(2);
  });
  it('two racing links: exactly one wins', async () => {
    await customer('other');
    const row = await ledger('l1', 'Asha', -100n);
    const results = await Promise.all([
      link('owner', row.id, { userId: 'customer' }),
      link('accountant', row.id, { userId: 'other' }),
    ]);
    expect(results.filter((res) => res.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(await db.tallyPartyLink.count()).toBe(1);
    const saved = await db.tallyPartyLink.findFirstOrThrow();
    expect(['customer', 'other']).toContain(saved.userId);
  });
  it('typing a phone finds an account, or makes one', async () => {
    const row = await ledger('l1', 'New Party', -100n);
    const { body } = await link('owner', row.id, {
      phone: '+919811112222',
      name: 'New Party',
    }).expect(201);
    const made = await db.user.findUniqueOrThrow({ where: { phone: '+919811112222' } });
    expect(made).toMatchObject({ id: body.userId, role: 'CUSTOMER', name: 'New Party' });
  });
  it('a typed name loses any hidden characters', async () => {
    const row = await ledger('l1', 'New Party', -100n);
    await link('owner', row.id, { phone: '+919811112299', name: 'Ev\u202Eil\u0000 Name' }).expect(
      201,
    );
    expect((await db.user.findUniqueOrThrow({ where: { phone: '+919811112299' } })).name).toBe(
      'Evil Name',
    );
  });
  it('typing a phone of someone there already does not change them', async () => {
    await customer('asha', 'Asha Real Name', { phone: '+919811112223' });
    const row = await ledger('l1', 'Ledger Name', -100n);
    const { body } = await link('owner', row.id, {
      phone: '+919811112223',
      name: 'Overwrite',
    }).expect(201);
    expect(body.userId).toBe('asha');
    expect((await db.user.findUniqueOrThrow({ where: { id: 'asha' } })).name).toBe(
      'Asha Real Name',
    );
  });
  it.each(['manager', 'owner', 'tech'])(
    'a staff account (%s) cannot be linked as a customer',
    async (id) => {
      const row = await ledger('l1', 'Asha', -100n);
      const { body } = await link('owner', row.id, { userId: id }).expect(400);
      expect(body.error.code).toBe('TALLY_NOT_CUSTOMER');
    },
  );
  it('a staff member’s phone cannot be typed either', async () => {
    const staff = await db.user.findUniqueOrThrow({ where: { id: 'manager' } });
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { phone: staff.phone }).expect(400);
  });
  it('a deleted customer, a made-up one, and the walk-in cannot be linked', async () => {
    await customer('gone', 'Gone', { deletedAt: new Date() });
    await customer('walkin', 'Counter', { phone: 'walk-in:store' });
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'gone' }).expect(400);
    await link('owner', row.id, { userId: 'walkin' }).expect(400);
    await link('owner', row.id, { userId: 'nope' }).expect(400);
  });
  it('a party Tally no longer has cannot be linked', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await db.tallyLedger.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    const { body } = await link('owner', row.id, { userId: 'customer' }).expect(409);
    expect(body.error.code).toBe('TALLY_LEDGER_GONE');
  });
  it('a bad body or a made-up party is refused', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, {}).expect(400);
    await link('owner', row.id, { userId: 'a', phone: '+919811112222' }).expect(400);
    await link('owner', row.id, { phone: '12345' }).expect(400);
    await link('owner', 'nope', { userId: 'customer' }).expect(404);
  });
});

describe('undoing, and surviving a rename', () => {
  it.each(ALLOWED)(
    '%s can undo a wrong link, and the log shows who and what it was',
    async (who) => {
      const row = await ledger('l1', 'Asha', -100n);
      await link('owner', row.id, { userId: 'customer' }).expect(201);
      await post(who, `parties/${row.id}/unlink`).expect(201);
      expect(await db.tallyPartyLink.findFirstOrThrow()).toMatchObject({
        status: 'UNLINKED',
        userId: null,
      });
      const log = await db.auditLog.findFirstOrThrow({ where: { event: 'TALLY_PARTY_UNLINKED' } });
      expect(log.actorId).toBe(who);
      expect(log.details).toMatchObject({ wasUserId: 'customer', wasStatus: 'LINKED' });
      expect((await get('owner', 'customers/customer/numbers').expect(200)).body.state).toBe(
        'NOT_LINKED',
      );
    },
  );
  it('undoing twice is harmless, and an undone party can be linked again', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await post('owner', `parties/${row.id}/unlink`).expect(201);
    const again = await post('owner', `parties/${row.id}/unlink`).expect(201);
    expect(again.body.repeat).toBe(true);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    expect((await db.tallyPartyLink.findFirstOrThrow()).status).toBe('LINKED');
  });
  it('undoing takes their line off the Farq list at once', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await recon.runDue();
    expect((await get('owner', 'differences').expect(200)).body.items).toHaveLength(1);
    await post('owner', `parties/${row.id}/unlink`).expect(201);
    expect((await get('owner', 'differences').expect(200)).body.items).toHaveLength(0);
  });
  it('“Grahak nahi” takes it off the list, and needs an undo before linking', async () => {
    const row = await ledger('l1', 'Cash Sales', -100n);
    await post('owner', `parties/${row.id}/not-customer`).expect(201);
    expect(await db.tallyPartyLink.findFirstOrThrow()).toMatchObject({
      status: 'NOT_CUSTOMER',
      userId: null,
    });
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await post('owner', `parties/${row.id}/not-customer`).expect(409);
  });
  it('a ledger renamed in Tally keeps its link: it keys on the guid', async () => {
    const row = await ledger('l1', 'Old Name', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await db.tallyLedger.update({ where: { id: row.id }, data: { name: 'New Name' } });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.parties[0].name).toBe('New Name');
  });
  it('a customer who deletes their account is detached, and the books stay', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await request(server)
      .post('/api/v1/me/delete')
      .set(as('customer'))
      .send({ confirmation: 'DELETE' })
      .expect(201);
    expect(await db.tallyPartyLink.findFirstOrThrow()).toMatchObject({
      status: 'UNLINKED',
      userId: null,
    });
    expect(await db.tallyLedger.count({ where: { deletedAt: null } })).toBe(1);
    await get('owner', 'customers/customer/numbers').expect(404);
  });
  it('a link to a customer whose account is gone answers plainly', async () => {
    await get('owner', 'customers/nope/numbers').expect(404);
    await get('owner', 'customers/manager/numbers').expect(404);
  });
  it('the customer search finds linked Tally names, only for those who may see Tally', async () => {
    await customer('asha', 'Asha Devi');
    const row = await ledger('l1', 'Zebra Hardware Mart', -100n);
    await link('owner', row.id, { userId: 'asha' }).expect(201);
    const search = (who: string) =>
      request(server).get('/api/v1/admin/customers?q=Zebra').set(as(who)).expect(200);
    expect((await search('accountant')).body.items.map((item: { id: string }) => item.id)).toEqual([
      'asha',
    ]);
    expect((await search('owner')).body.items.map((item: { id: string }) => item.id)).toEqual([
      'asha',
    ]);
    expect((await search('manager')).body.items).toEqual([]);
    expect((await search('cashier')).body.items).toEqual([]);
  });
});

describe('both numbers, for one customer', () => {
  const week = dayShift(today, -30);
  /** The customer's khata, Tally's closing, and every line between them must add up exactly. */
  const addsUp = (body: {
    khataPaise: number;
    tally: { closingPaise: string; differencePaise: string; unexplainedPaise: string };
    lines: { amountPaise: string }[];
  }) => {
    const difference = BigInt(body.khataPaise) + BigInt(body.tally.closingPaise);
    expect(body.tally.differencePaise).toBe(String(difference));
    const named = body.lines.reduce((sum, line) => sum + BigInt(line.amountPaise), 0n);
    expect(String(named + BigInt(body.tally.unexplainedPaise))).toBe(body.tally.differencePaise);
  };
  async function linked(name = 'Asha', closing = 0n, baseline = 0n) {
    const row = await ledger('l1', name, closing, { baseline });
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    return row;
  }
  it('not linked yet: khata alone, with nothing from Tally', async () => {
    await entry('customer', 5000, week);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body).toMatchObject({ state: 'NOT_LINKED', khataPaise: 5000, tally: null });
  });
  it('the same in both books: no difference, and no lines', async () => {
    const row = await linked('Asha', -100000n);
    await entry('customer', 100000, dayShift(today, -20));
    const order = await voucher(row, 'v1', -100000n, dayShift(today, -20));
    await post('owner', 'matches', {
      items: [
        { entryId: (await db.customerLedgerEntry.findFirstOrThrow()).id, voucherId: order.id },
      ],
    }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.state).toBe('READY');
    expect(body.tally).toMatchObject({
      differencePaise: '0',
      unexplainedPaise: '0',
      tieOut: 'OK',
      stale: false,
    });
    expect(body.tally.closingPaise).toBe('-100000');
    expect(body.tally.appEquivalentPaise).toBe('100000');
    expect(body.lines).toEqual([]);
    expect(new Date(body.tally.asOf).getTime()).toBeGreaterThan(Date.now() - 60000);
  });
  it('an app entry under a week old is timing', async () => {
    await linked();
    const row = await entry('customer', 5000, dayShift(today, -1));
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toMatchObject([{ reason: 'TIMING', amountPaise: '5000', entryId: row.id }]);
    expect(body.tally.unexplainedPaise).toBe('0');
    addsUp(body);
  });
  it('an app entry a week old or more is app-only', async () => {
    await linked();
    await entry('customer', 5000, dayShift(today, -8));
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines[0].reason).toBe('APP_ONLY');
    addsUp(body);
  });
  it('a voucher with no match is Tally-only', async () => {
    const row = await linked('Asha', -7000n);
    const made = await voucher(row, 'v1', -7000n, dayShift(today, -2));
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toMatchObject([
      { reason: 'TALLY_ONLY', amountPaise: '-7000', voucherId: made.id, label: 'V1' },
    ]);
    expect(body.tally.differencePaise).toBe('-7000');
    addsUp(body);
  });
  it('an order number on a bill matches by itself, and needs no person', async () => {
    const row = await linked('Asha', -100000n);
    const order = await db.order.create({
      data: {
        number: 'SC-2026-ABCD1234',
        userId: 'customer',
        idempotencyKey: randomUUID(),
        status: 'DELIVERED',
        source: 'PHONE',
        address: {},
        deliveryDate: today,
        notes: '',
        subtotalPaise: 100000,
        deliveryFeePaise: 0,
        totalPaise: 100000,
      },
    });
    await entry('customer', 100000, dayShift(today, -1), {
      orderId: order.id,
      kind: 'SALE_ON_CREDIT',
    });
    await voucher(row, 'v1', -100000n, dayShift(today, -1), { orderRef: 'SC-2026-ABCD1234' });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toEqual([]);
    expect(body.tally.differencePaise).toBe('0');
    expect(await db.khataVoucherMatch.count()).toBe(0);
    addsUp(body);
  });
  it('matched with a different amount: the gap is named', async () => {
    const row = await linked('Asha', -95000n);
    const app = await entry('customer', 100000, dayShift(today, -3));
    const bill = await voucher(row, 'v1', -95000n, dayShift(today, -3));
    await post('accountant', 'matches', {
      items: [{ entryId: app.id, voucherId: bill.id }],
    }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toMatchObject([
      { reason: 'AMOUNT', amountPaise: '5000', voucherId: bill.id },
    ]);
    expect(body.lines[0].note).toBeUndefined();
    addsUp(body);
  });
  it('within a rupee is marked as round-off', async () => {
    const row = await linked('Asha', -99950n);
    const app = await entry('customer', 100000, dayShift(today, -3));
    const bill = await voucher(row, 'v1', -99950n, dayShift(today, -3));
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: bill.id }] }).expect(
      201,
    );
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines[0]).toMatchObject({
      reason: 'AMOUNT',
      amountPaise: '50',
      note: 'WITHIN_TOLERANCE',
    });
  });
  it('a bill for several entries is one match each, and adds up', async () => {
    const row = await linked('Asha', -30000n);
    const one = await entry('customer', 10000, dayShift(today, -3));
    const two = await entry('customer', 20000, dayShift(today, -3));
    const bill = await voucher(row, 'v1', -30000n, dayShift(today, -2));
    await post('owner', 'matches', {
      items: [
        { entryId: one.id, voucherId: bill.id },
        { entryId: two.id, voucherId: bill.id },
      ],
    }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toEqual([]);
    addsUp(body);
  });
  it('the gap before our copy starts is the opening, and it is flagged as not agreed yet', async () => {
    await linked('Asha', -50000n, -50000n);
    await entry('customer', 80000, '2026-03-01');
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toMatchObject([
      { reason: 'OPENING', amountPaise: '30000', on: COPY_FROM, note: 'NOT_AGREED_YET' },
    ]);
    expect(body.tally.unexplainedPaise).toBe('0');
    addsUp(body);
  });
  describe('with a signed opening after our copy starts', () => {
    const cutOff = dayShift(today, -30);
    const signed = async (chosenPaise: number) => {
      const row = chosenPaise
        ? await entry('customer', chosenPaise, cutOff, { kind: 'OPENING_BALANCE' })
        : null;
      await db.khataSignoff.create({
        data: {
          customerId: 'customer',
          firmId: 'firm_main',
          locationId: 'loc_main',
          asOf: cutOff,
          chosenPaise,
          enteredById: 'accountant',
          approvedById: 'owner',
          ledgerEntryId: row?.id ?? null,
          requestHash: 'test',
        },
      });
      return row;
    };
    it('Tally’s bills from before it are one line, and it agrees when the two books agree', async () => {
      const row = await linked('Asha', -80000n);
      await voucher(row, 'old1', -50000n, dayShift(cutOff, -60));
      await voucher(row, 'old2', -30000n, dayShift(cutOff, -10));
      await signed(80000);
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.lines).toEqual([]);
      expect(body.tally.differencePaise).toBe('0');
      addsUp(body);
    });
    it('a gap at the cut-off is one signed line, never one line per old bill', async () => {
      const row = await linked('Asha', -80000n);
      await voucher(row, 'old1', -50000n, dayShift(cutOff, -60));
      await voucher(row, 'old2', -30000n, dayShift(cutOff, -10));
      await signed(90000);
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.lines).toMatchObject([
        { reason: 'OPENING', amountPaise: '10000', on: cutOff, note: 'SIGNED' },
      ]);
      expect(body.tally.unexplainedPaise).toBe('0');
      addsUp(body);
    });
    it('a signed ₹0 opening has no entry, and still rolls the old bills up', async () => {
      const row = await linked('Asha', -20000n);
      await voucher(row, 'old', -20000n, dayShift(cutOff, -5));
      await signed(0);
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.lines).toMatchObject([
        { reason: 'OPENING', amountPaise: '-20000', on: cutOff, note: 'SIGNED' },
      ]);
      addsUp(body);
    });
    it('anything after it is still chased, line by line', async () => {
      const row = await linked('Asha', -95000n);
      await voucher(row, 'old', -80000n, dayShift(cutOff, -5));
      await signed(80000);
      await voucher(row, 'new', -15000n, dayShift(today, -20));
      const fresh = await entry('customer', 2000, dayShift(today, -1));
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.lines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'TALLY_ONLY', amountPaise: '-15000' }),
          expect.objectContaining({ reason: 'TIMING', amountPaise: '2000', entryId: fresh.id }),
        ]),
      );
      expect(body.lines).toHaveLength(2);
      addsUp(body);
    });
    it('a bill from before it, matched to a later entry, stays on its own and adds up', async () => {
      const row = await linked('Asha', -50000n);
      const bill = await voucher(row, 'edge', -50000n, dayShift(cutOff, -1));
      const later = await entry('customer', 50000, dayShift(today, -20));
      await signed(0);
      await post('owner', 'matches', { items: [{ entryId: later.id, voucherId: bill.id }] }).expect(
        201,
      );
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.lines).toEqual([]);
      addsUp(body);
    });
    it('a signed opening before our copy starts changes nothing about the copy', async () => {
      const row = await linked('Asha', -10000n, -40000n);
      await db.customerLedgerEntry.deleteMany({});
      await voucher(row, 'v', 30000n, dayShift(today, -20));
      const old = await entry('customer', 40000, '2026-03-01', { kind: 'OPENING_BALANCE' });
      await db.khataSignoff.create({
        data: {
          customerId: 'customer',
          firmId: 'firm_main',
          locationId: 'loc_main',
          asOf: '2026-03-01',
          chosenPaise: 40000,
          enteredById: 'accountant',
          approvedById: 'owner',
          ledgerEntryId: old.id,
          requestHash: 'test',
        },
      });
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.lines).toMatchObject([{ reason: 'TALLY_ONLY', amountPaise: '30000' }]);
      addsUp(body);
    });
  });
  it('an entry and its reversal cancel out, with nothing to chase', async () => {
    await linked();
    const sale = await entry('customer', 5000, dayShift(today, -2));
    await entry('customer', -5000, dayShift(today, -2), { reversesId: sale.id, kind: 'REVERSAL' });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toEqual([]);
    expect(body.tally.differencePaise).toBe('0');
  });
  it('a reversal of something before our copy still adds up', async () => {
    await linked();
    const old = await entry('customer', 5000, '2026-02-01');
    await entry('customer', -5000, dayShift(today, -2), { reversesId: old.id, kind: 'REVERSAL' });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    addsUp(body);
    expect(body.tally.unexplainedPaise).toBe('0');
  });
  it('a gap in the mirror itself is what stays unexplained', async () => {
    const row = await ledger('l1', 'Asha', -9000n);
    await db.tallyLedger.update({
      where: { id: row.id },
      data: { tieOutOk: false, tieOutGapPaise: -2000n },
    });
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await voucher(row, 'v1', -7000n, dayShift(today, -1));
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.tally.unexplainedPaise).toBe('-2000');
    expect(body.tally.tieOut).toBe('FAILED');
    addsUp(body);
  });
  it('a same-amount neighbour is a suggestion, and both stay on the list until a person accepts', async () => {
    const row = await linked('Asha', -5000n);
    const app = await entry('customer', 5000, dayShift(today, -1));
    const bill = await voucher(row, 'v1', -5000n, dayShift(today, -2));
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.suggestions).toEqual([
      { entryId: app.id, voucherId: bill.id, amountPaise: '5000' },
    ]);
    expect(body.lines.map((line: { reason: string }) => line.reason).sort()).toEqual([
      'TALLY_ONLY',
      'TIMING',
    ]);
    expect(await db.khataVoucherMatch.count()).toBe(0);
    addsUp(body);
  });
  it('two candidates means no suggestion: that is a person’s call', async () => {
    const row = await linked('Asha', -10000n);
    await entry('customer', 5000, dayShift(today, -1));
    await voucher(row, 'v1', -5000n, dayShift(today, -1));
    await voucher(row, 'v2', -5000n, dayShift(today, -2));
    expect((await get('owner', 'customers/customer/numbers').expect(200)).body.suggestions).toEqual(
      [],
    );
  });
  it('an optional, cancelled or deleted voucher is not in the books, so not in the sums', async () => {
    const row = await linked('Asha', 0n);
    await voucher(row, 'v1', -5000n, dayShift(today, -1), { isOptional: true });
    await voucher(row, 'v2', -6000n, dayShift(today, -1), { isCancelled: true });
    await voucher(row, 'v3', -7000n, dayShift(today, -1), { deletedAt: new Date() });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toEqual([]);
  });
  it('a change to a matched voucher is shown as a fact, adding nothing to the sum', async () => {
    const row = await linked('Asha', -6000n);
    const app = await entry('customer', 5000, dayShift(today, -3));
    const bill = await voucher(row, 'v1', -6000n, dayShift(today, -3));
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: bill.id }] }).expect(
      201,
    );
    await db.tallyVoucherChange.create({
      data: {
        companyId,
        voucherId: bill.id,
        kind: 'ALTERED',
        oldAmountPaise: -5000n,
        newAmountPaise: -6000n,
        oldAlterId: 1n,
        newAlterId: 2n,
      },
    });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.changes).toMatchObject([
      { reason: 'CHANGED', kind: 'ALTERED', oldAmountPaise: '-5000', newAmountPaise: '-6000' },
    ]);
    expect(body.lines).toMatchObject([{ reason: 'AMOUNT', amountPaise: '-1000' }]);
    addsUp(body);
  });
  it('a deleted voucher a person matched goes back to being the app’s alone, with the fact beside it', async () => {
    const row = await linked('Asha', 0n);
    const app = await entry('customer', 5000, dayShift(today, -9));
    const bill = await voucher(row, 'v1', -5000n, dayShift(today, -9));
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: bill.id }] }).expect(
      201,
    );
    await db.tallyVoucher.update({ where: { id: bill.id }, data: { deletedAt: new Date() } });
    await db.tallyVoucherChange.create({
      data: { companyId, voucherId: bill.id, kind: 'DELETED', oldAmountPaise: -5000n },
    });
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.lines).toMatchObject([{ reason: 'APP_ONLY', amountPaise: '5000' }]);
    expect(body.changes).toMatchObject([{ kind: 'DELETED' }]);
    addsUp(body);
  });
  it('a sync copy or an ignored file never reaches a total', async () => {
    const copy = await makeCompany({ guid: randomUUID(), role: 'BRANCH_COPY' });
    const row = await ledger('c1', 'Asha Copy', -999n, { company: copy });
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.state).toBe('NOT_LINKED');
  });
  it('while the copy is still being made the difference is held back', async () => {
    await db.tallyCompany.update({ where: { id: companyId }, data: { phase: 'BACKFILL' } });
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.state).toBe('COPYING');
    expect(body.lines).toEqual([]);
  });
  it('an old number says it is old', async () => {
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { freshAt: new Date(Date.now() - 3 * 86400000) },
    });
    await linked('Asha', -100n);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.tally.stale).toBe(true);
  });
  it('the party that failed the proof says so', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await db.tallyLedger.update({
      where: { id: row.id },
      data: { tieOutOk: false, tieOutGapPaise: -1n },
    });
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.tally.tieOut).toBe('FAILED');
    expect(body.parties[0]).toMatchObject({ tieOutOk: false, tieOutGapPaise: '-1' });
  });
  it('neither book is ever changed by looking at them', async () => {
    const row = await linked('Asha', -7000n);
    await entry('customer', 5000, dayShift(today, -1));
    await voucher(row, 'v1', -7000n, dayShift(today, -1));
    const before = await db.user.findUniqueOrThrow({ where: { id: 'customer' } });
    const entries = await db.customerLedgerEntry.count();
    await get('owner', 'customers/customer/numbers').expect(200);
    await recon.runDue();
    expect((await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).khataBalancePaise).toBe(
      before.khataBalancePaise,
    );
    expect(await db.customerLedgerEntry.count()).toBe(entries);
    expect((await db.tallyLedger.findFirstOrThrow()).closingPaise).toBe(-7000n);
  });
});

describe('matching an entry to a voucher', () => {
  async function pair_() {
    const row = await ledger('l1', 'Asha', -5000n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const app = await entry('customer', 5000, dayShift(today, -1));
    const bill = await voucher(row, 'v1', -5000n, dayShift(today, -1));
    return { app, bill };
  }
  it('is logged, can be undone, and undoing is a new row, never an edit', async () => {
    const { app, bill } = await pair_();
    const made = await post('accountant', 'matches', {
      items: [{ entryId: app.id, voucherId: bill.id }],
    }).expect(201);
    expect(
      await db.auditLog.count({ where: { event: 'TALLY_MATCH_MADE', actorId: 'accountant' } }),
    ).toBe(1);
    expect((await get('owner', 'customers/customer/numbers').expect(200)).body.lines).toEqual([]);
    await post('owner', `matches/${made.body.ids[0]}/undo`).expect(201);
    expect(await db.khataVoucherMatch.count()).toBe(2);
    const lines = (await get('owner', 'customers/customer/numbers').expect(200)).body.lines;
    expect(lines.map((line: { reason: string }) => line.reason).sort()).toEqual([
      'TALLY_ONLY',
      'TIMING',
    ]);
  });
  it('the log cannot be edited or deleted', async () => {
    const { app, bill } = await pair_();
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: bill.id }] }).expect(
      201,
    );
    const row = await db.khataVoucherMatch.findFirstOrThrow();
    await expect(
      db.khataVoucherMatch.update({ where: { id: row.id }, data: { method: 'X' } }),
    ).rejects.toThrow();
    await expect(db.khataVoucherMatch.delete({ where: { id: row.id } })).rejects.toThrow();
  });
  it('the same match twice is one row', async () => {
    const { app, bill } = await pair_();
    const body = { items: [{ entryId: app.id, voucherId: bill.id }] };
    await post('owner', 'matches', body).expect(201);
    await post('owner', 'matches', body).expect(201);
    expect(await db.khataVoucherMatch.count()).toBe(1);
  });
  it('undoing twice is one undo', async () => {
    const { app, bill } = await pair_();
    const made = await post('owner', 'matches', {
      items: [{ entryId: app.id, voucherId: bill.id }],
    }).expect(201);
    await post('owner', `matches/${made.body.ids[0]}/undo`).expect(201);
    await post('owner', `matches/${made.body.ids[0]}/undo`).expect(201);
    expect(await db.khataVoucherMatch.count()).toBe(2);
  });
  it('another customer’s voucher cannot explain this khata', async () => {
    const { app } = await pair_();
    await customer('other');
    const theirs = await ledger('l2', 'Other', -5000n);
    await link('owner', theirs.id, { userId: 'other' }).expect(201);
    const bill = await voucher(theirs, 'v2', -5000n, today);
    const { body } = await post('owner', 'matches', {
      items: [{ entryId: app.id, voucherId: bill.id }],
    }).expect(400);
    expect(body.error.code).toBe('TALLY_MATCH_BAD');
  });
  it('a voucher on an unlinked party cannot either', async () => {
    const { app } = await pair_();
    const theirs = await ledger('l2', 'Other', -5000n);
    const bill = await voucher(theirs, 'v2', -5000n, today);
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: bill.id }] }).expect(
      400,
    );
  });
  it('an entry already matched must be undone first', async () => {
    const { app, bill } = await pair_();
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: bill.id }] }).expect(
      201,
    );
    const row = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'l1' } });
    const other = await voucher(row, 'v9', -5000n, today);
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: other.id }] }).expect(
      409,
    );
  });
  it('made-up ids and deleted vouchers are refused, and a bad item stops the whole batch', async () => {
    const { app, bill } = await pair_();
    await post('owner', 'matches', { items: [{ entryId: 'nope', voucherId: bill.id }] }).expect(
      400,
    );
    await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: 'nope' }] }).expect(400);
    await post('owner', 'matches', { items: [] }).expect(400);
    const good = { entryId: app.id, voucherId: bill.id };
    await post('owner', 'matches', {
      items: [good, { entryId: 'nope', voucherId: bill.id }],
    }).expect(400);
    expect(await db.khataVoucherMatch.count()).toBe(0);
    await post('owner', 'matches/nope/undo').expect(404);
  });
  it('a batch is capped', async () => {
    const item = { entryId: 'a', voucherId: 'b' };
    await post('owner', 'matches', { items: Array.from({ length: 101 }, () => item) }).expect(400);
  });
});

describe('the Farq list', () => {
  it('biggest unexplained first, then biggest difference, with no zero rows', async () => {
    for (const [id, closing, gap] of [
      ['clean', 0n, 0n],
      ['bigdiff', -900000n, 0n],
      ['gappy', -100n, -100n],
    ] as const) {
      await customer(id);
      const row = await ledger(`g-${id}`, id, closing);
      if (gap)
        await db.tallyLedger.update({
          where: { id: row.id },
          data: { tieOutOk: false, tieOutGapPaise: gap },
        });
      await link('owner', row.id, { userId: id }).expect(201);
      if (closing && !gap) await voucher(row, `v-${id}`, closing, dayShift(today, -1));
    }
    await recon.runDue();
    const { body } = await get('accountant', 'differences').expect(200);
    expect(body.items.map((row: { customerId: string }) => row.customerId)).toEqual([
      'gappy',
      'bigdiff',
    ]);
    expect(body.items[0]).toMatchObject({ unexplainedPaise: '-100', appPaise: 0 });
    expect(body.items[1].reasons).toEqual({ TALLY_ONLY: '-900000' });
    expect(body.items[1].tallyAsOf).toBeTruthy();
  });
  it('the worker’s pass happens once per change', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    expect(await recon.runDue()).toBe(1);
    expect(await recon.runDue()).toBe(0);
  });
  it('a deleted customer falls off', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await recon.runDue();
    await db.user.update({ where: { id: 'customer' }, data: { deletedAt: new Date() } });
    expect((await get('owner', 'differences').expect(200)).body.items).toEqual([]);
  });
});

describe('what the desk screens rely on', () => {
  it('while copying, the difference really is held back, not only its lines', async () => {
    await db.tallyCompany.update({ where: { id: companyId }, data: { phase: 'BACKFILL' } });
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    const { body } = await get('owner', 'customers/customer/numbers').expect(200);
    expect(body.state).toBe('COPYING');
    expect(body.tally.differencePaise).toBeNull();
    expect(body.tally.unexplainedPaise).toBeUndefined();
    // The number and its time still show, as plan 09's backfill row says.
    expect(body.tally.appEquivalentPaise).toBe('100');
  });
  it('nobody is on the Farq list until their copy is finished', async () => {
    await db.tallyCompany.update({ where: { id: companyId }, data: { phase: 'BACKFILL' } });
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await recon.runDue();
    expect((await get('owner', 'differences').expect(200)).body.items).toEqual([]);
    await db.tallyCompany.update({
      where: { id: companyId },
      data: { phase: 'LIVE', reconDue: true },
    });
    await recon.runDue();
    const { body } = await get('owner', 'differences').expect(200);
    expect(body.items.map((item: { customerId: string }) => item.customerId)).toEqual(['customer']);
    expect(body.items[0].differencePaise).toBe('-100');
  });
  it('a row from before a rewrite leaves the Farq list at once, and comes back after', async () => {
    const row = await ledger('l1', 'Asha', -100n);
    await link('owner', row.id, { userId: 'customer' }).expect(201);
    await recon.runDue();
    expect((await get('owner', 'differences').expect(200)).body.items).toHaveLength(1);
    await db.tallyCompany.update({ where: { id: companyId }, data: { phase: 'MASTERS' } });
    expect((await get('owner', 'differences').expect(200)).body.items).toEqual([]);
    await db.tallyCompany.update({ where: { id: companyId }, data: { phase: 'LIVE' } });
    expect((await get('owner', 'differences').expect(200)).body.items).toHaveLength(1);
  });
  it.each(['IGNORE', 'BRANCH_COPY'])(
    'a company set to %s leaves the Farq list at once, and the next pass clears its row',
    async (role) => {
      const row = await ledger('l1', 'Asha', -100n);
      await link('owner', row.id, { userId: 'customer' }).expect(201);
      await recon.runDue();
      expect((await get('owner', 'differences').expect(200)).body.items).toHaveLength(1);
      await post('owner', `companies/${companyId}`, { role }).expect(201);
      expect((await get('owner', 'differences').expect(200)).body.items).toEqual([]);
      expect(await recon.runDue()).toBe(1);
      expect(await db.khataRecon.count()).toBe(0);
    },
  );
  it('setting the same role again asks for no new sums', async () => {
    await db.tallyCompany.update({ where: { id: companyId }, data: { reconDue: false } });
    await post('owner', `companies/${companyId}`, { role: 'PRIMARY' }).expect(201);
    expect((await db.tallyCompany.findUniqueOrThrow({ where: { id: companyId } })).reconDue).toBe(
      false,
    );
  });
  it('the accountant gets a masked number, as on every other list. An owner gets the number', async () => {
    await customer('asha', 'Asha Traders', { phone: '+919812345678' });
    await customer('linked', 'Linked One', { phone: '+919812345679' });
    await ledger('s1', 'Asha Traders', -100n, { phones: ['+919812345678'] });
    const row = await ledger('s2', 'Linked Ledger', -500n);
    await link('owner', row.id, { userId: 'linked' }).expect(201);
    await recon.runDue();
    const seen = async (who: string) => {
      const parties = (await get(who, 'parties').expect(200)).body.items;
      const farq = (await get(who, 'differences').expect(200)).body.items;
      return {
        linked: parties[0].customer.phone,
        suggested: parties[1].suggestions[0].phone,
        farq: farq[0].phone,
        text: JSON.stringify({ parties: parties.map((p: object) => ({ ...p, phones: [] })), farq }),
      };
    };
    const accountant = await seen('accountant');
    expect(accountant).toMatchObject({
      linked: '+91XXXXXXX679',
      suggested: '+91XXXXXXX678',
      farq: '+91XXXXXXX679',
    });
    expect(accountant.text).not.toContain('9812345678');
    expect(accountant.text).not.toContain('9812345679');
    expect(await seen('owner')).toMatchObject({
      linked: '+919812345679',
      suggested: '+919812345678',
      farq: '+919812345679',
    });
  });
  it('never suggests the walk-in through a GSTIN on its quote', async () => {
    await customer('walkin', 'Counter', { phone: 'walk-in:store' });
    await db.quote.create({
      data: {
        number: 'QT-TALLY-WALK',
        userId: 'walkin',
        address: {},
        deliveryDate: today,
        company: 'Firm',
        gstin: '10ABCDE1234F1Z9',
        notes: '',
      },
    });
    await ledger('l1', 'Zzz Qqq', -100n, { gstin: '10ABCDE1234F1Z9' });
    expect((await get('owner', 'parties').expect(200)).body.items[0].suggestions).toEqual([]);
  });
  describe('a match can be undone later, not only straight after making it', () => {
    async function matched() {
      const row = await ledger('l1', 'Asha', -5000n);
      await link('owner', row.id, { userId: 'customer' }).expect(201);
      const app = await entry('customer', 5000, dayShift(today, -1));
      const bill = await voucher(row, 'v1', -5000n, dayShift(today, -1));
      const made = await post('accountant', 'matches', {
        items: [{ entryId: app.id, voucherId: bill.id }],
      }).expect(201);
      return { app, bill, id: made.body.ids[0] as string };
    }
    it('the customer’s numbers list each match a person made, with what to call it', async () => {
      const { app, bill, id } = await matched();
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.matches).toEqual([
        {
          id,
          entryId: app.id,
          voucherId: bill.id,
          amountPaise: '5000',
          on: dayShift(today, -1),
          label: 'V1',
          voucherGone: false,
          at: expect.any(String),
        },
      ]);
    });
    it('undoing takes it off the list, and a fresh match can follow', async () => {
      const { app, bill, id } = await matched();
      await post('owner', `matches/${id}/undo`).expect(201);
      const undone = (await get('owner', 'customers/customer/numbers').expect(200)).body;
      expect(undone.matches).toEqual([]);
      const again = await post('owner', 'matches', {
        items: [{ entryId: app.id, voucherId: bill.id }],
      }).expect(201);
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.matches.map((row: { id: string }) => row.id)).toEqual(again.body.ids);
    });
    it('a match whose voucher Tally deleted stays listed, because it blocks a new match', async () => {
      const { app, bill, id } = await matched();
      await db.tallyVoucher.update({ where: { id: bill.id }, data: { deletedAt: new Date() } });
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.matches).toMatchObject([{ id, voucherGone: true }]);
      const row = await db.tallyLedger.findFirstOrThrow({ where: { guid: 'l1' } });
      const other = await voucher(row, 'v2', -5000n, today);
      await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: other.id }] }).expect(
        409,
      );
      await post('owner', `matches/${id}/undo`).expect(201);
      await post('owner', 'matches', { items: [{ entryId: app.id, voucherId: other.id }] }).expect(
        201,
      );
    });
    it('an order number on a bill is no person’s match, so there is nothing to undo', async () => {
      const row = await ledger('l1', 'Asha', -100000n);
      await link('owner', row.id, { userId: 'customer' }).expect(201);
      const order = await db.order.create({
        data: {
          number: 'SC-2026-UNDO0001',
          userId: 'customer',
          idempotencyKey: randomUUID(),
          status: 'DELIVERED',
          source: 'PHONE',
          address: {},
          deliveryDate: today,
          notes: '',
          subtotalPaise: 100000,
          deliveryFeePaise: 0,
          totalPaise: 100000,
        },
      });
      await entry('customer', 100000, dayShift(today, -1), {
        orderId: order.id,
        kind: 'SALE_ON_CREDIT',
      });
      await voucher(row, 'v1', -100000n, dayShift(today, -1), { orderRef: 'SC-2026-UNDO0001' });
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.matches).toEqual([]);
    });
    it('another customer’s numbers do not list it', async () => {
      await matched();
      await customer('other');
      const theirs = await ledger('l2', 'Other', -1n);
      await link('owner', theirs.id, { userId: 'other' }).expect(201);
      const { body } = await get('owner', 'customers/other/numbers').expect(200);
      expect(body.matches).toEqual([]);
    });
    it('while copying there is nothing to list, as there are no lines either', async () => {
      await matched();
      await db.tallyCompany.update({ where: { id: companyId }, data: { phase: 'BACKFILL' } });
      const { body } = await get('owner', 'customers/customer/numbers').expect(200);
      expect(body.matches).toEqual([]);
    });
  });
});
