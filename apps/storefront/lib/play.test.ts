import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedPlayUrl } from './play';

test('only a Google Play address for an app is accepted', () => {
  const good = 'https://play.google.com/store/apps/details?id=in.shivcement.store';
  assert.equal(approvedPlayUrl(good), good);
  assert.equal(approvedPlayUrl(`${good}&hl=hi`), `${good}&hl=hi`);
  for (const bad of [
    undefined,
    '',
    'http://play.google.com/store/apps/details?id=in.shivcement.store',
    'https://play.google.com.evil.example/store/apps/details?id=x',
    'https://evil.example/https://play.google.com/store/apps/details?id=x',
    'javascript:alert(1)',
    'https://play.google.com/store/apps/details?id=a b',
  ])
    assert.equal(approvedPlayUrl(bad), '', String(bad));
});
