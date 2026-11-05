import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { advisorDeviceHeader, advisorWords } from '@shiv/shared';
import request from 'supertest';
import {
  advisorTestEnv,
  aiOff,
  aiOn,
  answer,
  ask,
  clearAdvisor,
  clearGuide,
  eventsFrom,
  newDevice,
  says,
  seedCatalogue,
  setConfig,
  signedForTest,
  startAdvisor,
  sync,
  type Harness,
} from './advisor-helper';
import { addPerson, tokenFor } from './staff-helper';
import { loadContent } from '../src/advisor/content';
import { purgeAdvisor } from '../src/advisor/core';

advisorTestEnv();
let h: Harness;
const api = '/api/v1';

beforeAll(async () => {
  h = await startAdvisor();
  await h.db.$executeRawUnsafe(
    'TRUNCATE TABLE "PriceUpdateBatch", "RateSource", "FinancialMovement", "User", "Category", "Product", "Order", "Quote", "AuditLog", "OtpChallenge", "AuthRateLimit", "DeliveryZone", "StoreSettings" RESTART IDENTITY CASCADE',
  );
  await seedCatalogue(h.db);
  await addPerson(h.db, { id: 'advisorcustomer', phone: '+919000000301' });
}, 30000);
afterAll(async () => {
  await h?.app.close();
});
beforeEach(async () => {
  aiOff();
  h.fake.reset();
  h.fake.triageWith = new (h.fake.constructor as new () => typeof h.fake)().triageWith;
  h.fake.answerWith = new (h.fake.constructor as new () => typeof h.fake)().answerWith;
  setConfig({
    ADVISOR_DAILY_BUDGET_MICRO_USD: 105_263,
    ADVISOR_MONTHLY_BUDGET_MICRO_USD: 3_157_894,
  });
  await clearAdvisor(h.db);
  await clearGuide(h.db);
  vi.restoreAllMocks();
});

describe('with no AI at all', () => {
  it('nothing can call a model, and Ask stays hidden', async () => {
    const { body } = await request(h.server).get(`${api}/client-config`).expect(200);
    expect(body.askEnabled).toBe(false);
    const device = await newDevice(h.server);
    await answer(h.server, device, 'How do I keep cement dry at site?');
    expect(h.fake.calls).toBe(0);
  });

  it.each([
    ['S1', '1000 sq ft ki chhat mein kitna sariya lagega?', 'STRUCTURAL', 'STRUCTURAL'],
    ['S4', 'नींव कितनी गहरी खोदनी चाहिए, दो मंजिल के लिए?', 'STRUCTURAL', 'STRUCTURAL'],
    ['S10', 'Shuttering kitne din baad khol sakte hain?', 'STRUCTURAL', 'STRUCTURAL_WORK'],
    ['S11', '10x10 ft slab, how many bags of cement?', 'STRUCTURAL', 'STRUCTURAL_WORK'],
    [
      'D1',
      'Deewar mein badi daraar aa gayi hai aur badh rahi hai, plaster gir raha hai',
      'DANGER_NOW',
      'DANGER_NOW',
    ],
  ] as const)('%s gets the right fixed text and no cards', async (_id, question, route, key) => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, question);
    expect(turn.route).toBe(route);
    expect(turn.level).toBe('FIXED');
    expect(
      turn.text === advisorWords(key, 'en') || turn.text === advisorWords(key, 'hinglish'),
    ).toBe(true);
    expect(turn.products).toEqual([]);
    expect(h.fake.calls).toBe(0);
  });

  it('the same is true with the switch on but no provider', async () => {
    setConfig({ ASK_ENABLED: true, ADVISOR_PROVIDER: 'fallback' });
    const device = await newDevice(h.server);
    expect((await answer(h.server, device, 'slab mein kitna sariya')).route).toBe('STRUCTURAL');
    await answer(h.server, device, 'cement kaise rakhein');
    expect(h.fake.calls).toBe(0);
    const { body } = await request(h.server).get(`${api}/client-config`).expect(200);
    expect(body.askEnabled).toBe(false);
  });

  it('asks a person when nothing is signed, and notes the question', async () => {
    await sync(h.db, loadContent());
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.level).toBe('FIXED');
    expect(turn.text).toBe(advisorWords('ASK_PERSON', 'en'));
    expect(turn.citations).toEqual([]);
    expect(await h.db.advisorGap.count({ where: { kind: 'NO_ARTICLE' } })).toBe(1);
  });

  it('shows signed text word for word, labelled honestly', async () => {
    const content = signedForTest(['cement-storage']);
    await sync(h.db, content);
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.level).toBe('FALLBACK');
    expect(turn.label).toBe('FROM_GUIDE');
    const article = content.articles.find((item) => item.slug === 'cement-storage')!;
    expect(turn.text).toBe(article.sections[0]!.blocks.join(' '));
    expect(turn.citations[0]).toMatchObject({
      slug: 'cement-storage',
      href: expect.stringContaining('/guide/cement-storage#'),
    });
    expect(turn.followups.length).toBeGreaterThan(0);
    expect(h.fake.calls).toBe(0);
  });

  it('understands Hindi and answers in Roman script', async () => {
    await sync(h.db, signedForTest(['cement-storage']));
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'सीमेंट को कैसे रखें?');
    expect(turn.language).toBe('hinglish');
    expect(turn.citations[0]?.slug).toBe('cement-storage');
  });

  it('reads rates live from the database, with no count of stock', async () => {
    const device = await newDevice(h.server);
    const first = await answer(h.server, device, 'Aaj cement ka rate kya hai?');
    expect(first.route).toBe('CATALOG');
    expect(first.level).toBe('FIXED');
    const card = first.products.find((product) => product.id === 'ppc')!;
    expect(card).toMatchObject({ pricePaise: 41000, availability: 'IN_STOCK', isSample: true });
    expect(JSON.stringify(first)).not.toMatch(/"stock"|137/);
    expect(first.products.map((product) => product.id)).not.toContain('gone');
    await h.db.product.update({ where: { id: 'ppc' }, data: { pricePaise: 42500 } });
    const later = await request(h.server)
      .get(`${api}/advisor/turns/${first.id}`)
      .set(advisorDeviceHeader, device)
      .expect(200);
    expect(
      later.body.products.find((product: { id: string }) => product.id === 'ppc').pricePaise,
    ).toBe(42500);
    await h.db.product.update({ where: { id: 'ppc' }, data: { pricePaise: 41000 } });
  });

  it('never shows a list rate for an item only got to order', async () => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'cement ka rate');
    const special = turn.products.find((product) => product.id === 'special')!;
    expect(special.pricePaise).toBeNull();
    expect(special.availability).toBe('ON_REQUEST');
  });

  it('finds sariya by how people spell it (L3)', async () => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'sarya kitne ka kilo hai');
    expect(turn.route).toBe('CATALOG');
    expect(turn.products.map((product) => product.id)).toContain('tmt');
  });

  it('says what is in stock, never how much (P7)', async () => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'Stock mein kitni bori hai?');
    expect(turn.route).toBe('CATALOG');
    expect(turn.text).toBe(advisorWords('AVAILABILITY_LINE', 'hinglish'));
    expect(JSON.stringify(turn)).not.toContain('137');
  });

  it('notes what the shop does not list (P9), and does not talk about it', async () => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'Aapke yahan tiles milte hain?');
    expect(turn.text).toBe(advisorWords('NOT_LISTED', 'hinglish'));
    expect(turn.products).toEqual([]);
    expect(await h.db.advisorGap.count({ where: { kind: 'NOT_LISTED' } })).toBe(1);
  });

  it('gives delivery terms from the database, and no free-text promise', async () => {
    const device = await newDevice(h.server);
    const yes = await answer(h.server, device, 'Do you deliver to 800020?');
    expect(yes.delivery).toMatchObject({ serviceable: true, deliveryFeePaise: 50000 });
    expect(JSON.stringify(yes)).not.toMatch(/guaranteed|Tomorrow by noon/);
    const no = await answer(h.server, device, 'delivery to pincode 110001');
    expect(no.delivery).toMatchObject({ serviceable: false });
    const promise = await answer(h.server, device, 'Will you deliver by tomorrow?');
    expect(promise.text).toBe(advisorWords('DELIVERY_PROMISE', 'en'));
  });

  it('adds nothing about the shop the family has not approved (P5, P6)', async () => {
    const device = await newDevice(h.server);
    const hours = await answer(h.server, device, 'Dukaan kab khulti hai? Number do.');
    expect(hours.route).toBe('SHOP_FACT');
    expect(hours.text).toBe(advisorWords('SHOP_NOT_ADDED', 'hinglish'));
    const old = await answer(
      h.server,
      device,
      'How old is your shop? Are you an UltraTech dealer?',
    );
    expect(old.text).toBe(advisorWords('SHOP_NOT_ADDED', 'en'));
    expect(await h.db.advisorGap.count({ where: { kind: 'SHOP_FACT' } })).toBe(2);
  });

  it('gives an estimate only from signed coefficients, showing the sizes back (E1, E4)', async () => {
    const device = await newDevice(h.server);
    const bricks = await answer(
      h.server,
      device,
      '30 ft lambi, 10 ft oonchi, 9 inch deewar mein kitni eent?',
    );
    expect(bricks.route).toBe('ESTIMATE');
    expect(bricks.estimate).toMatchObject({
      status: 'NOT_AVAILABLE',
      inputs: { lengthFt: 30, heightFt: 10, thicknessInch: 9 },
    });
    expect(bricks.text).toBe(advisorWords('ESTIMATE_NOT_AVAILABLE', 'hinglish'));
    const plaster = await answer(h.server, device, '500 sq ft plaster 12 mm, 1:4, kitna cement?');
    expect(plaster.route).toBe('ESTIMATE');
    expect(plaster.text).toBe(advisorWords('ESTIMATE_NOT_AVAILABLE', 'hinglish'));
    expect(plaster.text).not.toMatch(/\d/);
  });

  it('switches language when asked, for the rest of the conversation (L2)', async () => {
    const device = await newDevice(h.server);
    const first = await answer(h.server, device, 'chhat mein kitna sariya lagega');
    expect(first.language).toBe('hinglish');
    const second = await answer(h.server, device, 'English mein batao');
    expect(second.language).toBe('en');
    expect(second.text).toBe(advisorWords('STRUCTURAL', 'en'));
    const third = await answer(h.server, device, 'chhat mein kitna sariya lagega');
    expect(third.language).toBe('en');
  });
});

describe('the guide', () => {
  it('holds nothing until an engineer has signed', async () => {
    await sync(h.db, loadContent());
    const { body } = await request(h.server).get(`${api}/guide`).expect(200);
    expect(body.items).toEqual([]);
    await request(h.server).get(`${api}/guide/cement-storage`).expect(404);
    expect(await h.db.knowledgeArticle.count({ where: { status: 'DRAFT' } })).toBe(12);
    expect(await h.db.knowledgeArticle.count({ where: { status: 'PUBLISHED' } })).toBe(0);
  });

  it('shows a signed article, with the month it was checked and no reviewer', async () => {
    await sync(h.db, signedForTest(['cement-storage']));
    const list = await request(h.server).get(`${api}/guide`).expect(200);
    expect(list.body.items.map((item: { slug: string }) => item.slug)).toEqual(['cement-storage']);
    const { body } = await request(h.server).get(`${api}/guide/cement-storage`).expect(200);
    expect(body.checkedOn).toMatch(/^\d{4}-\d{2}$/);
    expect(body.sections.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/ENG-|reviewer|sha256/);
    await request(h.server).get(`${api}/guide/opc-ppc-psc`).expect(404);
  });

  it('editing one word and syncing takes the article down', async () => {
    const signed = signedForTest(['cement-storage']);
    await sync(h.db, signed);
    await request(h.server).get(`${api}/guide/cement-storage`).expect(200);
    const article = signed.articles.find((item) => item.slug === 'cement-storage')!;
    const edited = {
      ...signed,
      articles: signed.articles.map((item) =>
        item === article ? { ...item, sha256: 'f'.repeat(64) } : item,
      ),
    };
    const result = await sync(h.db, edited);
    expect(result.published).toEqual([]);
    await request(h.server).get(`${api}/guide/cement-storage`).expect(404);
    const row = await h.db.knowledgeArticle.findUniqueOrThrow({
      where: { slug: 'cement-storage' },
    });
    expect(row).toMatchObject({ status: 'DRAFT', reviewerKey: null, reviewedAt: null });
    expect(row.version).toBe(2);
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.citations).toEqual([]);
  });

  it('an article past its review date drops out by itself', async () => {
    await sync(h.db, signedForTest(['cement-storage']));
    await h.db.knowledgeArticle.update({
      where: { slug: 'cement-storage' },
      data: { reviewDueAt: new Date(Date.now() - 1000) },
    });
    await request(h.server).get(`${api}/guide/cement-storage`).expect(404);
    expect((await request(h.server).get(`${api}/guide`).expect(200)).body.items).toEqual([]);
    expect(await h.retrieve.search('store cement dry at site')).toEqual([]);
  });

  it('a file that is gone is retired', async () => {
    await sync(h.db, signedForTest(['cement-storage']));
    const result = await sync(h.db, { articles: [], signoffs: [], errors: [] });
    expect(result.retired.length).toBe(12);
    await request(h.server).get(`${api}/guide/cement-storage`).expect(404);
  });

  it('the database itself refuses a published guide with no reviewer', async () => {
    await sync(h.db, loadContent());
    await expect(
      h.db.knowledgeArticle.update({
        where: { slug: 'cement-storage' },
        data: { status: 'PUBLISHED' },
      }),
    ).rejects.toThrow();
  });

  it('refuses a bad slug without touching the database', async () => {
    await request(h.server)
      .get(`${api}/guide/${encodeURIComponent("x' OR 1=1 --")}`)
      .expect(404);
  });
});

describe('with the AI on', () => {
  beforeEach(async () => {
    aiOn();
    await sync(h.db, signedForTest());
  });

  it('answers from signed articles, cites them, and counts what it cost', async () => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.level).toBe('CHECKED');
    expect(turn.label).toBe('CHECKED');
    expect(turn.text).toBe(
      'Keep the bags dry and off the floor. Ask your mason if you are not sure.',
    );
    expect(turn.citations.length).toBeGreaterThan(0);
    expect(h.fake.triageCalls.length).toBe(1);
    expect(h.fake.answerCalls.length).toBe(1);
    const row = await h.db.advisorTurn.findUniqueOrThrow({ where: { id: turn.id } });
    expect(row.modelAnswer).toBe('fake-answer');
    expect(row.inputTokens).toBeGreaterThan(0);
    expect(row.cachedTokens).toBe(100);
    expect(row.costMicroUsd).toBeGreaterThan(0);
    expect(
      await request(h.server)
        .get(`${api}/client-config`)
        .then((res) => res.body.askEnabled),
    ).toBe(true);
  });

  it('passes the question and sections as data, and history only from our own store', async () => {
    const device = await newDevice(h.server);
    await answer(h.server, device, 'How should I store cement at site?');
    await answer(h.server, device, 'And what about the rainy season for cement storage?');
    const call = h.fake.answerCalls[1]!;
    expect(call.history).toEqual([
      { question: 'How should I store cement at site?', answer: expect.stringContaining('dry') },
    ]);
    expect(call.chunks.every((chunk) => chunk.checkedOn !== null)).toBe(true);
  });

  it('never sends a draft to the model', async () => {
    await sync(h.db, signedForTest(['opc-ppc-psc']));
    const device = await newDevice(h.server);
    await answer(h.server, device, 'How should I store cement at site?');
    const sent = h.fake.answerCalls.flatMap((call) => call.chunks.map((chunk) => chunk.slug));
    expect(sent).not.toContain('cement-storage');
    expect(h.fake.triageCalls[0]!.system).not.toContain('cement-storage');
  });

  it('a question with no article gets the General level, with no numbers, and is noted (G9)', async () => {
    await sync(h.db, { articles: [], signoffs: [], errors: [] });
    await h.db.knowledgeArticle.updateMany({ data: { status: 'RETIRED' } });
    h.fake.answerWith = says(
      'A DPC is a layer that stops damp rising up a wall. Ask your engineer about yours.',
      false,
    );
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'DPC kya hota hai?');
    expect(turn.level).toBe('GENERAL');
    expect(turn.label).toBe('GENERAL');
    expect(await h.db.advisorGap.count({ where: { kind: 'NO_ARTICLE' } })).toBe(1);
  });

  it('with General turned off, says to ask a person instead', async () => {
    await sync(h.db, { articles: [], signoffs: [], errors: [] });
    await h.db.advisorSettings.upsert({
      where: { id: 'advisor' },
      create: { id: 'advisor', generalEnabled: false },
      update: { generalEnabled: false },
    });
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'DPC kya hota hai?');
    expect(turn.text).toBe(advisorWords('ASK_PERSON', 'hinglish'));
    expect(h.fake.answerCalls.length).toBe(0);
  });

  it('an owner pausing the AI takes effect on the very next question', async () => {
    const device = await newDevice(h.server);
    await h.db.advisorSettings.upsert({
      where: { id: 'advisor' },
      create: { id: 'advisor', aiPaused: true },
      update: { aiPaused: true },
    });
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.level).toBe('FALLBACK');
    expect(h.fake.calls).toBe(0);
    expect((await request(h.server).get(`${api}/client-config`)).body.askEnabled).toBe(false);
  });

  it('the same question costs nothing the second time (decision: answered from a cache)', async () => {
    const one = await newDevice(h.server);
    const two = await newDevice(h.server);
    const first = await answer(h.server, one, 'How should I store cement at site?');
    h.fake.reset();
    const second = await answer(h.server, two, 'how should I store cement at site');
    expect(second.level).toBe('CHECKED');
    expect(second.text).toBe(first.text);
    expect(h.fake.calls).toBe(0);
    const row = await h.db.advisorTurn.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.modelAnswer).toBe('cache');
    expect(row.costMicroUsd).toBe(0);
  });

  it('a disliked answer is never served from the cache again', async () => {
    const one = await newDevice(h.server);
    const first = await answer(h.server, one, 'How should I store cement at site?');
    await request(h.server)
      .post(`${api}/advisor/turns/${first.id}/feedback`)
      .set(advisorDeviceHeader, one)
      .send({ value: 'NOT_RIGHT', reason: 'WRONG' })
      .expect(201);
    h.fake.reset();
    const two = await newDevice(h.server);
    await answer(h.server, two, 'How should I store cement at site?');
    expect(h.fake.answerCalls.length).toBe(1);
  });

  it('triage failing means floor rules plus search, not an error', async () => {
    h.fake.triageWith = () => {
      throw new Error('PRIVATE_PROVIDER_ERROR');
    };
    const device = await newDevice(h.server);
    const response = await ask(h.server, device, 'How should I store cement at site?').expect(201);
    expect(response.body.level).toBe('CHECKED');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_PROVIDER_ERROR');
    const row = await h.db.advisorTurn.findUniqueOrThrow({ where: { id: response.body.id } });
    expect(row.gateFlags).toContain('TRIAGE_FAILED');
  });

  it('a fooled or bad triage reply cannot break out of what it may name', async () => {
    h.fake.triageWith = () => ({
      output: {
        route: 'GENERAL_ADVICE',
        englishQuery: 'x'.repeat(9000),
        articleIds: ['not-a-real-article', 'staff-salaries'],
        catalogTerms: ['y'.repeat(9000)],
        pincode: 'DROP TABLE',
      },
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
    });
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.citations.every((citation) => citation.slug !== 'not-a-real-article')).toBe(true);
  });

  it('triage naming a structural route gets the fixed text, even past the floor', async () => {
    h.fake.triageWith = () => ({
      output: {
        route: 'STRUCTURAL',
        englishQuery: 'q',
        articleIds: [],
        catalogTerms: [],
        pincode: null,
      },
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
    });
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'something the floor rules did not catch at all');
    expect(turn.route).toBe('STRUCTURAL');
    expect(turn.level).toBe('FIXED');
    expect(h.fake.answerCalls.length).toBe(0);
  });

  it('a provider failing mid-answer shows signed text, labelled, and keeps the reservation', async () => {
    h.fake.answerWith = () => {
      throw new Error('PRIVATE_PROVIDER_ERROR');
    };
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'How should I store cement at site?');
    expect(turn.level).toBe('FALLBACK');
    expect(turn.label).toBe('AI_BUSY');
    const row = await h.db.advisorTurn.findUniqueOrThrow({ where: { id: turn.id } });
    expect(row.gateFlags).toContain('ANSWER_FAILED');
    expect(row.costMicroUsd).toBeGreaterThan(0);
  });

  it('a refusal or a cut-off answer is never shown, whatever text came with it', async () => {
    for (const stopReason of ['refusal', 'max_tokens']) {
      h.fake.answerWith = () => [
        { type: 'citation', searchResultIndex: 0, citedText: 'cited' },
        { type: 'text', text: 'Half of an answer that was stopped' },
        {
          type: 'finish',
          stopReason,
          usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
        },
      ];
      const device = await newDevice(h.server);
      const turn = await answer(h.server, device, 'How should I store cement at site?');
      expect(turn.level).toBe('FALLBACK');
      expect(turn.text).not.toContain('Half of an answer');
      await clearAdvisor(h.db);
    }
  });

  it('shows materials only when the article allows, once, and after the answer', async () => {
    const device = await newDevice(h.server);
    const first = await answer(h.server, device, 'How should I store cement at site?');
    expect(first.products.map((product) => product.id)).toContain('ppc');
    expect(first.nudge).toBe('We sell these. You can buy them anywhere.');
    const second = await answer(h.server, device, 'What about storing cement in the rain?');
    expect(second.nudge).toBeNull();
    await sync(h.db, signedForTest());
    h.fake.triageWith = () => ({
      output: {
        route: 'GENERAL_ADVICE',
        englishQuery: 'damp wall seepage',
        articleIds: ['damp-walls'],
        catalogTerms: [],
        pincode: null,
      },
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      stopReason: 'end_turn',
    });
    const third = await newDevice(h.server);
    const damp = await answer(h.server, third, 'Deewar par seelan aa rahi hai, kya karun?');
    expect(damp.products).toEqual([]);
  });

  it('streams sentences, citations and a final answer, in order', async () => {
    const device = await newDevice(h.server);
    const response = await ask(h.server, device, 'How should I store cement at site?')
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((res, done) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => done(null, data));
      })
      .expect(201);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toBe('no-cache, no-transform');
    expect(response.headers['x-accel-buffering']).toBe('no');
    const events = eventsFrom(response.body as string);
    expect(events[0]!.type).toBe('status');
    expect(events.at(-1)!.type).toBe('done');
    const types = events.map((event) => event.type);
    expect(types).toContain('route');
    expect(types.filter((type) => type === 'text').length).toBe(2);
    expect(types).toContain('cite');
    expect(types).toContain('products');
    // Materials come after the answer, never instead of it.
    expect(types.indexOf('products')).toBeGreaterThan(types.lastIndexOf('text'));
  });
});

describe('the customer’s own turns', () => {
  it('a client dropping the connection still gets the answer later, with no second charge', async () => {
    aiOn();
    await sync(h.db, signedForTest());
    const device = await newDevice(h.server);
    const clientTurnId = randomUUID();
    const first = await ask(h.server, device, 'How should I store cement at site?', {
      clientTurnId,
    }).expect(201);
    const again = await ask(h.server, device, 'How should I store cement at site?', {
      clientTurnId,
    }).expect(200);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.text).toBe(first.body.text);
    expect(h.fake.answerCalls.length).toBe(1);
    const read = await request(h.server)
      .get(`${api}/advisor/turns/${first.body.id}`)
      .set(advisorDeviceHeader, device)
      .expect(200);
    expect(read.body.text).toBe(first.body.text);
  });

  it('feedback is kept, keeps the turn longer, and notes a dislike once', async () => {
    const device = await newDevice(h.server);
    const turn = await answer(h.server, device, 'chhat mein kitna sariya lagega');
    const send = (body: object) =>
      request(h.server)
        .post(`${api}/advisor/turns/${turn.id}/feedback`)
        .set(advisorDeviceHeader, device)
        .send(body);
    await send({ value: 'HELPED', reason: 'WRONG' }).expect(400);
    await send({ value: 'MAYBE' }).expect(400);
    await send({ value: 'HELPED' }).expect(201);
    expect(
      (await send({ value: 'NOT_RIGHT', reason: 'OFFENSIVE' }).expect(201)).body.feedback,
    ).toBe('NOT_RIGHT');
    const row = await h.db.advisorTurn.findUniqueOrThrow({ where: { id: turn.id } });
    expect(row.purgeAt.getTime()).toBeGreaterThan(Date.now() + 80 * 86400000);
    expect(row.feedbackReason).toBe('OFFENSIVE');
  });

  it('Clear deletes this phone’s rows at once, and only this phone’s', async () => {
    const mine = await newDevice(h.server);
    const theirs = await newDevice(h.server);
    await answer(h.server, mine, 'chhat mein kitna sariya lagega');
    const other = await answer(h.server, theirs, 'chhat mein kitna sariya lagega');
    const { body } = await request(h.server)
      .delete(`${api}/advisor/conversations/current`)
      .set(advisorDeviceHeader, mine)
      .expect(200);
    expect(body.cleared).toBe(1);
    expect(await h.db.advisorTurn.count()).toBe(1);
    expect(await h.db.advisorTurn.findUnique({ where: { id: other.id } })).not.toBeNull();
  });

  it('a new device token comes from the server, and each is different', async () => {
    const one = await newDevice(h.server);
    const two = await newDevice(h.server);
    expect(one).not.toBe(two);
    expect(one).toMatch(/^adv1\./);
  });

  it('Cancel stops the answer, and the turn says so', async () => {
    aiOn();
    await sync(h.db, signedForTest());
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.fake.answerWith = async function* (call) {
      yield { type: 'text', text: 'First sentence of the answer. ' };
      await Promise.race([
        gate,
        new Promise((_, reject) =>
          call.signal.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      ]);
      yield {
        type: 'finish',
        stopReason: 'end_turn',
        usage: { inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      };
    };
    const device = await newDevice(h.server);
    const pending = ask(h.server, device, 'How should I store cement at site?').then((res) => res);
    await vi.waitFor(
      async () => expect(await h.db.advisorTurn.count({ where: { status: 'PENDING' } })).toBe(1),
      { timeout: 5000 },
    );
    await vi.waitFor(() => expect(h.fake.answerCalls.length).toBe(1), { timeout: 5000 });
    const row = await h.db.advisorTurn.findFirstOrThrow({ where: { status: 'PENDING' } });
    const cancelled = await request(h.server)
      .post(`${api}/advisor/turns/${row.id}/cancel`)
      .set(advisorDeviceHeader, device)
      .send({})
      .expect(201);
    expect(cancelled.body.status).toBe('CANCELLED');
    const finished = await pending;
    expect(finished.status).toBe(201);
    expect(finished.body.status).toBe('CANCELLED');
    release?.();
  });
});

describe('retention', () => {
  it('forgets on schedule and closes what a crash left open', async () => {
    const device = await newDevice(h.server);
    const old = await answer(h.server, device, 'chhat mein kitna sariya lagega');
    const kept = await answer(h.server, device, 'beam ka size kya hona chahiye');
    await h.db.advisorTurn.update({
      where: { id: old.id },
      data: { purgeAt: new Date(Date.now() - 1000) },
    });
    const crashed = await ask(h.server, device, 'column ka size kya ho');
    await h.db.advisorTurn.update({
      where: { id: crashed.body.id },
      data: { status: 'PENDING', createdAt: new Date(Date.now() - 600000) },
    });
    const gap = await h.db.advisorGap.create({
      data: {
        canonical: 'old question',
        kind: 'NO_ARTICLE',
        status: 'IGNORED',
        lastSeen: new Date(Date.now() - 400 * 86400000),
      },
    });
    const openGap = await h.db.advisorGap.create({
      data: {
        canonical: 'open question',
        kind: 'NO_ARTICLE',
        lastSeen: new Date(Date.now() - 400 * 86400000),
      },
    });
    const result = await purgeAdvisor(h.db);
    expect(result).toMatchObject({ turns: 1, gaps: 1, closed: 1 });
    expect(await h.db.advisorTurn.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await h.db.advisorTurn.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(
      (await h.db.advisorTurn.findUniqueOrThrow({ where: { id: crashed.body.id } })).status,
    ).toBe('DONE');
    expect(await h.db.advisorGap.findUnique({ where: { id: gap.id } })).toBeNull();
    expect(await h.db.advisorGap.findUnique({ where: { id: openGap.id } })).not.toBeNull();
  });

  it('nothing in a turn row or its logs names the person who asked', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => void lines.push(args.join(' ')));
    const device = await newDevice(h.server);
    const turn = await ask(
      h.server,
      device,
      'mera number 9876543210 hai, ramesh@example.com par bhejo, chhat mein kitna sariya',
    )
      .set('Authorization', `Bearer ${tokenFor('advisorcustomer')}`)
      .expect(201);
    const row = await h.db.advisorTurn.findUniqueOrThrow({ where: { id: turn.body.id } });
    expect(row.question).not.toMatch(/9876543210|ramesh/);
    expect(JSON.stringify(row)).not.toContain('advisorcustomer');
    const conversation = await h.db.advisorConversation.findUniqueOrThrow({
      where: { id: row.conversationId },
    });
    expect(JSON.stringify(conversation)).not.toContain('advisorcustomer');
    const logged = lines.join('\n');
    expect(logged).toContain('ADVISOR_TURN');
    expect(logged).not.toMatch(/9876543210|ramesh|sariya/);
  });
});
