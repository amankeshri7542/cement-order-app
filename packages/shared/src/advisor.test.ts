import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  advisorChrome,
  advisorFeedbackInput,
  advisorSpeaker,
  advisorStarters,
  advisorText,
  advisorTurnInput,
  advisorWords,
  checkedMonth,
} from './advisor';
import { buildingTerms, expandTerms, termsIn } from './glossary';

const everyWord = () => [
  ...Object.values(advisorText),
  ...Object.values(advisorChrome),
  ...Object.values(advisorStarters).flat(),
];
const devanagari = /\p{Script=Devanagari}/u;

describe('fixed text', () => {
  test('comes in both languages, all in Roman script', () => {
    for (const words of everyWord()) {
      assert.ok(words.en.length > 0);
      assert.ok(words.hinglish.length > 0);
      assert.ok(!devanagari.test(words.en), words.en);
      assert.ok(!devanagari.test(words.hinglish), words.hinglish);
    }
  });
  test('says nothing about tiles, putty or finishing (decision 51)', () => {
    for (const words of everyWord())
      for (const text of [words.en, words.hinglish])
        assert.ok(!/\b(tiles?|putty|paint|finishing)\b/i.test(text), text);
  });
  test('gives no quantity, ratio or day for a building, and no price', () => {
    for (const [key, words] of Object.entries(advisorText))
      for (const text of [words.en, words.hinglish]) {
        const digits = text.match(/\d+/g) ?? [];
        // 112 is the emergency number, the only figure any fixed text may hold.
        for (const number of digits) assert.equal(number, '112', `${key}: ${text}`);
        assert.ok(!/₹|\brs\b|rupaye/i.test(text), text);
      }
  });
  test('never promises, and never says best or pakka', () => {
    for (const [key, words] of Object.entries(advisorText)) {
      if (key === 'NO_BEST_BRAND') continue;
      for (const text of [words.en, words.hinglish])
        assert.ok(
          !/\b(pakka|guarantee|guaranteed|best|lowest|sabse sasta|most people)\b/i.test(text),
          `${key}: ${text}`,
        );
    }
  });
  test('uses none of plan 01’s banned words in Simple English', () => {
    const banned =
      /\b(revision|conversion|acknowledge|exception|retry|request|review|session|device|ledger|adjust|override|queue|reserved|serviceable|proceed|kindly)\b/i;
    for (const words of Object.values(advisorText)) assert.ok(!banned.test(words.en), words.en);
  });
  test('the safety text sends people to help', () => {
    for (const language of ['en', 'hinglish'] as const) {
      assert.match(advisorWords('DANGER_NOW', language), /112/);
      assert.match(advisorWords('DANGER_NOW', language), /engineer/i);
      assert.match(advisorWords('STRUCTURAL', language), /engineer/i);
      assert.match(advisorWords('INJURY', language), /doctor/i);
    }
  });
  test('the speaker is the name decision 52 gives', () => {
    assert.equal(advisorSpeaker, 'Shiv Cement AI');
  });
  test('the slab question is offered only where it shows the honest refusal', () => {
    assert.ok(advisorStarters.website.some((item) => /sariya/.test(item.en)));
    for (const item of [...advisorStarters.home, ...advisorStarters.product])
      assert.ok(!/\b(slab|how much|how many|kitna)\b/i.test(item.en), item.en);
  });
});

describe('what a client may send', () => {
  const good = { clientTurnId: 'abcd1234', text: 'cement', channel: 'WEB' };
  test('accepts a plain question, and trims it', () => {
    assert.deepEqual(advisorTurnInput.parse({ ...good, text: '  cement  ' }), good);
  });
  for (const [name, extra] of [
    ['history', { history: [] }],
    ['a language of its own', { language: 'hi' }],
    ['a bad channel', { channel: 'WHATSAPP' }],
    ['text over the limit', { text: 'x'.repeat(601) }],
    ['empty text', { text: '' }],
    ['a turn id with spaces', { clientTurnId: 'abc def ghi' }],
    ['a short turn id', { clientTurnId: 'abc' }],
    ['a product id with quotes', { productId: "a'b" }],
    ['a route', { route: 'CATALOG' }],
  ] as const)
    test(`refuses ${name}`, () => {
      assert.equal(advisorTurnInput.safeParse({ ...good, ...extra }).success, false);
    });
  test('feedback takes a reason only with Not right', () => {
    assert.ok(advisorFeedbackInput.safeParse({ value: 'NOT_RIGHT', reason: 'OFFENSIVE' }).success);
    assert.ok(advisorFeedbackInput.safeParse({ value: 'HELPED' }).success);
    assert.equal(
      advisorFeedbackInput.safeParse({ value: 'HELPED', reason: 'WRONG' }).success,
      false,
    );
    assert.equal(
      advisorFeedbackInput.safeParse({ value: 'NOT_RIGHT', reason: 'OTHER' }).success,
      false,
    );
  });
});

describe('the month an article was checked', () => {
  test('reads as a month and year', () => {
    assert.equal(checkedMonth('2027-03'), 'March 2027');
  });
  test('is empty for anything else', () => {
    assert.equal(checkedMonth('nonsense'), '');
    assert.equal(checkedMonth('2027-13'), '');
  });
});

describe('site words', () => {
  test('finds how people spell things, whole words only', () => {
    assert.deepEqual(
      termsIn('sarya kitne ka kilo hai').map((term) => term.word),
      ['sariya'],
    );
    assert.deepEqual(
      termsIn('pirate gold').map((term) => term.word),
      [],
    );
    assert.ok(expandTerms('balu kaisa ho').includes('sand'));
    assert.ok(expandTerms('seelan kyun aati hai').includes('damp'));
  });
  test('leaves out what the shop does not stock', () => {
    assert.ok(!JSON.stringify(buildingTerms).match(/tile|putty|paint/i));
  });
});
