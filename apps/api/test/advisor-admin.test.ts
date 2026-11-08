import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { advisorDeviceHeader, PERMISSIONS_VERSION, rolePermissions } from '@shiv/shared';
import request from 'supertest';
import {
  advisorTestEnv,
  aiOff,
  aiOn,
  answer,
  clearAdvisor,
  clearGuide,
  newDevice,
  seedCatalogue,
  signedForTest,
  startAdvisor,
  sync,
  type Harness,
} from './advisor-helper';
import { addPerson, tokenFor } from './staff-helper';

advisorTestEnv();
let h: Harness;
const as = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const api = '/api/v1/admin/advisor';
const SHOP = 'loc_main';

beforeAll(async () => {
  h = await startAdvisor();
  await h.db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await seedCatalogue(h.db);
  let phone = 9000000500;
  const next = () => `+91${++phone}`;
  await addPerson(h.db, { id: 'advowner', role: 'OWNER', phone: next() });
  await addPerson(h.db, { id: 'advtech', role: 'TECH_OPERATOR', phone: next() });
  await addPerson(h.db, { id: 'advaccountant', role: 'ACCOUNTANT', phone: next() });
  await addPerson(h.db, { id: 'advmanager', role: 'MANAGER', shops: [SHOP], phone: next() });
  await addPerson(h.db, { id: 'advcashier', role: 'CASHIER', shops: [SHOP], phone: next() });
  await addPerson(h.db, { id: 'advcustomer', phone: next() });
}, 30000);
afterAll(async () => {
  await h?.app.close();
});
beforeEach(async () => {
  aiOff();
  await clearAdvisor(h.db);
  await clearGuide(h.db);
  await h.db.$executeRawUnsafe('TRUNCATE TABLE "AuditLog"');
});

describe('who holds what', () => {
  it('owners hold all three, and the operator only health and the switch', () => {
    expect(rolePermissions.OWNER['advisor.review']).toBe('ALL');
    expect(rolePermissions.OWNER['advisor.health']).toBe('ALL');
    expect(rolePermissions.OWNER['advisor.control']).toBe('ALL');
    expect(rolePermissions.TECH_OPERATOR['advisor.health']).toBe('ALL');
    expect(rolePermissions.TECH_OPERATOR['advisor.control']).toBe('ALL');
    expect(rolePermissions.TECH_OPERATOR['advisor.review']).toBeUndefined();
    for (const role of [
      'MANAGER',
      'CASHIER',
      'ACCOUNTANT',
      'STOCK_KEEPER',
      'DRIVER',
      'HELPER',
    ] as const)
      for (const name of ['advisor.review', 'advisor.health', 'advisor.control'] as const)
        expect(rolePermissions[role][name], `${role} ${name}`).toBeUndefined();
  });
  it('an audit row is stamped with the new rules', async () => {
    await request(h.server)
      .patch(`${api}/settings`)
      .set(as('advowner'))
      .send({ aiPaused: true })
      .expect(200);
    const log = await h.db.auditLog.findFirstOrThrow({
      where: { event: 'ADVISOR_SETTINGS_CHANGED' },
    });
    expect(log.permissionsVersion).toBe(PERMISSIONS_VERSION);
  });
  it.each([
    [
      'get',
      `${api}/gaps`,
      {},
      ['advtech', 'advmanager', 'advcashier', 'advaccountant', 'advcustomer'],
    ],
    [
      'patch',
      `${api}/gaps/x`,
      { status: 'IGNORED' },
      ['advtech', 'advmanager', 'advcashier', 'advcustomer'],
    ],
    [
      'post',
      `${api}/shop-answers`,
      { question: 'kab', answer: 'x' },
      ['advtech', 'advmanager', 'advcashier', 'advcustomer'],
    ],
    ['get', `${api}/shop-answers`, {}, ['advtech', 'advmanager', 'advcustomer']],
    ['post', `${api}/shop-answers/x/retire`, {}, ['advtech', 'advmanager', 'advcustomer']],
    ['get', `${api}/health`, {}, ['advmanager', 'advcashier', 'advaccountant', 'advcustomer']],
    [
      'patch',
      `${api}/settings`,
      { aiPaused: true },
      ['advmanager', 'advcashier', 'advaccountant', 'advcustomer'],
    ],
  ] as const)('%s %s is refused to everyone else', async (method, path, body, refused) => {
    for (const who of refused) {
      const client = request(h.server) as unknown as Record<string, (path: string) => request.Test>;
      const sent = client[method]!(path).set(as(who));
      await (method === 'get' ? sent : sent.send(body)).expect(403);
    }
    const anon = (request(h.server) as unknown as Record<string, (path: string) => request.Test>)[
      method
    ]!(path);
    await (method === 'get' ? anon : anon.send(body)).expect(401);
  });
  it('a device token opens nothing on the desk', async () => {
    const device = await newDevice(h.server);
    await request(h.server).get(`${api}/health`).set(advisorDeviceHeader, device).expect(401);
  });
});

describe('Sawaal: what customers ask that the guide cannot answer', () => {
  const gap = async (question: string) => {
    const device = await newDevice(h.server);
    await answer(h.server, device, question);
  };
  it('groups the same question, keeps a few samples, and counts it', async () => {
    await gap('How do I check a trowel?');
    await gap('How do I check a trowel?');
    const { body } = await request(h.server).get(`${api}/gaps`).set(as('advowner')).expect(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        canonical: 'how do i check a trowel?',
        count: 2,
        kind: 'NO_ARTICLE',
        status: 'NEW',
        samples: ['How do I check a trowel?'],
      }),
    ]);
  });
  it('holds no phone number or email', async () => {
    await gap('Mera number 9876543210 hai, trowel kaise check karun? ramesh@example.com');
    const { body } = await request(h.server).get(`${api}/gaps`).set(as('advowner')).expect(200);
    expect(JSON.stringify(body)).not.toMatch(/9876543210|ramesh/);
    expect(body.items.length).toBe(1);
  });
  it('a flood of made-up questions stops growing the table', async () => {
    await h.db.advisorGap.createMany({
      data: Array.from({ length: 2000 }, (_, index) => ({
        canonical: `made up ${index}`,
        kind: 'NO_ARTICLE',
      })),
    });
    await gap('How do I check a trowel?');
    expect(await h.db.advisorGap.count()).toBe(2000);
  });
  it('words in a gap are kept short and stay plain data', async () => {
    await gap(`<img src=x onerror=alert(1)> ${'y'.repeat(500)}`);
    const row = await h.db.advisorGap.findFirstOrThrow();
    expect(row.canonical.length).toBeLessThanOrEqual(160);
  });
  it('an owner passes one to the engineer or drops it, and it is logged', async () => {
    await gap('How do I check a trowel?');
    const row = await h.db.advisorGap.findFirstOrThrow();
    const { body } = await request(h.server)
      .patch(`${api}/gaps/${row.id}`)
      .set(as('advowner'))
      .send({ status: 'ASKED_ENGINEER' })
      .expect(200);
    expect(body.status).toBe('ASKED_ENGINEER');
    const log = await h.db.auditLog.findFirstOrThrow({ where: { event: 'ADVISOR_GAP_DECIDED' } });
    expect(log).toMatchObject({ actorId: 'advowner', entityId: row.id });
    expect(JSON.stringify(log.details)).not.toContain('trowel');
    const open = await request(h.server).get(`${api}/gaps`).set(as('advowner')).expect(200);
    expect(open.body.items).toEqual([]);
    const passed = await request(h.server)
      .get(`${api}/gaps?status=ASKED_ENGINEER`)
      .set(as('advowner'))
      .expect(200);
    expect(passed.body.items.length).toBe(1);
  });
  it('refuses a status that only a shop answer can set, bad filters and bad ids', async () => {
    await gap('How do I check a trowel?');
    const row = await h.db.advisorGap.findFirstOrThrow();
    await request(h.server)
      .patch(`${api}/gaps/${row.id}`)
      .set(as('advowner'))
      .send({ status: 'ANSWERED' })
      .expect(400);
    await request(h.server).get(`${api}/gaps?status=WHATEVER`).set(as('advowner')).expect(400);
    await request(h.server)
      .patch(`${api}/gaps/nope`)
      .set(as('advowner'))
      .send({ status: 'IGNORED' })
      .expect(404);
    await request(h.server)
      .patch(`${api}/gaps/%00`)
      .set(as('advowner'))
      .send({ status: 'IGNORED' })
      .expect(404);
  });
});

describe('Jawab likho: an owner answers a question about the shop', () => {
  const post = (body: object, who = 'advowner') =>
    request(h.server).post(`${api}/shop-answers`).set(as(who)).send(body);
  const QUESTION = 'Is there a parking place for a tractor at the shop?';
  const ANSWER = 'Yes, a tractor can stand beside the shop while it is loaded.';

  it('publishes under the owner’s name, and customers then get those words', async () => {
    const { body } = await post({ question: QUESTION, answer: ANSWER }).expect(201);
    expect(body.status).toBe('PUBLISHED');
    const log = await h.db.auditLog.findFirstOrThrow({
      where: { event: 'ADVISOR_SHOP_ANSWER_APPROVED' },
    });
    expect(log).toMatchObject({ actorId: 'advowner', entityId: body.id });
    expect(JSON.stringify(log.details)).not.toContain('tractor');
    const row = await h.db.knowledgeArticle.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({ kind: 'SHOP', approvedById: 'advowner' });
    const device = await newDevice(h.server);
    const turn = await answer(
      h.server,
      device,
      'What is the address and location of the parking place for a tractor at the shop',
    );
    expect(turn.route).toBe('SHOP_FACT');
    expect(turn.text).toBe(ANSWER);
    expect(turn.level).toBe('FIXED');
    // The shop's own words, with no link to a guide page that does not exist.
    expect(turn.citations).toEqual([]);
    expect(turn.articles).toEqual([]);
  });
  it('a shop answer is not a guide page', async () => {
    await post({ question: QUESTION, answer: ANSWER }).expect(201);
    const { body } = await request(h.server).get('/api/v1/guide').expect(200);
    expect(body.items).toEqual([]);
  });
  it('closes the question it answers', async () => {
    const gap = await h.db.advisorGap.create({ data: { canonical: 'parking', kind: 'SHOP_FACT' } });
    await post({ question: QUESTION, answer: ANSWER, gapId: gap.id }).expect(201);
    expect((await h.db.advisorGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe(
      'ANSWERED',
    );
  });
  it('a technical question goes to the engineer, however sure the owner is', async () => {
    const technical = await h.db.advisorGap.create({
      data: { canonical: 'how to cure', kind: 'NO_ARTICLE' },
    });
    const { body } = await post({
      question: 'How long to cure?',
      answer: 'About a while.',
      gapId: technical.id,
    }).expect(400);
    expect(body.error.code).toBe('ADVISOR_NOT_SHOP_FACT');
  });
  it.each([
    [
      'a structural question',
      { question: 'Slab mein kitna sariya lagega?', answer: 'Humare hisaab se thoda.' },
    ],
    [
      'a structural answer',
      { question: 'What is your advice?', answer: 'Slab mein 12 mm sariya lagega.' },
    ],
    ['a mix', { question: 'Masala kaisa ho?', answer: 'Use a 1:2:4 mix for the slab.' }],
    [
      'a safety verdict',
      { question: 'Crack ka kya?', answer: 'This crack is safe, do not worry.' },
    ],
    ['a script', { question: 'Parking?', answer: '<script>alert(1)</script> Parking is fine.' }],
  ])('refuses %s', async (_name, body) => {
    const { body: reply } = await post(body).expect(400);
    expect(reply.error.code).toBe('ADVISOR_NOT_SHOP_FACT');
    expect(await h.db.knowledgeArticle.count({ where: { kind: 'SHOP' } })).toBe(0);
  });
  it.each([
    ['a link', 'See https://evil.example for this.'],
    ['markup', '<b>Yes</b>, parking is fine.'],
    ['Devanagari', 'दुकान के पास जगह है'],
    ['a promise', 'We guarantee a place for you.'],
    ['a material not stocked', 'We also keep putty.'],
    ['far too many words', 'word '.repeat(130)],
  ])('refuses %s', async (_name, words) => {
    const { body } = await post({ question: QUESTION, answer: words }).expect(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });
  it('takes out a phone number the owner typed', async () => {
    const { body } = await post({
      question: QUESTION,
      answer: 'Yes, call 9876543210 before you come.',
    }).expect(201);
    expect(body.bodyEn).not.toContain('9876543210');
  });
  it('can be taken back, and is gone from answers at once', async () => {
    const { body } = await post({ question: QUESTION, answer: ANSWER }).expect(201);
    const list = await request(h.server).get(`${api}/shop-answers`).set(as('advowner')).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toContain(body.id);
    await request(h.server)
      .post(`${api}/shop-answers/${body.id}/retire`)
      .set(as('advowner'))
      .send({})
      .expect(201);
    const device = await newDevice(h.server);
    const turn = await answer(
      h.server,
      device,
      'What is the address and location of the parking place for a tractor at the shop',
    );
    expect(turn.text).not.toBe(ANSWER);
    await request(h.server)
      .post(`${api}/shop-answers/nope/retire`)
      .set(as('advowner'))
      .send({})
      .expect(404);
  });
  it('a guide cannot be retired from here', async () => {
    await sync(h.db, signedForTest(['cement-storage']));
    const guide = await h.db.knowledgeArticle.findUniqueOrThrow({
      where: { slug: 'cement-storage' },
    });
    await request(h.server)
      .post(`${api}/shop-answers/${guide.id}/retire`)
      .set(as('advowner'))
      .send({})
      .expect(404);
  });
  it('refuses an unknown field, or an empty body', async () => {
    await post({ question: QUESTION, answer: ANSWER, status: 'DRAFT' }).expect(400);
    await post({}).expect(400);
  });
});

describe('the operator', () => {
  it('sees numbers only, never a customer’s words', async () => {
    aiOn();
    await sync(h.db, signedForTest());
    const device = await newDevice(h.server);
    await answer(
      h.server,
      device,
      'How should I store cement at site? I am Ramesh from Kankarbagh',
    );
    await answer(h.server, device, 'chhat mein kitna sariya lagega');
    const { body } = await request(h.server).get(`${api}/health`).set(as('advtech')).expect(200);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/Ramesh|Kankarbagh|sariya|store cement/);
    expect(body.today.turns).toMatchObject({ CHECKED: 1, FIXED: 1 });
    expect(body.money.todayPaise).toBeGreaterThan(0);
    expect(body.money.todayCapPaise).toBe(1000);
    expect(body.money.monthCapPaise).toBe(30000);
    expect(body.signedArticlesLive).toBe(12);
    expect(body.notReady).toEqual([]);
    expect(body.askEnabled).toBe(true);
    expect(body.lastEval).toBeNull();
  });
  it('says plainly why the AI is off', async () => {
    const { body } = await request(h.server).get(`${api}/health`).set(as('advowner')).expect(200);
    expect(body.askEnabled).toBe(false);
    expect(body.notReady).toEqual(['ASK_NOT_ENABLED', 'NO_PROVIDER']);
    expect(body.provider).toBe('fallback');
  });
  it('can stop the AI at once, and start it again', async () => {
    aiOn();
    await sync(h.db, signedForTest());
    const stop = await request(h.server)
      .patch(`${api}/settings`)
      .set(as('advtech'))
      .send({ aiPaused: true })
      .expect(200);
    expect(stop.body.aiPaused).toBe(true);
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.level).toBe('FALLBACK');
    expect((await request(h.server).get('/api/v1/client-config')).body.askEnabled).toBe(false);
    await request(h.server)
      .patch(`${api}/settings`)
      .set(as('advtech'))
      .send({ aiPaused: false })
      .expect(200);
    expect((await request(h.server).get('/api/v1/client-config')).body.askEnabled).toBe(true);
    expect(
      await h.db.auditLog.count({
        where: { event: 'ADVISOR_SETTINGS_CHANGED', actorId: 'advtech' },
      }),
    ).toBe(2);
  });
  it('refuses a setting that does not exist, or nothing at all', async () => {
    await request(h.server).patch(`${api}/settings`).set(as('advowner')).send({}).expect(400);
    await request(h.server)
      .patch(`${api}/settings`)
      .set(as('advowner'))
      .send({ askEnabled: true })
      .expect(400);
    await request(h.server)
      .patch(`${api}/settings`)
      .set(as('advowner'))
      .send({ aiPaused: 'yes' })
      .expect(400);
  });
});

describe('the words on the desk', () => {
  it('every audit event here reads as a sentence in both languages', async () => {
    const { en, hinglish } = await import('@shiv/i18n');
    for (const name of [
      'ADVISOR_CONTENT_SYNCED',
      'ADVISOR_GAP_DECIDED',
      'ADVISOR_SHOP_ANSWER_APPROVED',
      'ADVISOR_SHOP_ANSWER_RETIRED',
      'ADVISOR_SETTINGS_CHANGED',
    ]) {
      expect(en).toHaveProperty([`owner.activity.event.${name}`]);
      expect((hinglish as Record<string, string>)[`owner.activity.event.${name}`]).not.toMatch(
        /[ऀ-ॿ]/,
      );
    }
  });
});
