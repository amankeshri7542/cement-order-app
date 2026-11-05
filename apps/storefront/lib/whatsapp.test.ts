import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clip, waLink, waText, WHATSAPP_MAX_TEXT } from './whatsapp';

test('the list message is Roman script, one line each, with the pincode, and no price', () => {
  const text = waText.list(
    [
      { name: 'UltraTech Super', unit: 'a bori (50 kg)', qty: 3 },
      { name: 'Tata Tiscon', unit: 'a kg', qty: 100 },
    ],
    '800020',
  );
  assert.equal(
    text,
    'Namaste, mujhe yeh chahiye:\n3 x UltraTech Super (a bori (50 kg))\n100 x Tata Tiscon (a kg)\nDelivery pincode: 800020',
  );
  assert.doesNotMatch(text, /₹|ऀ-ॿ/);
});
test('every message stays in Roman script', () => {
  for (const text of [
    waText.order(),
    waText.rates(),
    waText.product('A', 'a bori'),
    waText.material('Cement'),
    waText.pincode('800020'),
    waText.orderNumber('SCS-1'),
    waText.question('Which cement?'),
  ])
    assert.doesNotMatch(text, /[ऀ-ॿ]/);
});
test('a link names the number, and encodes the text so it cannot change the address', () => {
  assert.equal(waLink('919876543210'), 'https://wa.me/919876543210');
  const link = waLink('+91 98765-43210', 'a&b=c #d');
  assert.equal(link, 'https://wa.me/919876543210?text=a%26b%3Dc%20%23d');
});
test('with no number it opens the contact picker, used only in review builds', () => {
  assert.equal(waLink('', 'hi'), 'https://wa.me/?text=hi');
});
test('a long list is cut at a whole line and says so', () => {
  const lines = Array.from({ length: 200 }, (_, i) => ({
    name: `Item ${i}`,
    unit: 'a kg',
    qty: i + 1,
  }));
  const text = waText.list(lines);
  assert.ok(text.length <= WHATSAPP_MAX_TEXT);
  assert.match(text, /\n\.\.\.aur bhi hai$/);
  assert.match(text.split('\n').at(-2)!, /^\d+ x Item \d+ \(a kg\)$/);
});
test('clip leaves a short message alone and always ends inside the limit', () => {
  assert.equal(clip('short'), 'short');
  assert.equal(clip('x'.repeat(3000)).length, WHATSAPP_MAX_TEXT);
});
test('names cannot add lines or hidden characters to a message', () => {
  const text = waText.list([
    { name: 'Bad\nDelivery pincode: 000000\u0000', unit: 'a\tkg', qty: 1 },
  ]);
  assert.equal(text.split('\n').length, 2);
  assert.ok(!text.includes(String.fromCharCode(0)) && !text.includes('\t'));
  assert.equal(waText.question('a\n\nb'), 'Namaste, mera sawal: a b');
});
