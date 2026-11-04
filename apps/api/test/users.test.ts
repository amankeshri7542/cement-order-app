import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PERMISSIONS_VERSION, staffRoles } from '@shiv/shared';
import { Db } from '../src/db';
import { hashPassword } from '../src/security';
import { addPerson, clearShopWork, tokenFor } from './staff-helper';

if (existsSync('.env.test')) loadEnvFile('.env.test');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.OTP_PROVIDER = 'mock';
process.env.OTP_HASH_SECRET = 'users-test-only-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:3000';
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
  throw new Error('User tests require a dedicated TEST_DATABASE_URL ending in _test.');

const MAIN = 'loc_main';
const SECOND = 'loc_users_b';
let app: INestApplication;
let server: Server;
let db: Db;

const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const add = (body: Record<string, unknown>, who = 'papa') =>
  request(server).post('/api/v1/admin/users').set(as(who)).send(body);
const change = (id: string, body: Record<string, unknown>, who = 'papa') =>
  request(server).patch(`/api/v1/admin/users/${id}`).set(as(who)).send(body);
const act = (id: string, what: string, who = 'papa', body: Record<string, unknown> = {}) =>
  request(server).post(`/api/v1/admin/users/${id}/${what}`).set(as(who)).send(body);
const orders = (who: string) => request(server).get('/api/v1/admin/orders').set(as(who));
const newStaff = {
  name: 'Sita Devi',
  phone: '+919000000501',
  role: 'CASHIER',
  locationIds: [MAIN],
};
const active = (userId: string) =>
  db.staffMembership.findMany({ where: { userId, endedAt: null } });

beforeAll(async () => {
  const { createApp } = await import('../src/app');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  server = app.getHttpServer();
  db = app.get(Db);
}, 30000);
beforeEach(async () => {
  await clearShopWork(db);
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await db.location.upsert({
    where: { id: SECOND },
    update: { active: true, name: 'Second shop' },
    create: { id: SECOND, firmId: 'firm_main', slug: 'users-b', name: 'Second shop' },
  });
  await db.$executeRawUnsafe(`DELETE FROM "Location" WHERE "id" NOT IN ('${MAIN}', '${SECOND}')`);
  await addPerson(db, { id: 'papa', role: 'OWNER', phone: '+919000000401' });
  await addPerson(db, { id: 'chacha', role: 'OWNER', phone: '+919000000402' });
  await addPerson(db, { id: 'cashier', role: 'CASHIER', shops: [MAIN], phone: '+919000000403' });
  await addPerson(db, { id: 'manager', role: 'MANAGER', shops: [MAIN], phone: '+919000000404' });
  await addPerson(db, { id: 'customer', phone: '+919000000405' });
});
afterAll(async () => {
  await app?.close();
});

describe('adding a person', () => {
  it.each(staffRoles.map((role) => [role]))('an owner can add a %s', async (role) => {
    const allShops = ['OWNER', 'ACCOUNTANT', 'TECH_OPERATOR'].includes(role);
    const { body } = await add({ ...newStaff, role, locationIds: allShops ? [] : [MAIN] }).expect(
      201,
    );
    expect(body).toMatchObject({ name: 'Sita Devi', role, staffPausedAt: null });
    expect(body.locationIds).toEqual(allShops ? [] : [MAIN]);
    expect((await active(body.id)).map((membership) => membership.role)).toEqual([role]);
  });
  it('someone can work at more than one shop', async () => {
    const { body } = await add({ ...newStaff, locationIds: [MAIN, SECOND] }).expect(201);
    expect(body.locationIds.sort()).toEqual([MAIN, SECOND].sort());
  });
  it('a shop chosen twice counts once', async () => {
    const { body } = await add({ ...newStaff, locationIds: [MAIN, MAIN] }).expect(201);
    expect(body.locationIds).toEqual([MAIN]);
  });
  it('records who added whom, without their name or number', async () => {
    const { body } = await add(newStaff).expect(201);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'STAFF_ROLE_GRANTED' } });
    expect(log).toMatchObject({ actorId: 'papa', entityId: body.id });
    expect(JSON.stringify(log)).not.toContain('Sita');
    expect(JSON.stringify(log)).not.toContain(newStaff.phone);
  });
  it('the new person signs in with their own code and sees only their job', async () => {
    await add(newStaff).expect(201);
    const sent = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: newStaff.phone })
      .expect(201);
    const signedIn = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: newStaff.phone, code: sent.body.devCode, surface: 'DESK' })
      .expect(201);
    const auth = { Authorization: `Bearer ${signedIn.body.accessToken as string}` };
    const session = await request(server).get('/api/v1/auth/session').set(auth).expect(200);
    expect(session.body.access['orders.read']).toEqual([MAIN]);
    expect(session.body.access['staff.manage']).toBeUndefined();
    await request(server).get('/api/v1/admin/users').set(auth).expect(403);
  });
  it('an existing customer keeps their account, and their old app session gains nothing', async () => {
    const { body } = await add({ ...newStaff, phone: '+919000000405' }).expect(201);
    expect(body.id).toBe('customer');
    await request(server).get('/api/v1/me').set(as('customer')).expect(200);
    await orders('customer').expect(403);
  });
  it.each([
    ['a number already on the staff', { phone: '+919000000403' }, 'ALREADY_STAFF', 409],
    ['a shop role with no shop', { locationIds: [] }, 'SHOP_REQUIRED', 400],
    ['an all-shop role with a shop', { role: 'OWNER', locationIds: [MAIN] }, 'INVALID_SHOP', 400],
    ['a made-up shop', { locationIds: ['no-such-shop'] }, 'INVALID_SHOP', 400],
    ['a role that does not exist', { role: 'SUPERADMIN' }, 'INVALID_INPUT', 400],
    ['a badly formed number', { phone: '12345' }, 'INVALID_INPUT', 400],
    ['a landline', { phone: '+914000000000' }, 'INVALID_INPUT', 400],
    ['a name holding a script', { name: '<script>alert(1)</script>' }, 'INVALID_INPUT', 400],
    ['a one letter name', { name: 'A' }, 'INVALID_INPUT', 400],
    ['too many shops', { locationIds: Array(21).fill(MAIN) }, 'INVALID_INPUT', 400],
    ['an extra field setting the old role', { userRole: 'ADMIN' }, 'INVALID_INPUT', 400],
    ['an extra field unpausing', { staffPausedAt: null }, 'INVALID_INPUT', 400],
  ])('refuses %s', async (_name, change, code, status) => {
    const { body } = await add({ ...newStaff, ...change }).expect(status as number);
    expect(body.error.code).toBe(code);
  });
  it('refuses a closed shop', async () => {
    await db.location.update({ where: { id: SECOND }, data: { active: false } });
    const { body } = await add({ ...newStaff, locationIds: [SECOND] }).expect(400);
    expect(body.error.code).toBe('INVALID_SHOP');
  });
  it('refuses a deleted account', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { deletedAt: new Date() } });
    const { body } = await add({ ...newStaff, phone: '+919000000405' }).expect(409);
    expect(body.error.code).toBe('ACCOUNT_DELETED');
  });
  it('refuses a customer with udhaar, whose balance would vanish from the customer lists', async () => {
    await db.user.update({ where: { id: 'customer' }, data: { khataBalancePaise: 100 } });
    const { body } = await add({ ...newStaff, phone: '+919000000405' }).expect(409);
    expect(body.error.code).toBe('HAS_UDHAAR');
    expect((await db.user.findUniqueOrThrow({ where: { id: 'customer' } })).role).toBe('CUSTOMER');
  });
  it('the same person added twice at once is added once', async () => {
    const results = await Promise.all([add(newStaff), add(newStaff), add(newStaff)]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 201 || status === 409)).toBe(true);
    const person = await db.user.findUniqueOrThrow({ where: { phone: newStaff.phone } });
    expect(await active(person.id)).toHaveLength(1);
  });
});

describe('the staff list', () => {
  it('shows people with their role, shops and last active time, and no customers', async () => {
    const { body } = await request(server).get('/api/v1/admin/users').set(as('papa')).expect(200);
    const ids = body.map((person: { id: string }) => person.id);
    expect(ids).toEqual(expect.arrayContaining(['papa', 'chacha', 'cashier', 'manager']));
    expect(ids).not.toContain('customer');
    const cashier = body.find((person: { id: string }) => person.id === 'cashier');
    expect(cashier).toMatchObject({ role: 'CASHIER', locationIds: [MAIN] });
    expect(cashier.lastActiveAt).toBeTruthy();
    // Nothing about how they sign in leaves the server.
    expect(JSON.stringify(body)).not.toMatch(/accessHash|refreshHash|passwordHash/);
  });
  it('people who left are off the list', async () => {
    await act('cashier', 'remove').expect(201);
    const { body } = await request(server).get('/api/v1/admin/users').set(as('papa')).expect(200);
    expect(body.map((person: { id: string }) => person.id)).not.toContain('cashier');
  });
});

describe('changing someone', () => {
  it('a new role works on their very next request, with the same token', async () => {
    const refund = () =>
      request(server).post('/api/v1/admin/orders/nope/cash-refunded').set(as('cashier')).send({});
    await refund().expect(403);
    await change('cashier', { role: 'MANAGER' }).expect(200);
    expect((await refund()).status).not.toBe(403);
    await change('cashier', { role: 'STOCK_KEEPER' }).expect(200);
    await refund().expect(403);
  });
  it('moving someone to another shop takes the old one away at once', async () => {
    await change('cashier', { locationIds: [SECOND] }).expect(200);
    const session = await request(server)
      .get('/api/v1/auth/session')
      .set(as('cashier'))
      .expect(200);
    expect(session.body.access['orders.read']).toEqual([SECOND]);
  });
  it('a role that covers every shop drops their shop list', async () => {
    const { body } = await change('cashier', { role: 'ACCOUNTANT', locationIds: [] }).expect(200);
    expect(body).toMatchObject({ role: 'ACCOUNTANT', locationIds: [] });
  });
  it('a change keeps the history of what they held', async () => {
    await change('cashier', { role: 'MANAGER' }).expect(200);
    const all = await db.staffMembership.findMany({
      where: { userId: 'cashier' },
      orderBy: { startedAt: 'asc' },
    });
    expect(all.map((row) => [row.role, row.endedAt !== null])).toEqual([
      ['CASHIER', true],
      ['MANAGER', false],
    ]);
    expect(all[0]?.endedById).toBe('papa');
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'STAFF_ROLE_CHANGED' } });
    expect(log.details).toMatchObject({ role: 'MANAGER', previousRole: 'CASHIER' });
  });
  it('saving the same role again writes nothing', async () => {
    await change('cashier', { role: 'CASHIER' }).expect(200);
    expect(await db.auditLog.count({ where: { event: 'STAFF_ROLE_CHANGED' } })).toBe(0);
  });
  it('a rename is logged without the name', async () => {
    await change('cashier', { name: 'Ramesh Kumar' }).expect(200);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'STAFF_RENAMED' } });
    expect(JSON.stringify(log)).not.toContain('Ramesh');
  });
  it('refuses a shop role with its shops taken away', async () => {
    const { body } = await change('cashier', { locationIds: [] }).expect(400);
    expect(body.error.code).toBe('SHOP_REQUIRED');
  });
  it('someone not on the staff is not found', async () => {
    await change('customer', { role: 'MANAGER' }).expect(404);
    await change('nobody', { role: 'MANAGER' }).expect(404);
  });
});

describe('nobody changes their own access', () => {
  it.each([
    ['a role', () => change('papa', { role: 'CASHIER', locationIds: [MAIN] })],
    ['shops', () => change('papa', { locationIds: [MAIN] })],
    ['a pause', () => act('papa', 'pause')],
    ['a resume', () => act('papa', 'resume')],
    ['removal', () => act('papa', 'remove')],
    ['signing out of every phone', () => act('papa', 'sign-out')],
  ])('%s', async (_name, run) => {
    const { body } = await run().expect(403);
    expect(body.error.code).toBe('SELF_CHANGE');
  });
  it('their own name is fine', async () => {
    await change('papa', { name: 'Papa Ji' }).expect(200);
  });
});

describe('people without staff access', () => {
  it.each(['manager', 'cashier', 'customer'])('%s cannot manage anyone', async (who) => {
    await request(server).get('/api/v1/admin/users').set(as(who)).expect(403);
    await add(newStaff, who).expect(403);
    await change('cashier', { role: 'OWNER', locationIds: [] }, who).expect(403);
    await change(who, { role: 'OWNER', locationIds: [] }, who).expect(403);
    await act('papa', 'pause', who).expect(403);
    await act('chacha', 'remove', who).expect(403);
    await act('papa', 'sign-out', who).expect(403);
    expect(await active('papa')).toHaveLength(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'papa' } })).staffPausedAt).toBeNull();
  });
  it('nobody signed out gets anywhere', async () => {
    await request(server).get('/api/v1/admin/users').expect(401);
    await request(server).post('/api/v1/admin/users').send(newStaff).expect(401);
  });
});

describe('pausing', () => {
  it('stops them at once, ends their sessions and their alerts', async () => {
    await db.pushSubscription.create({
      data: { userId: 'cashier', endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' },
    });
    await db.pushActionToken.create({
      data: {
        tokenHash: 'fixture-hash',
        userId: 'cashier',
        notificationId: 'n',
        purpose: 'ack',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await orders('cashier').expect(200);
    const { body } = await act('cashier', 'pause').expect(201);
    expect(body.staffPausedAt).toBeTruthy();
    await orders('cashier').expect(401);
    expect(await db.session.count({ where: { userId: 'cashier' } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: 'cashier' } })).toBe(0);
    expect((await db.pushActionToken.findFirstOrThrow()).usedAt).not.toBeNull();
    // Their role is kept for when they come back.
    expect(await active('cashier')).toHaveLength(1);
  });
  it('signing in again while paused gives no access', async () => {
    await act('cashier', 'pause').expect(201);
    const sent = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+919000000403' })
      .expect(201);
    const signedIn = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+919000000403', code: sent.body.devCode })
      .expect(201);
    const auth = { Authorization: `Bearer ${signedIn.body.accessToken as string}` };
    const session = await request(server).get('/api/v1/auth/session').set(auth).expect(200);
    expect(session.body.access).toEqual({});
    await request(server).get('/api/v1/admin/orders').set(auth).expect(403);
  });
  it('resuming gives their access back after a fresh sign-in', async () => {
    await act('cashier', 'pause').expect(201);
    const { body } = await act('cashier', 'resume').expect(201);
    expect(body.staffPausedAt).toBeNull();
    const user = await db.user.findUniqueOrThrow({ where: { id: 'cashier' } });
    expect(user.staffPausedAt).toBeNull();
    await orders('cashier').expect(401);
  });
  it('logs it, and a customer session of theirs carries on', async () => {
    await db.session.create({
      data: {
        id: 'own-customer-app',
        userId: 'cashier',
        accessHash: 'own-customer-app-hash',
        refreshHash: 'own-customer-app-refresh',
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
        surface: 'CUSTOMER',
      },
    });
    await act('cashier', 'pause').expect(201);
    expect(await db.session.count({ where: { id: 'own-customer-app' } })).toBe(1);
    expect(await db.auditLog.count({ where: { event: 'STAFF_PAUSED', entityId: 'cashier' } })).toBe(
      1,
    );
  });
});

describe('removing', () => {
  it('ends access for good and keeps the person and their history', async () => {
    await act('cashier', 'remove').expect(201);
    await orders('cashier').expect(401);
    const user = await db.user.findUniqueOrThrow({ where: { id: 'cashier' } });
    expect(user).toMatchObject({ role: 'CUSTOMER', staffPausedAt: null, deletedAt: null });
    expect(await active('cashier')).toHaveLength(0);
    expect(await db.staffMembership.count({ where: { userId: 'cashier' } })).toBe(1);
  });
  it('a verified contractor goes back to being one', async () => {
    await db.user.update({ where: { id: 'cashier' }, data: { contractorStatus: 'VERIFIED' } });
    await act('cashier', 'remove').expect(201);
    expect((await db.user.findUniqueOrThrow({ where: { id: 'cashier' } })).role).toBe('CONTRACTOR');
  });
  it('someone who left can be added again', async () => {
    await act('cashier', 'remove').expect(201);
    const { body } = await add({ ...newStaff, phone: '+919000000403', role: 'MANAGER' }).expect(
      201,
    );
    expect(body).toMatchObject({ id: 'cashier', role: 'MANAGER' });
  });
  it('removing twice is a plain not-found', async () => {
    await act('cashier', 'remove').expect(201);
    await act('cashier', 'remove').expect(404);
  });
});

describe('the last owner', () => {
  it('two owners removing each other at once leave one owner', async () => {
    const results = await Promise.all([
      act('papa', 'remove', 'chacha'),
      act('chacha', 'remove', 'papa'),
    ]);
    const owners = await db.staffMembership.count({ where: { role: 'OWNER', endedAt: null } });
    expect(owners).toBeGreaterThanOrEqual(1);
    expect(results.map((result) => result.status)).toContain(201);
  });
  it('two owners pausing each other at once leave one owner working', async () => {
    await Promise.all([act('papa', 'pause', 'chacha'), act('chacha', 'pause', 'papa')]);
    const working = await db.user.count({
      where: {
        staffPausedAt: null,
        staffMemberships: { some: { role: 'OWNER', endedAt: null } },
      },
    });
    expect(working).toBeGreaterThanOrEqual(1);
  });
  it('an owner’s role cannot be taken when no other owner is working', async () => {
    await db.user.update({ where: { id: 'papa' }, data: { staffPausedAt: new Date() } });
    await db.session.create({
      data: {
        id: 'second-owner-seat',
        userId: 'manager',
        accessHash: 'unused-a',
        refreshHash: 'unused-b',
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
        surface: 'DESK',
      },
    });
    // Reached only when the acting owner is paused mid-request, so the rule is checked directly.
    const { UsersController } = await import('../src/users');
    const controller = new UsersController(db);
    await expect(
      controller.remove('chacha', {}, {
        user: { id: 'manager' },
        ip: '127.0.0.1',
      } as never),
    ).rejects.toMatchObject({ response: { code: 'LAST_OWNER' } });
    expect(await active('chacha')).toHaveLength(1);
  });
});

describe('signing out everywhere', () => {
  it('either owner can sign the other out, which needs no passphrase', async () => {
    await db.adminCredential.create({
      data: { userId: 'papa', passwordHash: await hashPassword('correct horse battery') },
    });
    await db.pushSubscription.create({
      data: { userId: 'chacha', endpoint: 'https://fcm.googleapis.com/y', p256dh: 'p', auth: 'a' },
    });
    const { body } = await act('chacha', 'sign-out').expect(201);
    expect(body.sessions).toBe(1);
    await orders('chacha').expect(401);
    expect(await db.pushSubscription.count({ where: { userId: 'chacha' } })).toBe(0);
    // They are still an owner, and can sign in again with their own code.
    expect(await active('chacha')).toHaveLength(1);
  });
});

describe('changing access asks for the passphrase of anyone who has one', () => {
  const passphrase = 'correct horse battery';
  beforeEach(async () => {
    await db.adminCredential.create({
      data: { userId: 'papa', passwordHash: await hashPassword(passphrase) },
    });
  });
  it.each([
    ['adding', () => add(newStaff)],
    ['changing a role', () => change('cashier', { role: 'MANAGER' })],
    ['changing shops', () => change('cashier', { locationIds: [SECOND] })],
    ['pausing', () => act('cashier', 'pause')],
    ['resuming', () => act('cashier', 'resume')],
    ['removing', () => act('cashier', 'remove')],
  ])('%s is refused without it', async (_name, run) => {
    const { body } = await run().expect(403);
    expect(body.error.code).toBe('STEP_UP_REQUIRED');
  });
  it('a wrong one is refused and nothing changes', async () => {
    const { body } = await act('cashier', 'pause', 'papa', {
      passphrase: 'wrong wrong wrong',
    }).expect(403);
    expect(body.error.code).toBe('STEP_UP_FAILED');
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: 'cashier' } })).staffPausedAt,
    ).toBeNull();
  });
  it('the right one works, and is never written down', async () => {
    await add({ ...newStaff, passphrase }).expect(201);
    await act('cashier', 'pause', 'papa', { passphrase }).expect(201);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(passphrase);
  });
  it('guessing locks after ten tries, even with the right one', async () => {
    for (let i = 0; i < 10; i++)
      await act('cashier', 'pause', 'papa', { passphrase: `wrong guess ${i}` }).expect(403);
    const { body } = await act('cashier', 'pause', 'papa', { passphrase }).expect(429);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(await db.auditLog.count({ where: { event: 'STAFF_PASSPHRASE_LOCKED' } })).toBe(1);
  });
  it('a rename needs no passphrase', async () => {
    await change('cashier', { name: 'Ramesh Kumar' }).expect(200);
  });
  it('an owner with no passphrase is not asked', async () => {
    await add(newStaff, 'chacha').expect(201);
  });
});

describe('shops', () => {
  const addShop = (body: Record<string, unknown>, who = 'papa') =>
    request(server).post('/api/v1/admin/locations').set(as(who)).send(body);
  const changeShop = (id: string, body: Record<string, unknown>, who = 'papa') =>
    request(server).patch(`/api/v1/admin/locations/${id}`).set(as(who)).send(body);

  it('an owner can add a shop, which counts its stock from nothing at once', async () => {
    const { body } = await addShop({ name: 'Danapur shop' }).expect(201);
    expect(body).toMatchObject({ name: 'Danapur shop', active: true });
    expect(body.stockStartedAt).toBeTruthy();
    // Goods received there really arrive, with no gap where stock is only noted down.
    await db.category.create({ data: { id: 'category', name: 'Cement', slug: 'cement' } });
    await db.product.create({
      data: {
        id: 'cement',
        name: 'Test cement',
        brand: 'Test',
        categoryId: 'category',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 40000,
        stock: 0,
        description: 'Test product',
        recommendedUse: 'Test',
        images: [],
      },
    });
    const received = await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(as('papa'))
      .send({
        kind: 'PURCHASE_IN',
        quantity: 5,
        locationId: body.id,
        note: 'First goods',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      })
      .expect(201);
    expect(received.body.balanceAfter).toBe(5);
    expect(await db.auditLog.count({ where: { event: 'SHOP_ADDED', entityId: body.id } })).toBe(1);
  });
  it('lists shops with how many people work there', async () => {
    const { body } = await request(server)
      .get('/api/v1/admin/locations')
      .set(as('papa'))
      .expect(200);
    const main = body.find((shop: { id: string }) => shop.id === MAIN);
    expect(main._count.memberships).toBe(2);
  });
  it('a name cannot be used twice, in any case', async () => {
    const { body } = await addShop({ name: 'SECOND SHOP' }).expect(409);
    expect(body.error.code).toBe('SHOP_EXISTS');
    await changeShop(MAIN, { name: 'second shop' }).expect(409);
  });
  it('refuses a name holding a script', async () => {
    await addShop({ name: '<img src=x>' }).expect(400);
  });
  it('the main shop stays open', async () => {
    const { body } = await changeShop(MAIN, { active: false }).expect(409);
    expect(body.error.code).toBe('SHOP_IN_USE');
  });
  it('a shop with staff cannot close', async () => {
    await change('cashier', { locationIds: [SECOND] }).expect(200);
    const { body } = await changeShop(SECOND, { active: false }).expect(409);
    expect(body.error.code).toBe('SHOP_IN_USE');
  });
  it('a shop serving delivery areas cannot close', async () => {
    await db.deliveryZone.create({
      data: {
        id: 'second-zone',
        name: 'Second',
        deliveryFeePaise: 0,
        estimate: 'x',
        locationId: SECOND,
      },
    });
    const { body } = await changeShop(SECOND, { active: false }).expect(409);
    expect(body.error.code).toBe('SHOP_IN_USE');
  });
  it('an empty shop can close and reopen, and a closed shop takes no staff', async () => {
    await changeShop(SECOND, { active: false }).expect(200);
    await add({ ...newStaff, locationIds: [SECOND] }).expect(400);
    await changeShop(SECOND, { active: true }).expect(200);
    await add({ ...newStaff, locationIds: [SECOND] }).expect(201);
  });
  it('a shop with open orders cannot close, as a cancel would have nowhere to go', async () => {
    await db.category.create({ data: { id: 'category', name: 'Cement', slug: 'cement' } });
    await db.product.create({
      data: {
        id: 'cement',
        name: 'Test cement',
        brand: 'Test',
        categoryId: 'category',
        type: 'PPC',
        grade: 'PPC',
        unit: 'bag',
        pricePaise: 40000,
        stock: 0,
        minQuantity: 1,
        description: 'Test product',
        recommendedUse: 'Test',
        images: [],
      },
    });
    await db.storeSettings.create({ data: { id: 'store', phone: '+919999999000' } });
    await db.deliveryZone.create({
      data: {
        id: 'zone-main',
        name: 'Patna',
        deliveryFeePaise: 0,
        minimumOrderPaise: 0,
        estimate: 'Today',
        pincodes: { create: { pincode: '800020' } },
      },
    });
    await db.location.update({ where: { id: SECOND }, data: { stockStartedAt: new Date() } });
    await request(server)
      .post('/api/v1/admin/products/cement/movements')
      .set(as('papa'))
      .send({
        kind: 'PURCHASE_IN',
        quantity: 5,
        locationId: SECOND,
        note: 'First goods',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const order = await request(server)
      .post('/api/v1/admin/orders/phone')
      .set(as('papa'))
      .send({
        locationId: SECOND,
        customerPhone: '+919000000405',
        customerName: 'Customer',
        address: {
          label: 'Site',
          name: 'Customer',
          phone: '+919000000405',
          line1: 'Plot 12',
          area: 'Kankarbagh',
          city: 'Patna',
          state: 'Bihar',
          pincode: '800020',
          landmark: '',
        },
        items: [{ productId: 'cement', quantity: 1 }],
        deliveryDate: 'today',
        paymentMethod: 'COD',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    const { body } = await changeShop(SECOND, { active: false }).expect(409);
    expect(body.error.code).toBe('SHOP_IN_USE');
    await request(server)
      .patch(`/api/v1/admin/orders/${order.body.id as string}/status`)
      .set(as('papa'))
      .send({ status: 'CANCELLED', note: 'Customer changed their mind' })
      .expect(200);
    await changeShop(SECOND, { active: false }).expect(200);
  });
  it('a shop that does not exist is not found', async () => {
    await changeShop('nope', { name: 'Anything' }).expect(404);
  });
  it.each(['manager', 'cashier', 'customer'])('%s cannot manage shops', async (who) => {
    await request(server).get('/api/v1/admin/locations').set(as(who)).expect(403);
    await addShop({ name: 'Mine now' }, who).expect(403);
    await changeShop(SECOND, { active: false }, who).expect(403);
  });
});

describe('setting your own passphrase', () => {
  const set = (body: Record<string, unknown>, who = 'papa') =>
    request(server).post('/api/v1/auth/passphrase').set(as(who)).send(body);
  const first = 'a good long passphrase';

  it('an owner sets one, and changing access then asks for it', async () => {
    await add(newStaff).expect(201);
    await set({ next: first }).expect(201);
    const asked = await add({ ...newStaff, phone: '+919000000502' }).expect(403);
    expect(asked.body.error.code).toBe('STEP_UP_REQUIRED');
    await add({ ...newStaff, phone: '+919000000502', passphrase: first }).expect(201);
  });
  it('the session stays signed in, and the secret is stored nowhere readable', async () => {
    await set({ next: first }).expect(201);
    await orders('papa').expect(200);
    const row = await db.adminCredential.findUniqueOrThrow({ where: { userId: 'papa' } });
    expect(row.passwordHash).not.toContain(first);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'STAFF_PASSPHRASE_SET' } });
    expect(log.details).toEqual({ first: true });
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(first);
  });
  it('the session reports whether one is set', async () => {
    const before = await request(server).get('/api/v1/auth/session').set(as('papa')).expect(200);
    expect(before.body.hasPassphrase).toBe(false);
    await set({ next: first }).expect(201);
    const after = await request(server).get('/api/v1/auth/session').set(as('papa')).expect(200);
    expect(after.body.hasPassphrase).toBe(true);
    expect(after.body).not.toHaveProperty('passwordHash');
  });
  it('the other owner hears about it at once', async () => {
    await set({ next: first }).expect(201);
    const note = await db.notification.findFirstOrThrow({ where: { userId: 'chacha' } });
    expect(note.dedupeKey).toMatch(/^people:/);
    expect(await db.notification.count({ where: { userId: 'papa' } })).toBe(0);
  });
  it('changing it needs the old one, and ends their other phones', async () => {
    await set({ next: first }).expect(201);
    await db.session.create({
      data: {
        id: 'papa-second-phone',
        userId: 'papa',
        accessHash: 'papa-second-a',
        refreshHash: 'papa-second-b',
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
        surface: 'DESK',
      },
    });
    const missing = await set({ next: 'another long passphrase' }).expect(403);
    expect(missing.body.error.code).toBe('STEP_UP_REQUIRED');
    const wrong = await set({
      current: 'not the right one',
      next: 'another long passphrase',
    }).expect(403);
    expect(wrong.body.error.code).toBe('STEP_UP_FAILED');
    expect(await db.session.count({ where: { id: 'papa-second-phone' } })).toBe(1);
    await set({ current: first, next: 'another long passphrase' }).expect(201);
    expect(await db.session.count({ where: { id: 'papa-second-phone' } })).toBe(0);
    await orders('papa').expect(200);
    await add({ ...newStaff, passphrase: 'another long passphrase' }).expect(201);
  });
  it('guessing the old one locks after ten tries', async () => {
    await set({ next: first }).expect(201);
    for (let i = 0; i < 10; i++)
      await set({ current: `wrong guess ${i}`, next: 'another long passphrase' }).expect(403);
    await set({ current: first, next: 'another long passphrase' }).expect(429);
  });
  it('refuses one that is too short, and any extra field', async () => {
    await set({ next: 'too short' }).expect(400);
    await set({ next: first, userId: 'chacha' }).expect(400);
    expect(await db.adminCredential.count()).toBe(0);
  });
  it('a customer cannot make one', async () => {
    await set({ next: first }, 'customer').expect(403);
    expect(await db.adminCredential.count()).toBe(0);
  });
  it('someone signed out cannot', async () => {
    await request(server).post('/api/v1/auth/passphrase').send({ next: first }).expect(401);
  });
});

describe('old sessions and new rights', () => {
  it('a customer asking for a desk session at sign-in still gets a customer one', async () => {
    const sent = await request(server)
      .post('/api/v1/auth/otp/request')
      .send({ phone: '+919000000405' })
      .expect(201);
    const signedIn = await request(server)
      .post('/api/v1/auth/otp/verify')
      .send({ phone: '+919000000405', code: sent.body.devCode, surface: 'DESK' })
      .expect(201);
    expect(await db.session.count({ where: { userId: 'customer', surface: 'DESK' } })).toBe(0);
    await add({ ...newStaff, phone: '+919000000405', role: 'MANAGER' }).expect(201);
    // Becoming staff later gives that old phone nothing.
    await request(server)
      .get('/api/v1/admin/orders')
      .set('Authorization', `Bearer ${signedIn.body.accessToken as string}`)
      .expect(403);
  });
  it('a leftover desk session ends when someone joins the staff', async () => {
    await db.session.create({
      data: {
        id: 'leftover-desk',
        userId: 'customer',
        accessHash: 'leftover-a',
        refreshHash: 'leftover-b',
        expiresAt: new Date(Date.now() + 3600000),
        refreshExpiresAt: new Date(Date.now() + 86400000),
        surface: 'DESK',
      },
    });
    await add({ ...newStaff, phone: '+919000000405' }).expect(201);
    expect(await db.session.count({ where: { id: 'leftover-desk' } })).toBe(0);
  });
  it('moving up to a role that reaches everything means signing in again', async () => {
    await orders('cashier').expect(200);
    await change('cashier', { role: 'OWNER', locationIds: [] }).expect(200);
    await orders('cashier').expect(401);
  });
  it('moving between shop roles keeps them working', async () => {
    await change('cashier', { role: 'MANAGER' }).expect(200);
    await orders('cashier').expect(200);
  });
  it('a new owner is announced to the other owners, by name only to them', async () => {
    await add({ ...newStaff, role: 'OWNER', locationIds: [] }).expect(201);
    const notes = await db.notification.findMany({ where: { userId: 'chacha' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.body).toContain('Sita Devi');
    expect(await db.notification.count({ where: { userId: 'papa' } })).toBe(0);
    expect(await db.notification.count({ where: { userId: 'cashier' } })).toBe(0);
  });
  it('promoting someone to owner is announced too', async () => {
    await change('cashier', { role: 'OWNER', locationIds: [] }).expect(200);
    expect(await db.notification.count({ where: { userId: 'chacha' } })).toBe(1);
  });
  it('pausing or removing an owner is announced, and ordinary staff changes are not', async () => {
    await act('cashier', 'pause').expect(201);
    expect(await db.notification.count({ where: { userId: 'chacha' } })).toBe(0);
    await addPerson(db, { id: 'third', role: 'OWNER', phone: '+919000000409' });
    await act('third', 'pause').expect(201);
    expect(await db.notification.count({ where: { userId: 'chacha' } })).toBe(1);
    await act('third', 'remove').expect(201);
    expect(await db.notification.count({ where: { userId: 'chacha' } })).toBe(2);
  });
});

describe('the database itself protects this history', () => {
  it('a membership cannot be deleted', async () => {
    await expect(
      db.$executeRawUnsafe(`DELETE FROM "StaffMembership" WHERE "userId" = 'papa'`),
    ).rejects.toThrow(/never deleted/);
  });
  it('a membership cannot be rewritten, or revived after it ended', async () => {
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "StaffMembership" SET "role" = 'OWNER' WHERE "userId" = 'cashier'`,
      ),
    ).rejects.toThrow(/only be ended/);
    await db.$executeRawUnsafe(
      `UPDATE "StaffMembership" SET "endedAt" = now() WHERE "userId" = 'cashier'`,
    );
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "StaffMembership" SET "endedAt" = NULL WHERE "userId" = 'cashier'`,
      ),
    ).rejects.toThrow(/only be ended/);
  });
  it('an owner cannot be tied to one shop, nor a cashier left with none', async () => {
    await expect(
      db.staffMembership.create({
        data: { userId: 'customer', role: 'OWNER', locationId: MAIN, grantedById: 'x' },
      }),
    ).rejects.toThrow();
    await expect(
      db.staffMembership.create({
        data: { userId: 'customer', role: 'CASHIER', locationId: null, grantedById: 'x' },
      }),
    ).rejects.toThrow();
  });
  it('nobody holds the same shop twice', async () => {
    await expect(
      db.staffMembership.create({
        data: { userId: 'cashier', role: 'MANAGER', locationId: MAIN, grantedById: 'x' },
      }),
    ).rejects.toThrow();
  });
  it('the activity log cannot be changed or deleted', async () => {
    await add(newStaff).expect(201);
    await expect(db.$executeRawUnsafe(`UPDATE "AuditLog" SET "event" = 'NOTHING'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(db.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
  });
  it('rows in the log carry the current rules version', async () => {
    await add(newStaff).expect(201);
    const log = await db.auditLog.findFirstOrThrow({ where: { event: 'STAFF_ROLE_GRANTED' } });
    expect(log.permissionsVersion).toBe(PERMISSIONS_VERSION);
  });
});
