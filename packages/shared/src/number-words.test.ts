import assert from 'node:assert/strict';
import { test } from 'node:test';
import { numbersIn, readNumber, wholeNumberWord } from './quantity';

// Plan v4, 09 section 5: the number-word table. Each row is what a person types or says, and the
// number it must be read as everywhere (Saathi, the bill parser, voice, search).
const table: [string, number | null][] = [
  // Digits, Indian and western grouping, rupee signs.
  ['50', 50],
  ['०५०', 50],
  ['५०', 50],
  ['₹1,20,000', 120000],
  ['₹ 1,20,000/-', 120000],
  ['1,20,000', 120000],
  ['120,000', 120000],
  ['Rs. 500', 500],
  ['rs 500', 500],
  ['500 rupaye', 500],
  ['12.5', 12.5],
  // Hinglish words.
  ['pachaas', 50],
  ['pachas', 50],
  ['barah', 12],
  ['bees', 20],
  ['pachchis', 25],
  ['sau', 100],
  ['ek sau', 100],
  ['do sau', 200],
  ['do sau pachaas', 250],
  ['ek sau bees', 120],
  ['hazaar', 1000],
  ['do hazaar paanch sau', 2500],
  ['ek lakh bees hazaar', 120000],
  ['do crore', 20000000],
  ['ek crore do lakh', 10200000],
  // Fractions.
  ['dedh', 1.5],
  ['dhai', 2.5],
  ['dedh sau', 150],
  ['dhai sau', 250],
  ['dedh hazaar', 1500],
  ['dhai lakh', 250000],
  ['sawa', 1.25],
  ['sawa sau', 125],
  ['sawa do', 2.25],
  ['sawa lakh', 125000],
  ['paune', 0.75],
  ['paune do', 1.75],
  ['paune do sau', 175],
  ['paune sau', 75],
  ['aadha', 0.5],
  // Digits with lakh and crore.
  ['1.2 lakh', 120000],
  ['1.2lakh', 120000],
  ['1.5 crore', 15000000],
  ['2 lakh 50 hazaar', 250000],
  ['50 hazaar', 50000],
  // Devanagari words.
  ['पचास', 50],
  ['बारह', 12],
  ['दो सौ', 200],
  ['ढाई सौ', 250],
  ['डेढ़ सौ', 150],
  ['डेढ़ हज़ार', 1500],
  ['डेढ़ हजार', 1500],
  ['एक लाख', 100000],
  ['दो करोड़', 20000000],
  ['सवा लाख', 125000],
  ['पौने दो', 1.75],
  ['५० हज़ार', 50000],
  // English words, for the accountant.
  ['two hundred', 200],
  ['fifty thousand', 50000],
  // Not numbers, or not said this way.
  ['', null],
  ['   ', null],
  ['bori', null],
  ['cement', null],
  ['bees paanch', null],
  ['do lakh ek crore', null],
  ['lakh lakh', null],
  ['sau sau', null],
  ['do sawa', null],
  ['1,2,3', null],
  ['12mm', null],
  ['--', null],
  ['ek do teen char paanch chhe saat aath nau das gyarah barah terah', null],
];

test('the number-word table', () => {
  for (const [text, expected] of table) assert.equal(readNumber(text), expected, text);
});

test('every number in a sentence, with runs of words read as one', () => {
  assert.deepEqual(numbersIn('do sau pachaas bori UltraTech'), [250]);
  assert.deepEqual(numbersIn('dhai sau bori aur ek trolley'), [250, 1]);
  assert.deepEqual(numbersIn('₹1,20,000 jama, baaki 1.2 lakh'), [120000, 120000]);
  assert.deepEqual(numbersIn('पचास बोरी सीमेंट'), [50]);
  assert.deepEqual(numbersIn('kuch nahi'), []);
  // A run that is not one number is read word by word.
  assert.deepEqual(numbersIn('bees paanch'), [20, 5]);
});

test('sizes said in words', () => {
  assert.equal(wholeNumberWord('barah'), 12);
  assert.equal(wholeNumberWord('बारह'), 12);
  assert.equal(wholeNumberWord('sau'), undefined);
  assert.equal(wholeNumberWord('dedh'), undefined);
});

test('odd input never throws', () => {
  for (const odd of [
    '.',
    ',',
    '₹',
    '/-',
    '1e9',
    'Infinity',
    'NaN',
    '9'.repeat(400),
    '🙂',
    '\u0000',
  ])
    assert.doesNotThrow(() => readNumber(odd), odd);
  assert.equal(readNumber('9'.repeat(400)), null);
  assert.equal(readNumber('Infinity'), null);
  assert.equal(readNumber('1e9'), null);
});
