import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import type { INestApplication } from '@nestjs/common';
import { advisorDeviceHeader, type AdvisorEvent, type AdvisorTurnView } from '@shiv/shared';
import request from 'supertest';
import { loadContent, syncContent, type LoadedContent, type Signoff } from '../src/advisor/content';
import {
  AdvisorModels,
  noUsage,
  type AdvisorModel,
  type AnswerCall,
  type AnswerPart,
  type TriageCall,
  type TriageResult,
} from '../src/advisor/provider';
import { AdvisorRetrieve } from '../src/advisor/retrieve';
import { getConfig, type Config } from '../src/config';
import { Db } from '../src/db';

/** Call before importing the app. Every advisor test runs on its own throwaway database. */
export function advisorTestEnv(secret = 'advisor-test-only-secret-not-for-production') {
  if (existsSync('.env.test')) loadEnvFile('.env.test');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OTP_PROVIDER = 'mock';
  process.env.OTP_HASH_SECRET = secret;
  process.env.CORS_ORIGINS = 'http://localhost:3000';
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test'))
    throw new Error('These tests require a dedicated TEST_DATABASE_URL ending in _test.');
}

/** A model that does exactly what a test tells it to, and remembers what it was sent. */
export class FakeModel implements AdvisorModel {
  readonly triageName = 'fake-triage';
  readonly answerName = 'fake-answer';
  triageCalls: TriageCall[] = [];
  answerCalls: AnswerCall[] = [];
  triageWith: (call: TriageCall) => Promise<TriageResult> | TriageResult = (call) => ({
    output: {
      route: 'GENERAL_ADVICE',
      englishQuery: call.question.slice(0, 100),
      articleIds: [],
      catalogTerms: [],
      pincode: null,
    },
    usage: { inputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 50 },
    stopReason: 'end_turn',
  });
  answerWith: (call: AnswerCall) => AsyncIterable<AnswerPart> | AnswerPart[] = (call) => [
    { type: 'text', text: 'Keep the bags dry and off the floor. ' },
    ...(call.chunks.length
      ? ([
          { type: 'citation', searchResultIndex: 0, citedText: call.chunks[0]!.blocks[0]! },
        ] as AnswerPart[])
      : []),
    { type: 'text', text: 'Ask your mason if you are not sure.' },
    {
      type: 'finish',
      stopReason: 'end_turn',
      usage: { inputTokens: 900, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 60 },
    },
  ];
  async triage(call: TriageCall) {
    this.triageCalls.push(call);
    return this.triageWith(call);
  }
  async *answer(call: AnswerCall): AsyncIterable<AnswerPart> {
    this.answerCalls.push(call);
    for await (const part of this.answerWith(call)) yield part;
  }
  get calls() {
    return this.triageCalls.length + this.answerCalls.length;
  }
  reset() {
    this.triageCalls = [];
    this.answerCalls = [];
  }
}

/** A model reply that says just these words and ends normally. */
export const says =
  (text: string, cite = true): ((call: AnswerCall) => AnswerPart[]) =>
  (call) => [
    ...(cite && call.chunks.length
      ? ([{ type: 'citation', searchResultIndex: 0, citedText: 'cited' }] as AnswerPart[])
      : []),
    { type: 'text', text },
    { type: 'finish', stopReason: 'end_turn', usage: noUsage },
  ];

export type Harness = {
  app: INestApplication;
  server: Server;
  db: Db;
  fake: FakeModel;
  retrieve: AdvisorRetrieve;
};

export async function startAdvisor(): Promise<Harness> {
  const { createApp } = await import('../src/app');
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const fake = new FakeModel();
  app.get(AdvisorModels).override = fake;
  return {
    app,
    server: app.getHttpServer(),
    db: app.get(Db),
    fake,
    retrieve: app.get(AdvisorRetrieve),
  };
}

/** Clears what Ask keeps, and every budget, between tests. Other tables are left alone. */
export async function clearAdvisor(db: Db) {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AdvisorTurn", "AdvisorConversation", "AdvisorGap", "AdvisorSettings", "AuthRateLimit" CASCADE',
  );
}

export async function clearGuide(db: Db) {
  await db.$executeRawUnsafe('TRUNCATE TABLE "KnowledgeChunk", "KnowledgeArticle" CASCADE');
}

/** What a test config needs to turn the AI on or off, with the rest left as it is. */
export function setConfig(values: Partial<Config>) {
  Object.assign(getConfig(), values);
}
export const aiOn = () => setConfig({ ASK_ENABLED: true, ADVISOR_PROVIDER: 'simulation' });
export const aiOff = () => setConfig({ ASK_ENABLED: false, ADVISOR_PROVIDER: 'fallback' });

/**
 * The real articles, signed by a pretend engineer, in the test database only. The real
 * content/advisor/signoff.json stays empty until a real engineer has read them.
 */
export function signedForTest(
  slugs: readonly string[] | 'all' = 'all',
  now = new Date(),
): LoadedContent {
  const content = loadContent();
  const chosen = content.articles.filter(
    (article) => slugs === 'all' || slugs.includes(article.slug),
  );
  const signoffs: Signoff[] = chosen.map((article) => ({
    slug: article.slug,
    sha256: article.sha256,
    reviewer: 'ENG-1',
    on: now.toISOString().slice(0, 10),
    due: new Date(now.getTime() + 365 * 86400000).toISOString().slice(0, 10),
  }));
  return {
    ...content,
    signoffs,
    articles: content.articles.map((article) =>
      chosen.includes(article) ? { ...article, status: 'SIGNED' as const } : article,
    ),
  };
}

export const sync = (db: Db, content: LoadedContent) => syncContent(db, content);

export async function newDevice(server: Server): Promise<string> {
  const { body } = await request(server).post('/api/v1/advisor/device').send({}).expect(201);
  return body.deviceToken as string;
}

export const ask = (
  server: Server,
  device: string,
  text: string,
  extra: Record<string, unknown> = {},
) =>
  request(server)
    .post('/api/v1/advisor/turns')
    .set(advisorDeviceHeader, device)
    .send({ clientTurnId: randomUUID(), text, channel: 'WEB', ...extra });

/** Asks and returns the answer, failing the test if the route did not answer. */
export async function answer(
  server: Server,
  device: string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<AdvisorTurnView> {
  const response = await ask(server, device, text, extra);
  if (response.status !== 201 && response.status !== 200)
    throw new Error(`Expected an answer, got ${response.status}: ${JSON.stringify(response.body)}`);
  return response.body as AdvisorTurnView;
}

/** The events of a streamed answer, in order. */
export function eventsFrom(text: string): AdvisorEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.includes('data: '))
    .map((block) => JSON.parse(block.slice(block.indexOf('data: ') + 6)) as AdvisorEvent);
}

export const seedCatalogue = async (db: Db) => {
  await db.category.createMany({
    data: [
      { id: 'cat-cement', name: 'Cement', slug: 'cement' },
      { id: 'cat-steel', name: 'Steel', slug: 'steel' },
      { id: 'cat-sand', name: 'Sand', slug: 'sand' },
    ],
    skipDuplicates: true,
  });
  const base = { type: 'x', images: [] as string[], description: 'Test', recommendedUse: 'Test' };
  await db.product.createMany({
    data: [
      {
        ...base,
        id: 'ppc',
        name: 'Test Cement PPC',
        brand: 'TestBrand',
        categoryId: 'cat-cement',
        grade: 'PPC',
        unit: 'bag',
        packSize: '50 kg',
        pricePaise: 41000,
        stock: 137,
      },
      {
        ...base,
        id: 'tmt',
        name: 'Test TMT Bar 12mm',
        brand: 'TestSteel',
        categoryId: 'cat-steel',
        grade: 'Fe 500',
        unit: 'kg',
        packSize: '',
        pricePaise: 6250,
        stock: 912,
      },
      {
        ...base,
        id: 'sand',
        name: 'Test River Balu',
        brand: 'Local',
        categoryId: 'cat-sand',
        grade: 'Coarse',
        unit: 'cft',
        packSize: '',
        pricePaise: 5500,
        stock: 0,
        stockMode: 'AVAILABILITY',
      },
      {
        ...base,
        id: 'special',
        name: 'Test Special Cement',
        brand: 'TestBrand',
        categoryId: 'cat-cement',
        grade: 'OPC 53',
        unit: 'bag',
        packSize: '50 kg',
        pricePaise: 99900,
        stock: 0,
        sourcing: 'ON_REQUEST',
      },
      {
        ...base,
        id: 'gone',
        name: 'Test Old Cement',
        brand: 'TestBrand',
        categoryId: 'cat-cement',
        grade: 'PPC',
        unit: 'bag',
        packSize: '50 kg',
        pricePaise: 1,
        stock: 5,
        active: false,
      },
    ],
    skipDuplicates: true,
  });
  await db.deliveryZone.upsert({
    where: { id: 'zone-advisor' },
    update: {},
    create: {
      id: 'zone-advisor',
      name: 'Patna Test',
      deliveryFeePaise: 50000,
      estimate: 'Tomorrow by noon, guaranteed',
      pincodes: { create: { pincode: '800020' } },
    },
  });
};
