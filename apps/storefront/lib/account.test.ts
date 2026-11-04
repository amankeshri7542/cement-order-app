import assert from 'node:assert/strict';
import test from 'node:test';
import { deviceLabel } from './devices';
import { orderShareText, whatsappShareUrl, type ShareableOrder } from './share';

// Isolated synthetic order: never shown as storefront content.
const order: ShareableOrder = {
  number: 'SCS-TEST-0001',
  status: 'CONFIRMED',
  deliveryFeePaise: 15000,
  totalPaise: 395000,
  items: [
    { name: 'TEST Cement PPC', quantity: 10, unit: 'bag', lineTotalPaise: 380000 },
    { name: 'TEST Steel TMT', quantity: 5, unit: 'kg', lineTotalPaise: 0 },
  ],
};

test('order share text lists number, status, items with units and the total', () => {
  assert.equal(
    orderShareText(order, 'en'),
    [
      'Shiv Cement Store — order summary (not a GST invoice)',
      'Order SCS-TEST-0001',
      'Status: Confirmed',
      'TEST Cement PPC × 10 bag = ₹3,800.00',
      'TEST Steel TMT × 5 kg = ₹0.00',
      'Delivery: ₹150.00',
      'Total: ₹3,950.00',
    ].join('\n'),
  );
  const hindi = orderShareText({ ...order, status: 'DELIVERED' }, 'hi');
  assert.match(hindi, /^शिव सीमेंट स्टोर — ऑर्डर सारांश \(GST बिल नहीं\)\n/);
  assert.match(hindi, /\nस्थिति: डिलीवरी हो गई\n/);
  assert.match(hindi, /\nकुल: ₹3,950.00$/);
});

test('the share text carries no address or phone fields even when the order has them', () => {
  const full = {
    ...order,
    address: { name: 'Private Person', line1: 'Plot 18', phone: '+919876543210' },
  };
  const text = orderShareText(full, 'en');
  assert.doesNotMatch(text, /Private Person|Plot 18|9876543210/);
});

test('the WhatsApp link opens the contact picker with the encoded summary', () => {
  const url = whatsappShareUrl('Order SCS-1 & more\n= ₹10');
  assert.ok(url.startsWith('https://wa.me/?text='));
  assert.equal(
    decodeURIComponent(url.slice('https://wa.me/?text='.length)),
    'Order SCS-1 & more\n= ₹10',
  );
  assert.doesNotMatch(url, /[\s&]more/);
});

test('signed-in devices read as browser and system, in either language', () => {
  const android =
    'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
  assert.equal(deviceLabel(android, 'en'), 'Chrome on Android phone');
  assert.equal(deviceLabel(android, 'hi'), 'Android फ़ोन पर Chrome');
  assert.equal(
    deviceLabel(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'en',
    ),
    'Safari on iPhone',
  );
  assert.equal(
    deviceLabel(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      'en',
    ),
    'Edge on Windows computer',
  );
  assert.equal(deviceLabel('okhttp/4.12.0', 'en'), 'Customer app on Android');
  assert.equal(deviceLabel('Unknown device', 'hi'), 'अनजान डिवाइस');
  assert.equal(deviceLabel('  ', 'en'), 'Unknown device');
  // Anything unrecognised is shown as stored, shortened.
  assert.equal(deviceLabel('ShivAccountTest/1.0', 'en'), 'ShivAccountTest/1.0');
  assert.equal(deviceLabel('x'.repeat(100), 'en'), `${'x'.repeat(59)}…`);
});
