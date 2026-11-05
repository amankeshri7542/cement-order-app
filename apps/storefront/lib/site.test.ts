import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteConfig } from './site';

test('indexing needs both the switch and a real https address', () => {
  assert.equal(siteConfig({ SITE_INDEXING: 'on', SITE_URL: 'https://a.in' }).indexingOn, true);
  assert.equal(siteConfig({ SITE_INDEXING: 'on', SITE_URL: 'http://a.in' }).indexingOn, false);
  assert.equal(siteConfig({ SITE_INDEXING: 'off', SITE_URL: 'https://a.in' }).indexingOn, false);
  assert.equal(siteConfig({ SITE_URL: 'https://a.in' }).indexingOn, false);
  assert.equal(siteConfig({ SITE_INDEXING: 'on' }).indexingOn, false);
});
test('a trailing slash never reaches a canonical link', () => {
  assert.equal(siteConfig({ SITE_URL: 'https://a.in///' }).siteUrl, 'https://a.in');
});
test('with no address it points at the local server, never at a stranger', () => {
  assert.equal(siteConfig({}).siteUrl, 'http://localhost:3003');
  assert.equal(siteConfig({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).indexingOn, false);
});
