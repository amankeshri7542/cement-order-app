#!/usr/bin/env node
// What each public page really makes a browser fetch at load, against the budgets in plan 03
// section 8.4, read from a running production build. Fails over budget, or if an old heavy chunk or
// any Hindi script reaches a page.
//
//   node scripts/check-web-budgets.mjs http://localhost:3031
import { readdirSync, readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const base = (process.argv[2] || 'http://localhost:3003').replace(/\/$/, '');
const KB = 1024;
const budgets = {
  public: { js: 150 * KB, jsBr: 125 * KB, css: 8 * KB, html: 25 * KB },
  buy: { js: 240 * KB, jsBr: 200 * KB, css: 12 * KB, html: 25 * KB },
};
const routes = (process.env.BUDGET_ROUTES || '').split(',').filter(Boolean);
const publicRoutes = routes.length
  ? routes
  : [
      '/',
      '/rates',
      '/materials',
      '/materials/cement',
      '/about',
      '/contact',
      '/delivery',
      '/guide',
      '/privacy',
      '/terms',
    ];
const buyRoutes = routes.length ? [] : ['/list', '/account', '/checkout', '/quotes'];
const devanagari = /[ऀ-ॿ]/;
const cache = new Map();

async function asset(path) {
  if (cache.has(path)) return cache.get(path);
  const response = await fetch(new URL(path, base));
  const bytes = Buffer.from(await response.arrayBuffer());
  const found = {
    bytes: bytes.length,
    gzip: gzipSync(bytes).length,
    brotli: brotliCompressSync(bytes).length,
    text: bytes.toString('utf8'),
  };
  cache.set(path, found);
  return found;
}
const k = (bytes) => `${(bytes / KB).toFixed(1)}`;
let failed = 0;
const fail = (message) => {
  failed++;
  console.error(`FAIL ${message}`);
};

async function check(route, budget) {
  const response = await fetch(base + route, { redirect: 'manual' });
  const html = await response.text();
  if (response.status !== 200) return console.log(`${route}: answered ${response.status}, skipped`);
  // noModule polyfills are skipped by every modern browser, so they do not count.
  const scripts = [...html.matchAll(/<script[^>]+>/g)]
    .map((m) => m[0])
    .filter((tag) => !/\bnomodule\b/i.test(tag))
    .map((tag) => /\ssrc="([^"]+)"/.exec(tag)?.[1])
    .filter(Boolean);
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(
    (m) => m[1],
  );
  // Next preloads fonts through the Link header, and the page may name them as tags too.
  const fonts = [
    ...new Set([
      ...[...html.matchAll(/<link[^>]+>/g)]
        .map((m) => m[0])
        .filter((tag) => /\sas="font"/.test(tag))
        .map((tag) => /\shref="([^"]+)"/.exec(tag)?.[1])
        .filter(Boolean),
      ...(response.headers.get('link') ?? '')
        .split(/,\s*(?=<)/)
        .filter((part) => /as="?font/.test(part))
        .map((part) => /^<([^>]+)>/.exec(part)?.[1])
        .filter(Boolean),
    ]),
  ];
  const sum = async (files, key) => {
    let total = 0;
    for (const file of files) total += (await asset(file))[key];
    return total;
  };
  const js = await sum(scripts, 'gzip');
  const jsBr = await sum(scripts, 'brotli');
  const css = await sum(styles, 'gzip');
  const font = await sum(fonts, 'bytes');
  const page = gzipSync(html).length;
  console.log(
    `${route.padEnd(22)} js ${k(js).padStart(6)} gz ${k(jsBr).padStart(6)} br  css ${k(css).padStart(5)}  html ${k(page).padStart(5)}  font ${k(font).padStart(5)}  (${scripts.length} scripts)`,
  );
  if (js > budget.js) fail(`${route}: JS ${k(js)} KB gzip is over ${k(budget.js)} KB`);
  if (jsBr > budget.jsBr) fail(`${route}: JS ${k(jsBr)} KB brotli is over ${k(budget.jsBr)} KB`);
  if (css > budget.css) fail(`${route}: CSS ${k(css)} KB gzip is over ${k(budget.css)} KB`);
  if (page > budget.html) fail(`${route}: HTML ${k(page)} KB gzip is over ${k(budget.html)} KB`);
  if (fonts.length > 1 || font > 25 * KB)
    fail(`${route}: fonts ${fonts.length} files, ${k(font)} KB`);
  if (devanagari.test(html)) fail(`${route}: Hindi script in the HTML`);
  if (html.includes('data-placeholder'))
    fail(`${route}: a review placeholder in a production page`);
  if (/"stock"/.test(html)) fail(`${route}: a stock field in the HTML`);
  for (const file of scripts) {
    const { text } = await asset(file);
    if (devanagari.test(text)) fail(`${route}: Hindi script in ${file}`);
    if (text.includes('owner.legacy')) fail(`${route}: desk words in ${file}`);
  }
}

for (const route of publicRoutes) await check(route, budgets.public);
for (const route of buyRoutes) await check(route, budgets.buy);

// Unsigned guide articles never reach a customer build: a signed one may open, a draft may not.
const guideFolder = new URL('../content/advisor/', import.meta.url);
for (const file of readdirSync(guideFolder).filter((name) => name.endsWith('.md'))) {
  const slug = /^slug:\s*"?([\w-]+)"?/m.exec(readFileSync(new URL(file, guideFolder), 'utf8'))?.[1];
  if (!slug) continue;
  const response = await fetch(new URL(`/guide/${slug}`, base));
  const html = await response.text();
  if (response.status === 200 && html.includes('data-placeholder'))
    fail(`/guide/${slug}: a draft opens in production`);
}
if (failed) {
  console.error(`${failed} over budget`);
  process.exit(1);
}
console.log('All pages within budget.');
