import assert from 'node:assert/strict';
import test from 'node:test';
import { siteConfig } from './site';

test('the site address defaults to local and loses a trailing slash', () => {
  assert.equal(siteConfig({}).siteUrl, 'http://localhost:3003');
  assert.equal(
    siteConfig({ SITE_URL: 'https://shop.example.in/' }).siteUrl,
    'https://shop.example.in',
  );
});

test('indexing needs both the switch and an https address', () => {
  assert.equal(siteConfig({}).indexingOn, false);
  assert.equal(siteConfig({ SITE_INDEXING: 'on' }).indexingOn, false);
  assert.equal(
    siteConfig({ SITE_URL: 'http://shop.example.in', SITE_INDEXING: 'on' }).indexingOn,
    false,
  );
  assert.equal(
    siteConfig({ SITE_URL: 'https://shop.example.in', SITE_INDEXING: 'off' }).indexingOn,
    false,
  );
  assert.equal(
    siteConfig({ SITE_URL: 'https://shop.example.in', SITE_INDEXING: 'on' }).indexingOn,
    true,
  );
});

test('on Vercel the production address stands in until SITE_URL is set', () => {
  assert.equal(
    siteConfig({ VERCEL_PROJECT_PRODUCTION_URL: 'shiv.vercel.app' }).siteUrl,
    'https://shiv.vercel.app',
  );
  assert.equal(
    siteConfig({ VERCEL_PROJECT_PRODUCTION_URL: 'shiv.vercel.app', SITE_URL: 'https://shop.in' })
      .siteUrl,
    'https://shop.in',
  );
});
