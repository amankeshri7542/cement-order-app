import assert from 'node:assert/strict';
import test from 'node:test';
import { WHATSAPP_TEXT_LIMIT, whatsappListLink, whatsappListText } from './whatsapp-text';

const cement = { name: 'UltraTech Super', unit: '50 kg bag', quantity: 50 };

test('the list goes as plain lines, with no prices', () => {
  const text = whatsappListText(
    [cement, { name: 'Construction sand', unit: '100 cu ft', quantity: 2 }],
    'Kankarbagh 800020',
  );
  assert.equal(
    text,
    'Shiv app se list:\n50 x 50 kg bag UltraTech Super\n2 x 100 cu ft Construction sand\nSite: Kankarbagh 800020',
  );
  assert.doesNotMatch(text, /₹|rs\.?\s*\d/i);
});

test('no site means no site line', () => {
  assert.equal(whatsappListText([cement]), 'Shiv app se list:\n50 x 50 kg bag UltraTech Super');
});

test('a long list is cut at a line, keeps its site, and stays inside the limit', () => {
  const lines = Array.from({ length: 80 }, (_, index) => ({
    name: `Product number ${index} with a long name`,
    unit: '50 kg bag',
    quantity: index + 1,
  }));
  const text = whatsappListText(lines, 'Boring Road 800001');
  assert.ok(text.length <= WHATSAPP_TEXT_LIMIT, String(text.length));
  assert.ok(text.endsWith('aur bhi hai\nSite: Boring Road 800001'));
  for (const row of text.split('\n').slice(1, -2)) assert.match(row, /^\d+ x 50 kg bag Product/);
});

test('control characters cannot break the message apart', () => {
  const text = whatsappListText([{ name: 'A\nSite: fake\u0000', unit: 'bag\r\n', quantity: 1 }]);
  assert.equal(text, 'Shiv app se list:\n1 x bag A Site: fake');
});

test('the link needs a real Indian mobile, or there is no link and the button hides', () => {
  assert.equal(whatsappListLink('', 'x'), null);
  assert.equal(whatsappListLink(null, 'x'), null);
  assert.equal(whatsappListLink('12345', 'x'), null);
  assert.equal(whatsappListLink('+919000000000', 'a b'), 'https://wa.me/919000000000?text=a%20b');
});
