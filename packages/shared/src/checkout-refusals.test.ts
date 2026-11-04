import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkoutRefusalCodes, isCheckoutRefusal } from './errors';

const root = resolve(import.meta.dirname, '../../..');

test('booking-limit refusals end a pending checkout; uncertain failures keep it', () => {
  for (const code of ['DEMAND_REVIEW_REQUIRED', 'DEMAND_PAUSED', 'RESOURCE_LIMIT'])
    assert.ok(isCheckoutRefusal(code), code);
  for (const code of [
    'NETWORK_ERROR',
    'INTERNAL_ERROR',
    'DATABASE_UNAVAILABLE',
    'DRAINING',
    'CONFLICT',
    'IDEMPOTENCY_CONFLICT',
    'RATE_LIMITED',
    undefined,
  ])
    assert.equal(isCheckoutRefusal(code), false, String(code));
});

test('every refusal code is one the API actually throws', () => {
  const dir = resolve(root, 'apps/api/src');
  const source = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(resolve(dir, name), 'utf8'))
    .join('\n');
  for (const code of checkoutRefusalCodes) assert.ok(source.includes(`'${code}'`), code);
});

test('the app and the website use the shared list, not their own copies', () => {
  for (const file of ['apps/mobile/src/checkout.tsx', 'apps/storefront/components/checkout.tsx']) {
    const text = readFileSync(resolve(root, file), 'utf8');
    assert.match(text, /isCheckoutRefusal\(e\.code\)/, file);
    assert.doesNotMatch(text, /'REVIEW_EXPIRED',\s*\n\s*'CART_CHANGED'/, file);
  }
});
