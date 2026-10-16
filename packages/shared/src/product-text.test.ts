import assert from 'node:assert/strict';
import test from 'node:test';
import { productDescription, productName, productSchema, unitLabel } from './index';

test('English units are shown exactly as stored', () => {
  for (const unit of ['bag', 'Bags', '50 kg bag', 'kg · 12 mm', '100 cu ft', 'U', ''])
    assert.equal(unitLabel(unit, 'en'), unit);
});

test('Hindi units use the counter words, singular or plural, any case', () => {
  const cases: [string, string][] = [
    ['bag', 'बोरी'],
    ['Bags', 'बोरी'],
    ['kg', 'किलो'],
    ['KGs', 'किलो'],
    ['tonne', 'टन'],
    ['tonnes', 'टन'],
    ['ton', 'टन'],
    ['tons', 'टन'],
    ['quintal', 'क्विंटल'],
    ['piece', 'पीस'],
    ['pieces', 'पीस'],
    ['pcs', 'पीस'],
    ['cft', 'घन फ़ुट'],
    ['cu ft', 'घन फ़ुट'],
    ['sqft', 'वर्ग फ़ुट'],
    ['Sq. Ft', 'वर्ग फ़ुट'],
    ['bundle', 'बंडल'],
    ['bundles', 'बंडल'],
    ['trolley', 'ट्रॉली'],
    ['trolleys', 'ट्रॉली'],
    ['metre', 'मीटर'],
    ['meters', 'मीटर'],
    ['m', 'मीटर'],
    ['litre', 'लीटर'],
    ['liters', 'लीटर'],
  ];
  for (const [unit, hindi] of cases) assert.equal(unitLabel(unit, 'hi'), hindi, unit);
});

test('Hindi units keep numbers and unknown words as typed', () => {
  assert.equal(unitLabel('50 kg bag', 'hi'), '50 किलो बोरी');
  assert.equal(unitLabel('100 cu ft', 'hi'), '100 घन फ़ुट');
  assert.equal(unitLabel('12 m piece', 'hi'), '12 मीटर पीस');
  assert.equal(unitLabel('kg · 12 mm', 'hi'), 'किलो · 12 mm');
  // Unknown units, and units already written in Hindi, are left alone.
  for (const unit of ['box', 'U', 'बोरी', 'nos', 'mm', 'bagful'])
    assert.equal(unitLabel(unit, 'hi'), unit);
});

test('product names and descriptions fall back to English when no Hindi is saved', () => {
  const cement = { name: 'UltraTech PPC', description: 'Sealed 50 kg bag' };
  const hindi = { ...cement, nameHi: 'अल्ट्राटेक पीपीसी', descriptionHi: '50 किलो की बंद बोरी' };
  assert.equal(productName(hindi, 'hi'), 'अल्ट्राटेक पीपीसी');
  assert.equal(productName(hindi, 'en'), 'UltraTech PPC');
  assert.equal(productName(cement, 'hi'), 'UltraTech PPC');
  assert.equal(productName({ ...cement, nameHi: null }, 'hi'), 'UltraTech PPC');
  assert.equal(productName({ ...cement, nameHi: '' }, 'hi'), 'UltraTech PPC');
  assert.equal(productDescription(hindi, 'hi'), '50 किलो की बंद बोरी');
  assert.equal(productDescription(hindi, 'en'), 'Sealed 50 kg bag');
  assert.equal(productDescription({ ...cement, descriptionHi: null }, 'hi'), 'Sealed 50 kg bag');
});

test('Hindi product fields are optional, trimmed, capped, and blank clears them', () => {
  const base = {
    name: 'TEST cement',
    brand: 'TEST',
    categoryId: 'cement',
    type: 'PPC',
    grade: '43',
    unit: 'bag',
    pricePaise: 38000,
    stock: 0,
    active: true,
    description: 'TEST description',
    recommendedUse: 'Plaster',
  };
  const omitted = productSchema.parse(base);
  assert.equal(omitted.nameHi, undefined, 'left out keeps the saved Hindi text');
  const set = productSchema.parse({ ...base, nameHi: '  सीमेंट  ', descriptionHi: 'विवरण' });
  assert.equal(set.nameHi, 'सीमेंट');
  assert.equal(set.descriptionHi, 'विवरण');
  const cleared = productSchema.parse({ ...base, nameHi: '   ', descriptionHi: '' });
  assert.equal(cleared.nameHi, null);
  assert.equal(cleared.descriptionHi, null);
  assert.equal(productSchema.parse({ ...base, nameHi: null }).nameHi, null);
  assert.ok(!productSchema.safeParse({ ...base, nameHi: 'न'.repeat(121) }).success);
  assert.ok(!productSchema.safeParse({ ...base, descriptionHi: 'न'.repeat(1501) }).success);
});
