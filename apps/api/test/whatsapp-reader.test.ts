import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { istToday } from '@shiv/shared';
import { buildCatalog, normalizeAlias, type Catalog } from '../src/catalog-match';
import { getConfig } from '../src/config';
import { cases } from './whatsapp/cases';
import { parseWebhook, verifyWebhook } from '../src/whatsapp/provider';
import { catalogueForModel, promptBody, responseSchema } from '../src/whatsapp/reader';
import {
  dayToDate,
  finishReading,
  numbersIn,
  readerOutputSchema,
  type ReaderOutput,
  type Reading,
} from '../src/whatsapp/reading';
import {
  allowedPakka,
  buttonMeaning,
  decideReplies,
  isOwnWords,
  lineWords,
  promisesTooMuch,
  renderReply,
  replyButtons,
  replyParams,
  replyWords,
  type AiReplyKind,
  type CardFacts,
} from '../src/whatsapp/replies';
import { renderDecision, decisionTemplate, enqueueDecision } from '../src/whatsapp/decisions';
import { carry, isNight, replyBlock, SendRefused, type GuardInput } from '../src/whatsapp/sender';
import {
  hasTradeWord,
  isHumanAsk,
  isOnlyChat,
  isStop,
  readByRules,
  readDraftAnswer,
} from '../src/whatsapp/rules';
import { mergeLines, sameLines, stageAllows, type DraftLine } from '../src/whatsapp/draft-core';

const row = (
  id: string,
  name: string,
  brand: string,
  slug: string,
  rest: Partial<{ unit: string; nameHi: string; minQuantity: number; quantityStep: number }> = {},
) => ({
  id,
  name,
  brand,
  nameHi: rest.nameHi ?? null,
  unit: rest.unit ?? '50 kg bag',
  packSize: '',
  minQuantity: rest.minQuantity ?? 1,
  quantityStep: rest.quantityStep ?? 1,
  pricePaise: 40000,
  priceUpdatedAt: new Date(),
  category: { slug },
});
const catalog: Catalog = buildCatalog(
  [
    row('ultratech', 'UltraTech Super', 'UltraTech', 'cement', { nameHi: 'अल्ट्राटेक' }),
    row('acc', 'ACC Gold Water Shield', 'ACC', 'cement'),
    row('dalmia', 'Dalmia DSP', 'Dalmia', 'cement'),
    row('tiscon', 'Tata Tiscon 550SD', 'Tata', 'steel', { unit: 'kg · 12 mm' }),
    row('sand', 'Construction sand', 'Local', 'sand'),
    row('gitti', 'Stone aggregate', 'Local', 'aggregates'),
    row('bricks', 'First-class red bricks', 'Local', 'bricks', {
      unit: 'piece',
      minQuantity: 1000,
      quantityStep: 500,
    }),
  ],
  [
    { normalizedAlias: 'acc gold', productId: 'acc' },
    { normalizedAlias: 'एसीसी', productId: 'acc' },
  ],
  [
    'Sipara',
    'Kankarbagh',
    'Boring Road',
    'Danapur',
    'Bailey Road',
    'सिपारा',
    'बाइपास',
    'Rukanpura',
  ],
);
const addDays = (count: number) =>
  new Date(Date.parse(`${istToday()}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);

describe('plan 07 test set', () => {
  it('lists all 78 cases, each tested here or saying where and why not', () => {
    expect(cases.map((row) => row.n)).toEqual(Array.from({ length: 78 }, (_, i) => i + 1));
    for (const item of cases) expect(Boolean(item.text) !== Boolean(item.elsewhere)).toBe(true);
    expect(cases.filter((item) => item.text).length).toBeGreaterThan(40);
  });
  for (const item of cases.filter((row) => row.text))
    it(`case ${item.n}: ${item.text!.slice(0, 50)}`, () => {
      const text = item.text!;
      if (item.gated) {
        expect(isOnlyChat(text) || (!item.known && !hasTradeWord(text, catalog))).toBe(true);
        return;
      }
      const rules = readByRules(text, catalog);
      if (item.byRules === true) expect(rules).not.toBeNull();
      if (item.byRules === false) expect(rules).toBeNull();
      const output = readerOutputSchema.parse(rules ?? item.model);
      const sentAt = item.sentAtIst
        ? new Date(`${istToday()}T${item.sentAtIst}:00+05:30`)
        : new Date(`${istToday()}T11:00:00+05:30`);
      const reading = finishReading(output, {
        catalog,
        text,
        sentAt,
        truncated: false,
        bigOrderPaise: 15000000,
      });
      if (item.intent) expect(reading.intent).toBe(item.intent);
      if (item.language) expect(reading.language).toBe(item.language);
      if (item.place !== undefined) expect(normalizeAlias(reading.placeText)).toBe(item.place);
      if (item.day) expect(reading.dayKind).toBe(item.day);
      if (item.dayOffset !== undefined) expect(reading.deliveryDate).toBe(addDays(item.dayOffset));
      if (item.band !== undefined) expect(reading.band).toBe(item.band);
      for (const flag of item.flags ?? []) expect(reading.flags).toContain(flag);
      if (item.lines) {
        expect(reading.lines).toHaveLength(item.lines.length);
        item.lines.forEach((line, index) => {
          if (line.product !== undefined)
            expect(reading.lines[index]!.productId).toBe(line.product);
          if (line.quantity !== undefined)
            expect(reading.lines[index]!.quantity).toBe(line.quantity);
          if (line.unit !== undefined) expect(reading.lines[index]!.unitWord).toBe(line.unit);
        });
      }
      if (item.replies)
        expect(
          decideReplies(reading, {
            known: item.known ?? false,
            humanQuiet: false,
            freshRatePaise: reading.lines[0]?.productId ? 40000 : null,
            failed: false,
          }),
        ).toEqual(item.replies);
    });
});

const plainOrder = (rest: Partial<ReaderOutput> = {}): ReaderOutput => ({
  intent: 'ORDER',
  language: 'hinglish',
  injectionSuspected: false,
  lines: [
    {
      rawText: '50 bori ultratech',
      productId: 'ultratech',
      quantity: 50,
      unitWord: 'bori',
      evidence: '50 bori ultratech',
      modelConfidence: 0.9,
    },
  ],
  place: null,
  fulfilment: 'UNKNOWN',
  day: { kind: 'UNSPECIFIED', weekday: null, date: null },
  timeWish: null,
  paymentWords: null,
  forWhom: null,
  ...rest,
});
const finish = (output: ReaderOutput, text = '50 bori ultratech', sentAt = new Date()) =>
  finishReading(output, { catalog, text, sentAt, truncated: false, bigOrderPaise: 15000000 });

describe('a reader’s answer is checked, not believed', () => {
  it('a typed order, fully evidenced, is green', () => {
    expect(finish(plainOrder()).band).toBe('GREEN');
  });
  it('a product not on the catalogue is dropped, however sure the model sounds', () => {
    const line = { ...plainOrder().lines[0]!, productId: 'invented' };
    const reading = finish(plainOrder({ lines: [line] }));
    expect(reading.lines[0]!.productId).toBeNull();
    expect(reading.flags).toContain('UNKNOWN_PRODUCT');
    expect(reading.band).toBe('AMBER');
  });
  it('a quote not in the message loses its quantity', () => {
    const line = { ...plainOrder().lines[0]!, evidence: '500 bori ultratech', quantity: 500 };
    const reading = finish(plainOrder({ lines: [line] }));
    expect(reading.lines[0]!.quantity).toBeNull();
    expect(reading.flags).toContain('NO_EVIDENCE');
    expect(reading.band).toBe('AMBER');
  });
  it('a quantity the quote does not state is dropped', () => {
    const line = { ...plainOrder().lines[0]!, quantity: 60 };
    const reading = finish(plainOrder({ lines: [line] }));
    expect(reading.lines[0]!.quantity).toBeNull();
    expect(reading.band).toBe('AMBER');
  });
  it('a model cannot say how much a trolley holds', () => {
    const line = {
      rawText: '1 trolley balu',
      productId: 'sand',
      quantity: 100,
      unitWord: 'trolley',
      evidence: '1 trolley balu',
      modelConfidence: 1,
    };
    const reading = finish(plainOrder({ lines: [line] }), '1 trolley balu');
    expect(reading.lines[0]!.quantity).toBeNull();
    expect(reading.flags).toContain('UNIT_WORD');
  });
  it('tons become kilograms in code', () => {
    const line = {
      rawText: 'saria 2 ton',
      productId: 'tiscon',
      quantity: 2,
      unitWord: 'ton',
      evidence: 'saria 2 ton',
      modelConfidence: 1,
    };
    expect(finish(plainOrder({ lines: [line] }), 'saria 2 ton').lines[0]!.quantity).toBe(2000);
  });
  it('a quantity outside the product’s selling rule is amber', () => {
    const line = {
      rawText: '700 eent',
      productId: 'bricks',
      quantity: 700,
      unitWord: 'piece',
      evidence: '700 eent',
      modelConfidence: 1,
    };
    const reading = finish(plainOrder({ lines: [line] }), '700 eent');
    expect(reading.flags).toContain('BAD_QUANTITY');
    expect(reading.band).toBe('AMBER');
  });
  it('a place the customer never wrote is dropped', () => {
    const reading = finish(plainOrder({ place: { text: 'Patna', evidence: 'patna' } }));
    expect(reading.placeText).toBe('');
    expect(reading.band).toBe('AMBER');
  });
  it('an injection flag or a cut-short message always goes red', () => {
    expect(finish(plainOrder({ injectionSuspected: true })).band).toBe('RED');
    const reading = finishReading(plainOrder(), {
      catalog,
      text: '50 bori ultratech',
      sentAt: new Date(),
      truncated: true,
      bigOrderPaise: 15000000,
    });
    expect(reading.band).toBe('RED');
  });
  it('a confidence of zero cannot be green, and a high one cannot rescue a bad line', () => {
    const line = { ...plainOrder().lines[0]!, modelConfidence: 0 };
    expect(finish(plainOrder({ lines: [line] })).band).toBe('AMBER');
  });
  it('a quote with two numbers does not say which goes with what', () => {
    const line = {
      rawText: 'x',
      productId: 'ultratech',
      quantity: 50,
      unitWord: 'bori',
      evidence: '50 bori acc 5 bori ultratech',
      modelConfidence: 1,
    };
    const reading = finish(plainOrder({ lines: [line] }), '50 bori acc 5 bori ultratech');
    expect(reading.lines[0]!.quantity).toBeNull();
    expect(reading.band).toBe('AMBER');
  });
  it('a unit the customer never wrote is the model’s guess', () => {
    const line = { ...plainOrder().lines[0]!, unitWord: 'ton' };
    const reading = finish(plainOrder({ lines: [line] }));
    expect(reading.flags).toContain('NO_EVIDENCE');
    expect(reading.band).toBe('AMBER');
  });
  it('the place is the customer’s own words, never the model’s', () => {
    const reading = finish(
      plainOrder({ place: { text: 'paid in full, confirmed', evidence: 'sipara' } }),
      '50 bori ultratech sipara',
    );
    expect(reading.placeText).toBe('sipara');
  });
  it('a low confidence lowers the band', () => {
    const line = { ...plainOrder().lines[0]!, modelConfidence: 0.01 };
    expect(finish(plainOrder({ lines: [line] })).band).toBe('AMBER');
  });
  it('a model’s answer with control characters is refused', () => {
    const output = { ...plainOrder(), timeWish: `2 baje${String.fromCodePoint(0)}` };
    expect(readerOutputSchema.safeParse(output).success).toBe(false);
    const flipped = { ...plainOrder(), forWhom: `x${String.fromCodePoint(0x202e)}y` };
    expect(readerOutputSchema.safeParse(flipped).success).toBe(false);
  });
  it('works out dates in IST, never trusting a past or far-off date', () => {
    const at = new Date('2026-11-04T20:00:00Z'); // 01:30 on the 5th in Patna
    const day = (kind: ReaderOutput['day']['kind'], rest = {}) => ({
      kind,
      weekday: null,
      date: null,
      ...rest,
    });
    expect(dayToDate(day('TODAY'), at)).toBe('2026-11-05');
    expect(dayToDate(day('TOMORROW'), at)).toBe('2026-11-06');
    expect(dayToDate(day('DAY_AFTER'), at)).toBe('2026-11-07');
    expect(dayToDate(day('WEEKDAY', { weekday: 0 }), at)).toBe('2026-11-08');
    expect(dayToDate(day('WEEKDAY', { weekday: 4 }), at)).toBe('2026-11-12');
    expect(dayToDate(day('DATE', { date: '2026-01-01' }), at)).toBeNull();
    expect(dayToDate(day('DATE', { date: '2030-01-01' }), at)).toBeNull();
    expect(dayToDate(day('DATE', { date: '2026-11-20' }), at)).toBe('2026-11-20');
    expect(dayToDate(day('UNSPECIFIED'), at)).toBeNull();
  });
  it('reads numbers in digits, words and Devanagari', () => {
    expect(numbersIn('50 bori')).toEqual([50]);
    expect(numbersIn('ek hazaar eent')).toEqual([1000]);
    expect(numbersIn('५० बोरी')).toEqual([50]);
    expect(numbersIn('पचास बोरी')).toEqual([50]);
  });
});

describe('plain rules', () => {
  it('leave anything unsure to the reader', () => {
    for (const text of [
      '5 bori nahi 50 bori',
      'kal gaadi aayegi 500 bag ACC',
      'dhai trolley gitti',
    ])
      expect(readByRules(text, catalog)).toBeNull();
  });
  it('a phone number is never a quantity', () => {
    expect(readByRules('9876543210 ultratech', catalog)).toBeNull();
  });
  it('more words than a place name are not a plain order', () => {
    expect(
      readByRules('50 bori ultratech lekin pehle bhai se pooch lena phir dekhenge', catalog),
    ).toBeNull();
  });
  it('knows a stop word only as the whole message', () => {
    expect(isStop('STOP')).toBe(true);
    expect(isStop('band karo')).toBe(true);
    expect(isStop('gaadi stop kar do mandir ke paas')).toBe(false);
  });
  for (const text of [
    '50 bori ultratech nhi chahiye',
    '50 bori ultratech नही चाहिए',
    '50 bori ultratech rehne do',
    '50 bag acc dispatch ho gaya',
    '50 bori ultratech bheje hain',
    'received 50 bags ultratech',
    '50 bori ultratech kitna hoga',
    '50 bori ultratech hai?',
    '50 bori ultratech teen sau me',
    '50 bori ultratech hai',
    '50 bori ultratech anisabad',
  ])
    it(`leaves "${text}" to the reader, as an unknown word may change everything`, () => {
      expect(readByRules(text, catalog)).toBeNull();
    });
  it('a time is not a quantity, wherever it sits', () => {
    const output = readByRules('acc gold 5 baje chahiye', catalog)!;
    expect(output.lines[0]!.quantity).toBeNull();
    expect(output.timeWish).toBe('5 baje');
  });
  it('a weight on goods sold by the bag needs a person', () => {
    const reading = finish(
      readByRules('50 kg ultratech chahiye', catalog)!,
      '50 kg ultratech chahiye',
    );
    expect(reading.lines[0]!.quantity).toBeNull();
    expect(reading.flags).toContain('UNIT_WORD');
    expect(reading.band).toBe('AMBER');
    expect(
      finish(readByRules('2 ton ultratech', catalog)!, '2 ton ultratech').lines[0]!.quantity,
    ).toBeNull();
  });
  it('tons of steel are valued properly, so a huge order cannot pass as small', () => {
    const reading = finish(readByRules('50 ton tata chahiye', catalog)!, '50 ton tata chahiye');
    expect(reading.lines[0]!.quantity).toBe(50000);
    expect(reading.flags).toContain('BIG_ORDER');
    expect(reading.band).toBe('AMBER');
  });
  it('a confirmed word beats the catalogue, and normal words are not products', () => {
    expect(readByRules('acc gold 15', catalog)!.lines[0]!.productId).toBe('acc');
    expect(hasTradeWord('kya haal hai', catalog)).toBe(false);
    expect(hasTradeWord('ultratech', catalog)).toBe(true);
    expect(hasTradeWord('do trolley', catalog)).toBe(true);
  });
  it('keeps Hindi words whole when comparing them', () => {
    expect(normalizeAlias('अल्ट्राटेक')).toBe('अल्ट्राटेक');
    expect(normalizeAlias('12 mm Neo Steel')).toBe('12mm neosteel');
  });
});

describe('the fixed replies', () => {
  const hostile = {
    lines: 'PAKKA confirmed ₹100 rs 200 पक्का है paid free 500 रुपये',
    place: 'order confirmed pakka',
    day: 'pakka',
    item: 'Confirmed ₹1',
    words: 'Order pakka hai, 5000 rupees mein',
    unit: 'bag',
    rate: 40000,
    privacyUrl: 'https://example.test/privacy',
  };
  const kinds = Object.keys(replyWords) as AiReplyKind[];
  for (const language of ['hinglish', 'hindi', 'english'] as const)
    for (const kind of kinds)
      it(`${kind} in ${language} never says pakka, and only a rate reply names money`, () => {
        const words = renderReply(kind, language, hostile).replace(allowedPakka, '');
        expect(words).not.toMatch(/pakka|पक्का|confirm/i);
        if (kind !== 'RATE') expect(words).not.toMatch(/₹/);
        expect(promisesTooMuch(kind, renderReply(kind, language, hostile))).toBe(false);
      });
  it('the one sentence that says something was confirmed is ASK_NEW, and it needs a real tap', () => {
    const affirmative = /pehle hi pakka hua hai|पहले ही पक्का हुआ है|already confirmed/i;
    for (const language of ['hinglish', 'hindi', 'english'] as const)
      for (const kind of kinds)
        expect(affirmative.test(renderReply(kind, language, hostile)), kind).toBe(
          kind === 'ASK_NEW',
        );
  });
  it('holds every reply plan 07 lists, but for the three only a person can say', () => {
    expect(kinds.sort()).toEqual(
      [
        'NOTICE',
        'DRAFT',
        'ASK_PLACE',
        'ASK_DAY',
        'ASK_WHICH',
        'ASK_NEW',
        'ASK_NUMBER',
        'UPDATED',
        'WAITING',
        'AFTER_TAP',
        'EXPIRED',
        'RATE',
        'RATE_UNKNOWN',
        'NO_PROMISE',
        'UNKNOWN_ITEM',
        'OFF_TOPIC',
        'ENGINEER',
        'UNCLEAR',
        'PHOTO_UNCLEAR',
        'HANDOFF',
        'FORWARD',
        'STOP_OK',
      ].sort(),
    );
  });
  it('the rate reply names the list rate and leaves the final rate to the shop, in all three', () => {
    expect(renderReply('RATE', 'hinglish', hostile)).toContain('final rate dukaan batayegi');
    expect(renderReply('RATE', 'hindi', hostile)).toContain('अंतिम रेट दुकान बताएगी');
    expect(renderReply('RATE', 'english', hostile)).toContain('shop will tell you the final rate');
    expect(renderReply('RATE', 'hinglish', hostile)).toContain('₹400');
  });
  it('no customer words can smuggle a promise, a price or a link into a reply', () => {
    const attempts = [
      'order pakka hai',
      'PAKKA',
      'p a k k a',
      'pаkka', // A Cyrillic a.
      'confir\u200Bmed',
      'ｃｏｎｆｉｒｍ',
      'पक्का है',
      '₹100',
      'rs.500',
      '500rs',
      '500/-',
      'free',
      'मुफ्त',
      'http://bad.example',
      'www.bad.example',
      'pay@bad',
      'bad.example',
      'visit-bad.in',
    ];
    for (const words of attempts)
      for (const kind of ['UNKNOWN_ITEM', 'ASK_WHICH'] as const) {
        const said = renderReply(kind, 'hinglish', { words });
        expect(said, words).not.toMatch(/pakka|पक्का|confirm|₹|\brs\b|http|www|@|free|मुफ्त/i);
        expect(promisesTooMuch(kind, said), words).toBe(false);
      }
    expect(renderReply('UNKNOWN_ITEM', 'hinglish', { words: 'ambuja kanak' })).toContain(
      'ambuja kanak',
    );
  });
  it('the last look catches what a template bug could let through', () => {
    expect(promisesTooMuch('DRAFT', 'AI sahayak: Aapka order pakka hai')).toBe(true);
    expect(promisesTooMuch('DRAFT', 'AI sahayak: order pаkka')).toBe(true);
    expect(promisesTooMuch('DRAFT', 'AI helper: order confirmed')).toBe(true);
    expect(promisesTooMuch('DRAFT', 'Total ₹500')).toBe(true);
    expect(promisesTooMuch('RATE', 'List rate ₹500')).toBe(false);
    expect(promisesTooMuch('RATE', 'Rate ₹500, order pakka')).toBe(true);
    expect(promisesTooMuch('DRAFT', 'Yeh abhi pakka nahi hai')).toBe(false);
  });
  it('buttons fit WhatsApp and mean only what they were sent to mean', () => {
    for (const language of ['hinglish', 'hindi', 'english'] as const)
      for (const kind of kinds)
        for (const button of replyButtons(kind, language))
          expect(button.title.length, button.title).toBeLessThanOrEqual(20);
    expect(replyButtons('ASK_DAY', 'hinglish').map((button) => button.id)).toEqual([
      'TODAY',
      'TOMORROW',
      'NOT_SURE',
    ]);
    expect(buttonMeaning('TOMORROW')).toBe('kal');
    expect(buttonMeaning('CONFIRM')).toBeNull();
    expect(buttonMeaning('constructor')).toBeNull();
    expect(buttonMeaning('__proto__')).toBeNull();
  });
  it('knows our own sentences when they come back', () => {
    expect(isOwnWords('AI sahayak: Aapka message dukaan tak')).toBe(true);
    expect(isOwnWords('एआई सहायक: आपका संदेश')).toBe(true);
    expect(isOwnWords('50 bori ultratech')).toBe(false);
  });
  it('has no way to say a confirmation', () => {
    expect(kinds).not.toContain('CONFIRMED');
    expect(kinds).not.toContain('CONFIRMED_CHANGED');
    expect(kinds).not.toContain('REFUSED');
  });
  it('every reply can be chosen for a reading, and a hostile reading can pick only these', () => {
    const reading = finish(plainOrder({ intent: 'COMPLAINT' }));
    expect(
      decideReplies(reading, {
        known: true,
        humanQuiet: false,
        freshRatePaise: null,
        failed: false,
      }),
    ).toEqual(['HANDOFF']);
  });
  it('with no reading, only a known customer hears anything', () => {
    const context = { humanQuiet: false, freshRatePaise: null, failed: true };
    expect(decideReplies(null, { ...context, known: true })).toEqual(['FORWARD']);
    expect(decideReplies(null, { ...context, known: false })).toEqual([]);
  });
  it('a suspected injection gets silence', () => {
    const reading = finish(plainOrder({ injectionSuspected: true }));
    expect(
      decideReplies(reading, {
        known: true,
        humanQuiet: false,
        freshRatePaise: null,
        failed: false,
      }),
    ).toEqual([]);
  });
});

describe('what the model is told', () => {
  it('holds the catalogue and the words, and nothing about the person', () => {
    const body = JSON.stringify(promptBody('50 bori', catalog).contents);
    expect(body).toContain('UltraTech');
    expect(body).not.toMatch(/pricePaise|40000|stock|balance|phone/i);
    expect(catalogueForModel(catalog)[0]).not.toHaveProperty('pricePaise');
  });
  it('asks for the shape the server checks', () => {
    const fields = Object.keys(readerOutputSchema.shape).sort();
    expect(Object.keys(responseSchema.properties).sort()).toEqual(fields);
    expect([...responseSchema.required].sort()).toEqual(fields);
    expect(responseSchema.properties.intent.enum).toEqual(readerOutputSchema.shape.intent.options);
  });
});

describe('partner formats', () => {
  const secret = 'webhook-secret-for-tests-only';
  const number = '123456789';
  const env = (provider: 'meta' | 'd360' | 'ycloud') => {
    Object.assign(getConfig(), {
      WA_MODE: 'shadow',
      WA_WEBHOOK_PROVIDER: provider,
      WHATSAPP_APP_SECRET: secret,
      WHATSAPP_WEBHOOK_SECRET: secret,
      WHATSAPP_VERIFY_TOKEN: 'verify-token-for-tests',
      WHATSAPP_PHONE_NUMBER_ID: number,
      WA_BUSINESS_PHONE: '+919999900000',
    });
  };
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/shiv_cement');
    vi.stubEnv('OTP_HASH_SECRET', 'unit-test-secret-with-at-least-32-characters');
    env('meta');
  });
  const metaWrap = (field: string, value: Record<string, unknown>) =>
    Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            changes: [
              {
                field,
                value: { metadata: { phone_number_id: number }, ...value },
              },
            ],
          },
        ],
      }),
    );
  const sign = (raw: Buffer) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('checks Meta’s signature on the exact bytes', () => {
    const raw = Buffer.from('{"a":1}');
    expect(verifyWebhook(raw, { 'x-hub-signature-256': sign(raw) })).toBe(true);
    expect(verifyWebhook(Buffer.from('{"a":2}'), { 'x-hub-signature-256': sign(raw) })).toBe(false);
    expect(verifyWebhook(raw, {})).toBe(false);
    expect(verifyWebhook(raw, { 'x-hub-signature-256': 'sha256=00' })).toBe(false);
  });
  it('checks a partner’s secret header', () => {
    env('d360');
    const raw = Buffer.from('{}');
    expect(verifyWebhook(raw, { 'x-shiv-webhook-secret': secret })).toBe(true);
    expect(verifyWebhook(raw, { 'x-shiv-webhook-secret': 'wrong' })).toBe(false);
  });
  it('checks YCloud’s signature, and refuses an old one', () => {
    env('ycloud');
    const raw = Buffer.from('{"id":"1"}');
    const now = 1_800_000_000_000;
    const at = Math.floor(now / 1000);
    const signed = (time: number) =>
      `t=${time},s=${createHmac('sha256', secret).update(`${time}.${raw.toString()}`).digest('hex')}`;
    expect(verifyWebhook(raw, { 'ycloud-signature': signed(at) }, now)).toBe(true);
    expect(verifyWebhook(raw, { 'ycloud-signature': signed(at - 3600) }, now)).toBe(false);
    expect(verifyWebhook(raw, { 'ycloud-signature': `t=${at},s=${'0'.repeat(64)}` }, now)).toBe(
      false,
    );
    expect(verifyWebhook(raw, { 'ycloud-signature': 'nonsense' }, now)).toBe(false);
  });
  it('reads a customer’s message, with who sent it', () => {
    const raw = metaWrap('messages', {
      contacts: [{ wa_id: '919876543210', profile: { name: 'Raju' } }],
      messages: [
        {
          id: 'wamid.1',
          from: '919876543210',
          timestamp: '1800000000',
          type: 'text',
          text: { body: '50 bori' },
        },
      ],
    });
    expect(parseWebhook(raw)).toEqual([
      {
        kind: 'inbound',
        wamid: 'wamid.1',
        phone: '+919876543210',
        bsuid: null,
        profileName: 'Raju',
        type: 'text',
        text: '50 bori',
        sentAt: new Date(1800000000 * 1000),
      },
    ]);
  });
  it('reads a sender hiding their number by WhatsApp’s id for them', () => {
    const raw = metaWrap('messages', {
      contacts: [{ user_id: 'IN.ABC', profile: { name: 'Raju' } }],
      messages: [
        { id: 'w2', from_user_id: 'IN.ABC', timestamp: '1', type: 'text', text: { body: 'x' } },
      ],
    });
    expect(parseWebhook(raw)[0]).toMatchObject({ phone: null, bsuid: 'IN.ABC' });
  });
  it('reads what the owner typed in the app, without its words', () => {
    const raw = metaWrap('smb_message_echoes', {
      message_echoes: [
        {
          id: 'w3',
          from: '919999900000',
          to: '919876543210',
          timestamp: '1',
          type: 'text',
          text: { body: 'ok' },
        },
      ],
    });
    const [event] = parseWebhook(raw);
    expect(event).toMatchObject({ kind: 'echo', wamid: 'w3', phone: '+919876543210' });
    expect(JSON.stringify(event)).not.toContain('"ok"');
  });
  it('reads edits, deletions and the number being disconnected', () => {
    const edit = metaWrap('messages', {
      messages: [
        {
          id: 'e1',
          from: '919876543210',
          timestamp: '1',
          type: 'edit',
          edit: { original_message_id: 'w1', message: { text: { body: '60 bori' } } },
        },
        {
          id: 'r1',
          from: '919876543210',
          timestamp: '1',
          type: 'revoke',
          revoke: { original_message_id: 'w2' },
        },
      ],
    });
    expect(parseWebhook(edit)).toEqual([
      { kind: 'edit', wamid: 'w1', text: '60 bori' },
      { kind: 'revoke', wamid: 'w2' },
    ]);
    const account = metaWrap('account_update', { event: 'PARTNER_REMOVED' });
    expect(parseWebhook(account)).toEqual([{ kind: 'account', event: 'PARTNER_REMOVED' }]);
  });
  it('ignores delivery receipts and one odd message, but refuses another number', () => {
    expect(parseWebhook(metaWrap('messages', { statuses: [{ id: 'x', status: 'read' }] }))).toEqual(
      [{ kind: 'status', wamid: 'x', status: 'read', code: null }],
    );
    expect(
      parseWebhook(
        metaWrap('messages', {
          statuses: [{ id: 'x', status: 'failed', errors: [{ code: 131047 }] }, { nonsense: 1 }],
        }),
      ),
    ).toEqual([{ kind: 'status', wamid: 'x', status: 'failed', code: 131047 }]);
    expect(
      parseWebhook(
        metaWrap('messages', {
          messages: [
            { nonsense: true },
            { id: 'ok', from: '919876543210', timestamp: '1', type: 'text', text: { body: 'x' } },
          ],
        }),
      ),
    ).toHaveLength(1);
    const other = Buffer.from(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                field: 'messages',
                value: { metadata: { phone_number_id: 'someone-else' }, messages: [] },
              },
            ],
          },
        ],
      }),
    );
    expect(() => parseWebhook(other)).toThrow();
    expect(() => parseWebhook(Buffer.from('not json'))).toThrow();
  });
  it('reads YCloud’s edits and deletions as Cloud API sends them', () => {
    env('ycloud');
    const change = (message: Record<string, unknown>) =>
      Buffer.from(
        JSON.stringify({
          type: 'whatsapp.inbound_message.received',
          whatsappInboundMessage: { wamid: 'y9', to: '+919999900000', ...message },
        }),
      );
    expect(parseWebhook(change({ type: 'revoke', revoke: { original_message_id: 'y1' } }))).toEqual(
      [{ kind: 'revoke', wamid: 'y1' }],
    );
    expect(
      parseWebhook(
        change({
          type: 'edit',
          edit: { original_message_id: 'y1', message: { text: { body: '60 bori' } } },
        }),
      ),
    ).toEqual([{ kind: 'edit', wamid: 'y1', text: '60 bori' }]);
  });
  it('reads YCloud’s messages and echoes, and refuses another number', () => {
    env('ycloud');
    const inbound = (to: string) =>
      Buffer.from(
        JSON.stringify({
          id: 'evt',
          type: 'whatsapp.inbound_message.received',
          whatsappInboundMessage: {
            wamid: 'y1',
            from: '+919876543210',
            to,
            type: 'text',
            sendTime: '2026-11-04T10:00:00.000Z',
            text: { body: '50 bori' },
            customerProfile: { name: 'Raju' },
          },
        }),
      );
    expect(parseWebhook(inbound('+919999900000'))[0]).toMatchObject({
      kind: 'inbound',
      wamid: 'y1',
      phone: '+919876543210',
      text: '50 bori',
      profileName: 'Raju',
    });
    expect(() => parseWebhook(inbound('+919111111111'))).toThrow();
    const echo = Buffer.from(
      JSON.stringify({
        type: 'whatsapp.smb.message.echoes',
        whatsappMessage: {
          wamid: 'y2',
          from: '+919999900000',
          to: '+919876543210',
          type: 'text',
          sendTime: '2026-11-04T10:00:00.000Z',
          text: { body: 'ok' },
        },
      }),
    );
    expect(parseWebhook(echo)[0]).toMatchObject({
      kind: 'echo',
      wamid: 'y2',
      phone: '+919876543210',
    });
    expect(parseWebhook(Buffer.from(JSON.stringify({ type: 'whatsapp.message.updated' })))).toEqual(
      [],
    );
  });
});

describe('the privacy pages', () => {
  for (const file of [
    '../../admin/app/privacy/page.tsx',
    '../../storefront/app/(public)/privacy/page.tsx',
  ])
    it(`${file} names who handles WhatsApp messages and how to stop`, () => {
      const page = readFileSync(join(__dirname, file), 'utf8');
      for (const word of [
        'Meta (WhatsApp)',
        'Gemini',
        'NEXT_PUBLIC_WHATSAPP_PARTNER',
        'STOP',
        '30 days',
      ])
        expect(page).toContain(word);
    });
});

describe('configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  const base = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/shiv_cement',
    OTP_HASH_SECRET: 'unit-test-secret-with-at-least-32-characters',
  };
  async function load(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [key, value] of Object.entries({ ...base, ...env })) vi.stubEnv(key, value);
    const config = await import('../src/config');
    return () => config.getConfig();
  }
  const valid = {
    WA_MODE: 'shadow',
    WA_WEBHOOK_PROVIDER: 'ycloud',
    WA_PARTNER_NAME: 'Test partner',
    WHATSAPP_WEBHOOK_SECRET: 'webhook-secret-for-tests-only',
    WA_BUSINESS_PHONE: '+919999900000',
  };
  it('is off unless asked for', async () => {
    expect((await load({}))().WA_MODE).toBe('off');
  });
  it('reply mode needs a sender and a privacy page, and is never the default', async () => {
    expect((await load({}))().WA_REPLY_PROVIDER).toBe('off');
    expect(await load({ ...valid, WA_MODE: 'reply' })).toThrow(/WA_REPLY_PROVIDER/);
    expect(await load({ ...valid, WA_MODE: 'reply', WA_REPLY_PROVIDER: 'fake' })).toThrow(
      /WA_PRIVACY_URL/,
    );
    expect(
      await load({
        ...valid,
        WA_MODE: 'reply',
        WA_REPLY_PROVIDER: 'fake',
        WA_PRIVACY_URL: 'https://example.test/privacy',
      }),
    ).not.toThrow();
  });
  it('a real sender needs its own key', async () => {
    const reply = { ...valid, WA_PRIVACY_URL: 'https://example.test/privacy' };
    expect(await load({ ...reply, WA_REPLY_PROVIDER: 'd360' })).toThrow(/key/);
    expect(await load({ ...reply, WA_REPLY_PROVIDER: 'ycloud' })).toThrow(/key/);
    expect(await load({ ...reply, WA_REPLY_PROVIDER: 'meta' })).toThrow(/key/);
    expect(
      await load({
        ...reply,
        WA_REPLY_PROVIDER: 'd360',
        WA_REPLY_API_KEY: 'partner-key-for-tests-only',
      }),
    ).not.toThrow();
  });
  it('the second number is only ever in the environment, and a fake sender stays out of production', () => {
    const source = readFileSync(join(__dirname, '../src/config.ts'), 'utf8');
    expect(source).toMatch(/NODE_ENV === 'production' && candidate\.WA_REPLY_PROVIDER === 'fake'/);
    expect(source).toMatch(/WA_SECOND_NUMBER/);
  });
  it('needs the partner named and the secret set before reading', async () => {
    expect(await load({ ...valid, WA_PARTNER_NAME: undefined })).toThrow(/partner/);
    expect(await load({ ...valid, WHATSAPP_WEBHOOK_SECRET: undefined })).toThrow(/secret/);
    expect(await load({ ...valid, WA_WEBHOOK_PROVIDER: 'meta' })).toThrow(/secret/);
    expect(await load(valid)).not.toThrow();
  });
  it('needs a paid key, a pinned model and prices for the model', async () => {
    const reader = {
      WA_READER_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'key-for-tests-only-0000',
      WA_READER_MODEL: 'gemini-3.1-flash-lite',
      WA_READER_PAID_KEY: 'true',
      WA_READER_INPUT_MICRO_USD_PER_MILLION: '250000',
      WA_READER_OUTPUT_MICRO_USD_PER_MILLION: '1500000',
    };
    expect(await load(reader)).not.toThrow();
    expect(await load({ ...reader, WA_READER_PAID_KEY: 'false' })).toThrow(/paid key/);
    expect(await load({ ...reader, WA_READER_MODEL: undefined })).toThrow(/paid key/);
  });
  it('keeps reading and sending out of the demo', async () => {
    expect(
      await load({ ...valid, DEMO_MODE: 'true', OTP_PROVIDER: 'mock', DEMO_STAFF_CODE: '123456' }),
    ).toThrow(/DEMO_MODE/);
    expect(
      await load({
        WA_REPLY_PROVIDER: 'fake',
        DEMO_MODE: 'true',
        OTP_PROVIDER: 'mock',
        DEMO_STAFF_CODE: '123456',
      }),
    ).toThrow(/DEMO_MODE/);
  });
  it('keeps the fake reader out of production', () => {
    // The production path needs a full environment, so the check itself is read directly.
    expect(readFileSync(join(__dirname, '../src/config.ts'), 'utf8')).toMatch(
      /NODE_ENV === 'production' && candidate\.WA_READER_PROVIDER === 'fake'/,
    );
  });
});

describe('what the AI says about a draft', () => {
  const asked = (
    context: Partial<Parameters<typeof decideReplies>[1]>,
    reading: Reading | null = finish(plainOrder()),
  ) =>
    decideReplies(reading, {
      known: true,
      humanQuiet: false,
      freshRatePaise: null,
      failed: false,
      ...context,
    });
  const status = () => finish(plainOrder({ intent: 'STATUS_QUESTION', lines: [] }));
  it('a change says updated, the same again says waiting, then nothing', () => {
    expect(asked({ draft: 'CHANGED' })[0]).toBe('UPDATED');
    expect(asked({ draft: 'SAME' })).toEqual(['WAITING']);
    expect(asked({ draft: 'SAME_TOLD' })).toEqual([]);
  });
  it('after a tap it asks or defers, and never changes anything', () => {
    expect(asked({ draft: 'REPEAT' })).toEqual(['ASK_NEW']);
    expect(asked({ draft: 'AFTER_TAP' })).toEqual(['AFTER_TAP']);
  });
  it('a status question answers from the database, never from the words', () => {
    expect(asked({ draft: 'OPEN' }, status())).toEqual(['WAITING']);
    expect(asked({ draft: 'EXPIRED' }, status())).toEqual(['EXPIRED']);
    expect(asked({ draft: 'NONE' }, status())).toEqual(['AFTER_TAP']);
  });
  it('on Papa’s thread, a status question gets only "the shop will answer", once quiet is over', () => {
    expect(asked({ papa: true, draft: 'OPEN' }, status())).toEqual(['AFTER_TAP']);
    expect(asked({ papa: true, humanQuiet: true, draft: 'OPEN' }, status())).toEqual([]);
    expect(asked({ papa: true, draft: 'CHANGED' })).toEqual([]);
    expect(asked({ papa: true, failed: true }, null)).toEqual([]);
  });
  it('after they ask for a person, nothing at all', () => {
    expect(asked({ handedOff: true })).toEqual([]);
    expect(asked({ handedOff: true }, status())).toEqual([]);
    expect(asked({ handedOff: true, failed: true }, null)).toEqual([]);
  });
  it('in the quiet after Papa types, a new order gets only its receipt', () => {
    expect(asked({ humanQuiet: true, draft: 'NEW' })).toEqual(['DRAFT']);
    expect(asked({ humanQuiet: true, draft: 'CHANGED' })).toEqual([]);
    expect(asked({ humanQuiet: true, draft: 'SAME' })).toEqual([]);
    expect(asked({ humanQuiet: true }, status())).toEqual([]);
  });
  it('asks each question once, and no more than two', () => {
    const facts: CardFacts = {
      lines: [],
      placeText: '',
      fulfilment: 'UNKNOWN',
      dayKind: 'UNSPECIFIED',
    };
    expect(asked({ card: facts, draft: 'CHANGED' })).toContain('ASK_PLACE');
    expect(asked({ card: facts, draft: 'CHANGED', asked: ['ASK_PLACE'] })).toEqual(['UPDATED']);
    expect(
      asked({ card: { ...facts, placeText: 'x' }, draft: 'CHANGED', asked: ['ASK_PLACE'] }),
    ).toContain('ASK_DAY');
    expect(
      asked({
        card: { ...facts, placeText: 'x' },
        draft: 'CHANGED',
        asked: ['ASK_PLACE', 'ASK_WHICH'],
      }),
    ).toEqual(['UPDATED']);
  });
});

describe('merging lines', () => {
  const line = (productId: string | null, quantity: number | null, rawText = ''): DraftLine => ({
    rawText,
    productId,
    productName: productId,
    quantity,
    unitWord: null,
    candidates: 1,
  });
  it('a correction changes the line, a new item adds one, and nothing is dropped', () => {
    const merged = mergeLines([line('a', 50), line('b', 10)], [line('a', 60), line('c', 5)]);
    expect(merged.map((row) => [row.productId, row.quantity])).toEqual([
      ['a', 60],
      ['b', 10],
      ['c', 5],
    ]);
  });
  it('words with no product are told apart by the words', () => {
    const merged = mergeLines(
      [line(null, 2, 'gitti')],
      [line(null, 3, 'GITTI'), line(null, 1, 'x')],
    );
    expect(merged.map((row) => row.quantity)).toEqual([3, 1]);
  });
  it('holds no more than 20', () => {
    const many = Array.from({ length: 25 }, (_, index) => line(String(index), 1));
    expect(mergeLines([], many)).toHaveLength(20);
  });
  it('the same lines are the same in any order, and a changed number is not', () => {
    expect(sameLines([line('a', 1), line('b', 2)], [line('b', 2), line('a', 1)])).toBe(true);
    expect(sameLines([line('a', 1)], [line('a', 2)])).toBe(false);
    expect(sameLines([line('a', 1)], [line('a', 1), line('b', 1)])).toBe(false);
  });
});

describe('short answers on an open draft', () => {
  it('reads days, pickup, a known place and a cancel, with no model', () => {
    expect(readDraftAnswer('kal', catalog)).toEqual({ kind: 'DAY', day: 'TOMORROW' });
    expect(readDraftAnswer('Aaj', catalog)).toEqual({ kind: 'DAY', day: 'TODAY' });
    expect(readDraftAnswer('abhi pata nahi', catalog)).toEqual({ kind: 'DAY', day: 'UNSPECIFIED' });
    expect(readDraftAnswer('khud utha lenge', catalog)).toEqual({ kind: 'PICKUP' });
    expect(readDraftAnswer('sipara', catalog)).toEqual({ kind: 'PLACE', text: 'sipara' });
    expect(readDraftAnswer('cancel kar do', catalog)).toEqual({ kind: 'CANCEL' });
    expect(readDraftAnswer('रद्द करो', catalog)).toEqual({ kind: 'CANCEL' });
    expect(readDraftAnswer('badlav karna hai', catalog)).toEqual({ kind: 'CHANGE' });
    expect(readDraftAnswer('haan naya', catalog)).toEqual({ kind: 'NEW_YES' });
    expect(readDraftAnswer('nahi naya', catalog)).toEqual({ kind: 'NEW_NO' });
  });
  it('anything longer or less plain goes on to the reader', () => {
    expect(readDraftAnswer('50 bori ultratech', catalog)).toBeNull();
    expect(readDraftAnswer('kal nahi parso', catalog)).toBeNull();
    expect(readDraftAnswer('cancel kar do aur 60 bhej do', catalog)).toBeNull();
    expect(readDraftAnswer('', catalog)).toBeNull();
    expect(readDraftAnswer('nowhere', catalog)).toBeNull();
    expect(readDraftAnswer('confirm', catalog)).toBeNull();
  });
  it('asking for the shop is plain, and a greeting is not asking', () => {
    expect(isHumanAsk('dukaan')).toBe(true);
    expect(isHumanAsk('दुकान')).toBe(true);
    expect(isHumanAsk('dukaan se baat karni hai')).toBe(true);
    expect(isHumanAsk('dukaan kab khulti hai')).toBe(false);
    expect(readByRules('dukaan', catalog)!.intent).toBe('HUMAN_REQUEST');
  });
});

describe('the words a person’s decision uses', () => {
  const confirmed = {
    kind: 'CONFIRMED',
    number: 'SC-2026-1',
    lines: '50 bori UltraTech',
    totalPaise: 2000000,
    day: '2026-11-06',
  } as const;
  it('say what was decided, in all three languages', () => {
    expect(renderDecision(confirmed, 'hinglish')).toContain(
      'Dukaan ne aapka order SC-2026-1 pakka kiya',
    );
    expect(renderDecision(confirmed, 'hindi')).toContain('पक्का किया');
    expect(renderDecision(confirmed, 'english')).toContain(
      'The shop confirmed your order SC-2026-1',
    );
    expect(renderDecision(confirmed, 'hinglish')).toContain('₹20,000');
    expect(renderDecision({ ...confirmed, kind: 'CONFIRMED_CHANGED' }, 'hinglish')).toContain(
      'badlav ke saath',
    );
  });
  it('a refusal gives the reason in the shop’s words, or a person’s own note', () => {
    expect(renderDecision({ kind: 'REFUSED', reason: 'NO_CREDIT' }, 'hinglish')).toContain(
      'udhaar abhi nahi',
    );
    expect(
      renderDecision(
        { kind: 'REFUSED', reason: 'OTHER', note: 'kal ke baad\nbaat karein' },
        'english',
      ),
    ).toContain('kal ke baad baat karein');
  });
  it('template values are one plain line each', () => {
    const template = decisionTemplate({ ...confirmed, lines: 'a\nb\t c' }, 'hinglish');
    expect(template.name).toBe('shiv_order_confirmed_v1');
    expect(template.params).toEqual([
      'SC-2026-1',
      'a b c',
      expect.stringContaining('₹20,000'),
      '2026-11-06',
    ]);
    expect(decisionTemplate({ kind: 'REFUSED', reason: 'OTHER', note: 'x\ny' }, 'hindi')).toEqual({
      name: 'shiv_order_refused_v1',
      params: ['x y'],
    });
  });
  it('refuses to run without a person', async () => {
    await expect(
      enqueueDecision({} as never, {
        actorId: '',
        threadId: 't',
        draftId: 'd',
        language: 'hinglish',
        facts: confirmed,
      }),
    ).rejects.toThrow(/person/);
  });
  it('a reply never shows raw line words past what the card holds', () => {
    expect(
      lineWords([
        { quantity: 50, unitWord: 'bori', productName: 'UltraTech', rawText: 'x', productId: 'u' },
        {
          quantity: null,
          unitWord: 'trolley',
          productName: null,
          rawText: 'gitti',
          productId: null,
        },
      ]),
    ).toBe('50 bori UltraTech, trolley gitti');
    expect(replyParams(null, catalog)).toMatchObject({ lines: '', place: '', day: '' });
  });
});

describe('the last look before sending', () => {
  const at = new Date('2026-11-05T06:30:00Z');
  const fresh = new Date(at.getTime() - 60000);
  const input = (
    rest: {
      settings?: Partial<GuardInput['settings']>;
      thread?: Partial<GuardInput['thread']>;
      row?: Partial<GuardInput['row']>;
      draft?: GuardInput['draft'];
      known?: boolean;
      mode?: string;
      provider?: string;
    } = {},
  ): GuardInput => ({
    now: at,
    mode: rest.mode ?? 'reply',
    provider: rest.provider ?? 'fake',
    businessPhone: '+919999900000',
    maxAgeMinutes: 30,
    settings: {
      aiPaused: false,
      replyStage: 'EVERYONE',
      testNumbers: [],
      nightFromHour: 21,
      nightToHour: 7,
      ...rest.settings,
    },
    thread: {
      phone: '+919000000001',
      aiMode: 'AUTO',
      humanUntil: null,
      lastEchoAt: null,
      lastInboundAt: fresh,
      handoffUntil: null,
      ...rest.thread,
    },
    known: rest.known ?? false,
    draft: rest.draft ?? null,
    row: {
      class: 'AI_REPLY',
      kind: 'DRAFT',
      triggerAt: fresh,
      quietOk: false,
      body: 'Yeh abhi pakka nahi hai',
      ...rest.row,
    },
  });
  const decision = { class: 'HUMAN_DECISION', kind: 'CONFIRMED', body: 'Pakka.' };
  it('lets a clean reply go', () => {
    expect(replyBlock(input())).toBeNull();
  });
  it('stops for each switch, whoever spoke', () => {
    for (const row of [{}, decision]) {
      expect(replyBlock(input({ row, mode: 'shadow' }))).toBe('MODE_OFF');
      expect(replyBlock(input({ row, provider: 'off' }))).toBe('MODE_OFF');
      expect(replyBlock(input({ row, settings: { aiPaused: true } }))).toBe('STOP_ALL');
      expect(replyBlock(input({ row, settings: { replyStage: 'OFF' } }))).toBe('STAGE_OFF');
      expect(replyBlock(input({ row, thread: { aiMode: 'OFF' } }))).toBe('NUMBER_OFF');
      expect(replyBlock(input({ row, thread: { aiMode: 'OPTED_OUT' } }))).toBe('OPTED_OUT');
      expect(replyBlock(input({ row, thread: { phone: null } }))).toBe('NO_PHONE');
      expect(replyBlock(input({ row, thread: { phone: '+919999900000' } }))).toBe('OWN_NUMBER');
    }
  });
  it('STOP gets its one acknowledgement, and nothing else gets through on it', () => {
    const row = { kind: 'STOP_OK', body: 'Theek hai.' };
    expect(replyBlock(input({ row, thread: { aiMode: 'OPTED_OUT' } }))).toBeNull();
    expect(replyBlock(input({ row, thread: { aiMode: 'OFF' } }))).toBe('NUMBER_OFF');
    expect(replyBlock(input({ row, settings: { replyStage: 'OFF' } }))).toBe('STAGE_OFF');
  });
  it('the AI’s quiet rules hold for it, and a person’s decision passes them', () => {
    const quiet = { humanUntil: new Date(at.getTime() + 60000) };
    const off = { lastEchoAt: at };
    const handed = { handoffUntil: new Date(at.getTime() + 60000) };
    const night = { nightFromHour: 0, nightToHour: 23 };
    const closed = { lastInboundAt: new Date(at.getTime() - 25 * 3600000) };
    const old = { triggerAt: new Date(at.getTime() - 31 * 60000) };
    expect(replyBlock(input({ thread: quiet }))).toBe('QUIET_AFTER_ECHO');
    expect(replyBlock(input({ thread: quiet, row: { quietOk: true } }))).toBeNull();
    expect(replyBlock(input({ thread: off }))).toBe('PAPA_TYPED');
    expect(replyBlock(input({ thread: handed }))).toBe('HANDED_OFF');
    expect(replyBlock(input({ thread: handed, row: { kind: 'HANDOFF' } }))).toBeNull();
    expect(replyBlock(input({ settings: night }))).toBe('NIGHT');
    expect(replyBlock(input({ thread: closed }))).toBe('WINDOW_CLOSED');
    expect(replyBlock(input({ row: old }))).toBe('TOO_OLD');
    for (const rest of [
      { thread: quiet },
      { thread: off },
      { thread: handed },
      { settings: night },
      { thread: closed },
    ])
      expect(replyBlock(input({ ...rest, row: decision }))).toBeNull();
  });
  it('on a draft Papa answered, or one closed, the AI has nothing to say about it', () => {
    const papa = { status: 'OPEN', papaRepliedAt: at };
    expect(replyBlock(input({ draft: papa }))).toBe('PAPA_TYPED');
    expect(replyBlock(input({ draft: papa, row: { kind: 'AFTER_TAP' } }))).toBeNull();
    expect(replyBlock(input({ draft: { status: 'CONFIRMED', papaRepliedAt: null } }))).toBe(
      'DRAFT_CLOSED',
    );
    expect(replyBlock(input({ draft: papa, row: decision }))).toBeNull();
  });
  it('the words themselves get a last look', () => {
    expect(replyBlock(input({ row: { body: 'Aapka order pakka hai' } }))).toBe('FORBIDDEN_WORDS');
    expect(replyBlock(input({ row: { body: 'Total ₹100' } }))).toBe('FORBIDDEN_WORDS');
  });
  it('the stages hold: test numbers, known customers, everyone', () => {
    const on = (replyStage: string, testNumbers: string[], known = false) =>
      replyBlock(input({ settings: { replyStage, testNumbers }, known }));
    expect(on('TEST_NUMBERS', [])).toBe('NOT_THIS_STAGE');
    expect(on('TEST_NUMBERS', ['+919000000001'])).toBeNull();
    expect(on('TEST_NUMBERS', [], true)).toBe('NOT_THIS_STAGE');
    expect(on('KNOWN_CUSTOMERS', [])).toBe('NOT_THIS_STAGE');
    expect(on('KNOWN_CUSTOMERS', [], true)).toBeNull();
    expect(on('KNOWN_CUSTOMERS', ['+919000000001'])).toBeNull();
    expect(on('EVERYONE', [])).toBeNull();
    expect(stageAllows({ replyStage: 'EVERYONE', testNumbers: [] }, null, true)).toBe(false);
    expect(stageAllows({ replyStage: 'OFF', testNumbers: ['+1'] }, '+1', true)).toBe(false);
  });
  it('knows the night, across midnight or within a day', () => {
    const ist = (hour: number) =>
      new Date(`2026-11-05T${String(hour).padStart(2, '0')}:30:00+05:30`);
    expect(isNight(ist(22), 21, 7)).toBe(true);
    expect(isNight(ist(3), 21, 7)).toBe(true);
    expect(isNight(ist(7), 21, 7)).toBe(false);
    expect(isNight(ist(12), 21, 7)).toBe(false);
    expect(isNight(ist(14), 13, 15)).toBe(true);
    expect(isNight(ist(15), 13, 15)).toBe(false);
    expect(isNight(ist(5), 9, 9)).toBe(false);
  });
});

describe('the real senders', () => {
  const outgoing = { to: '+919000000001', kind: 'DRAFT', body: 'Words' };
  const answered = (json: unknown, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(json), { status }));
  const env = (rest: Record<string, unknown>) =>
    Object.assign(getConfig(), {
      WA_BUSINESS_PHONE: '+919999900000',
      WHATSAPP_ACCESS_TOKEN: 'meta-token-for-tests-only-000',
      WHATSAPP_PHONE_NUMBER_ID: '123',
      WA_REPLY_API_KEY: 'partner-key-for-tests-only',
      ...rest,
    });
  let saved: Record<string, unknown>;
  beforeEach(() => {
    saved = { ...getConfig() };
  });
  afterEach(() => {
    Object.assign(getConfig(), saved);
    vi.unstubAllGlobals();
  });
  it('360dialog: its address, its header and the Cloud API format, with the number in digits', async () => {
    const fetchMock = answered({ messages: [{ id: 'wamid.1' }] });
    vi.stubGlobal('fetch', fetchMock);
    env({ WA_REPLY_PROVIDER: 'd360' });
    expect(await carry(outgoing)).toBe('wamid.1');
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://waba-v2.360dialog.io/messages');
    expect((options.headers as Record<string, string>)['D360-API-KEY']).toBe(
      'partner-key-for-tests-only',
    );
    expect(JSON.parse(String(options.body))).toMatchObject({
      messaging_product: 'whatsapp',
      to: '919000000001',
      type: 'text',
      text: { body: 'Words', preview_url: false },
    });
  });
  it('Meta: the graph address and bearer token', async () => {
    const fetchMock = answered({ messages: [{ id: 'wamid.2' }] });
    vi.stubGlobal('fetch', fetchMock);
    env({ WA_REPLY_PROVIDER: 'meta' });
    await carry(outgoing);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('/123/messages');
    expect((options.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
  });
  it('YCloud: its address, its header, and from the shop’s number', async () => {
    const fetchMock = answered({ wamid: 'wamid.3' });
    vi.stubGlobal('fetch', fetchMock);
    env({ WA_REPLY_PROVIDER: 'ycloud' });
    expect(await carry(outgoing)).toBe('wamid.3');
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('api.ycloud.com');
    expect(JSON.parse(String(options.body))).toMatchObject({
      from: '+919999900000',
      to: '+919000000001',
      type: 'text',
    });
  });
  it('buttons and templates go in WhatsApp’s shapes', async () => {
    const fetchMock = answered({ messages: [{ id: 'x' }] });
    vi.stubGlobal('fetch', fetchMock);
    env({ WA_REPLY_PROVIDER: 'd360' });
    await carry({ ...outgoing, buttons: [{ id: 'TODAY', title: 'Aaj' }] });
    await carry({
      to: outgoing.to,
      kind: 'CONFIRMED',
      template: { name: 'shiv_order_confirmed_v1', language: 'en_IN', params: ['a', 'b'] },
    });
    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as unknown as [string, RequestInit])[1].body)),
    );
    expect(bodies[0].interactive.action.buttons[0]).toEqual({
      type: 'reply',
      reply: { id: 'TODAY', title: 'Aaj' },
    });
    expect(bodies[1].template).toMatchObject({
      name: 'shiv_order_confirmed_v1',
      language: { code: 'en_IN' },
    });
    expect(bodies[1].template.components[0].parameters).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });
  it('a refusal keeps WhatsApp’s code, and an answer with no id is a failure', async () => {
    vi.stubGlobal('fetch', answered({ error: { code: 131047, message: 'x' } }, 400));
    env({ WA_REPLY_PROVIDER: 'd360' });
    await expect(carry(outgoing)).rejects.toBeInstanceOf(SendRefused);
    await expect(carry(outgoing)).rejects.toMatchObject({ code: 131047 });
    vi.stubGlobal('fetch', answered({}, 200));
    await expect(carry(outgoing)).rejects.toMatchObject({ code: null });
  });
  it('with no sender set, nothing is called', async () => {
    const fetchMock = answered({});
    vi.stubGlobal('fetch', fetchMock);
    env({ WA_REPLY_PROVIDER: 'off' });
    await expect(carry(outgoing)).rejects.toThrow(/No sender/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
