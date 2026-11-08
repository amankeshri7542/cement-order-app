import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  en,
  hi,
  hinglish,
  htmlLang,
  isLanguage,
  languages,
  readLanguage,
  t,
  words,
  type MessageKey,
} from './index';

const devanagari = /[\u0900-\u097f]/;
const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('Hinglish has every English key, with the same placeholders', () => {
  assert.deepEqual(Object.keys(hinglish).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as MessageKey[]) {
    assert.ok(hinglish[key].trim(), key);
    assert.deepEqual(placeholders(hinglish[key]), placeholders(en[key]), key);
  }
});

// Language names are written in their own script in every catalogue, so a person who cannot read
// the current language still finds their own.
const ownScript = new Set(['language.hi']);

test('Hinglish is Hindi in Latin letters, spelled the shop’s way', () => {
  const misspelt = /\b(udhar|baki|paka|nahin|bhaada|dukan|hisab|wasooli|manjoori|gadi)\b/i;
  for (const [key, value] of Object.entries(hinglish)) {
    if (!ownScript.has(key)) assert.doesNotMatch(value, devanagari, key);
    assert.doesNotMatch(value, misspelt, key);
  }
});

// Brand and system names that stay as they are written on the product or the screen.
const latinInHindi = /\b(WhatsApp|GST|UPI|TEST)\b/g;
test('every Hindi key exists in English, keeps its placeholders and is in Devanagari', () => {
  for (const [key, value] of Object.entries(hi)) {
    assert.ok(key in en, `not in en: ${key}`);
    assert.ok(value.trim(), key);
    assert.deepEqual(placeholders(value), placeholders(en[key as MessageKey]), key);
    // Outside placeholders, brand names and digits, it is all Devanagari ("UPI" alone is fine).
    const rest = value.replace(/\{\w+\}/g, '').replace(latinInHindi, '');
    assert.doesNotMatch(rest, /[A-Za-z]{2,}/, key);
    if (/[A-Za-z]/.test(rest) || devanagari.test(rest)) assert.match(rest, devanagari, key);
  }
});

test('the shell and the top 300 owner strings have their Hindi', () => {
  const shell: MessageKey[] = [
    'owner.today',
    'owner.orders',
    'owner.khata',
    'owner.customers',
    'owner.more',
    'owner.loginTitle',
    'owner.signIn',
    'owner.retry',
    'owner.offline',
    'error.network',
    'status.DELIVERED',
    'date.month.1',
    'date.weekday.0',
    'date.age.days',
  ];
  for (const key of shell) assert.ok(hi[key], key);
  assert.ok(Object.keys(hi).length >= 300);
});

test('Hinglish is the default and parameters are plain text', () => {
  assert.match(t('owner.orderNumber', { number: 'SC-1' }), /SC-1/);
  assert.equal(t('owner.today'), 'Aaj');
  assert.equal(t('owner.today', {}, 'en'), 'Today');
  assert.equal(t('owner.today', {}, 'hi'), 'आज');
  assert.equal(t('owner.orderNumber', { number: '<b>' }, 'hi'), 'ऑर्डर <b>');
  // A placeholder with no value stays visible rather than vanishing.
  assert.equal(t('owner.orderNumber', {}, 'hi'), 'ऑर्डर {number}');
});

test('Hindi falls back to Hinglish for a key that has no Hindi yet, never to English', () => {
  const untranslated = (Object.keys(en) as MessageKey[]).find((key) => !(key in hi))!;
  assert.ok(untranslated);
  assert.equal(words(untranslated, 'hi'), hinglish[untranslated]);
  assert.equal(words(untranslated, 'hinglish'), hinglish[untranslated]);
});

test('reading a stored language', () => {
  assert.deepEqual([...languages], ['hinglish', 'en', 'hi']);
  for (const value of languages) assert.equal(readLanguage(value), value);
  for (const value of [null, undefined, '', 'fr', 'HI', 'hindi', 42, {}])
    assert.equal(readLanguage(value), 'hinglish');
  // Saved before plan v4, 'hi' meant Hinglish.
  assert.equal(readLanguage('hi', true), 'hinglish');
  assert.equal(readLanguage('en', true), 'en');
  assert.ok(isLanguage('hi'));
  assert.ok(!isLanguage('toString'));
});

test('the page says which language it is in', () => {
  assert.equal(htmlLang('en'), 'en');
  assert.equal(htmlLang('hi'), 'hi');
  assert.equal(htmlLang('hinglish'), 'hi-Latn');
});

test('the word pakka on a customer’s message only ever follows a person’s tap', () => {
  assert.doesNotMatch(en['push.orderPlaced.title'], /confirmed/i);
  assert.doesNotMatch(hinglish['push.orderPlaced.title'], /pakka/i);
  assert.doesNotMatch(hi['push.orderPlaced.title'] ?? '', /पक्का/);
});
