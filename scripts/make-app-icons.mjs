#!/usr/bin/env node
// Draws the Android app icon, adaptive-icon layers, splash mark, the website favicon, the owner
// desk's install icons and the Play listing graphic from the shop's "शिव" stamp (the same mark as
// the website header). Renders with Google Chrome (as the browser tests do) so the Devanagari is
// shaped by a real text engine.
//
//   node scripts/make-app-icons.mjs
//
// Colours come from the shared palette (packages/shared/src/theme.ts, built to dist), so the
// icons, the splash and the Play listing graphic move with the rest of the brand. The launcher
// icon is the master plan's amber square with a navy stamp; the splash is that stamp on paper.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import shared from '@shiv/shared';

const { palette } = shared;
const root = new URL('..', import.meta.url).pathname;
const app = join(root, 'apps/mobile/assets');
const store = join(root, 'docs/play-store');
const desk = join(root, 'apps/admin/public');
const site = join(root, 'apps/storefront/app');
const amber = palette.accent;
const navy = palette.ink2;
const ink = palette.ink;
const muted = palette.muted;
const paper = palette.ground;
const font = "'Kohinoor Devanagari', 'Noto Sans Devanagari', 'Devanagari Sangam MN', sans-serif";

// The stamp: a block with one large rounded corner (as on the shop signboard), "शिव" on it.
const stamp = (size, x, y, color = navy, text = paper) => {
  const w = size;
  const h = size * 1.08;
  const r = size * 0.05;
  const big = size * 0.3;
  const block = `M${x + r},${y} H${x + w - big} A${big},${big} 0 0 1 ${x + w},${y + big} V${y + h - r}
    A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r}
    A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return `<path d="${block}" fill="${color}"/>
  <text x="${x + w / 2}" y="${y + h * 0.7}" text-anchor="middle" font-family="${font}"
        font-weight="700" font-size="${size * 0.5}" fill="${text}">शिव</text>`;
};

// The full launcher icon at any size: amber square with the navy stamp, laid out as at 1024.
const launcher = (size) => {
  const k = size / 1024;
  return `<rect width="${size}" height="${size}" fill="${amber}"/>${stamp(600 * k, 212 * k, 188 * k)}`;
};

// [file name, size or [width, height], drawing, folder]
const images = [
  // Full launcher icon (legacy and Play listing): amber square with the navy stamp.
  ['icon.png', 1024, launcher(1024), app],
  // Adaptive foreground: the stamp inside the 66% safe zone, transparent around it. The
  // adaptive background colour is the same amber, set in app.json.
  ['adaptive-icon.png', 1024, stamp(520, 252, 230), app],
  // Themed (monochrome) icon for Android 13+: a single-colour silhouette.
  ['adaptive-monochrome.png', 1024, stamp(520, 252, 230, '#000000', '#FFFFFF'), app],
  // Splash mark, shown centred on the paper splash background.
  ['splash-icon.png', 512, stamp(360, 76, 62), app],
  // Owner desk install icons (the web manifest) and the website favicon / touch icon.
  ['icon-192.png', 192, launcher(192), desk],
  ['icon-512.png', 512, launcher(512), desk],
  ['icon.png', 512, launcher(512), site],
  ['apple-icon.png', 180, launcher(180), site],
  // Google Play feature graphic (1024×500): the signboard with what the app does.
  [
    'feature-graphic.png',
    [1024, 500],
    `<rect width="1024" height="500" fill="${paper}"/><rect width="1024" height="16" fill="${amber}"/>
     <rect y="484" width="1024" height="16" fill="${amber}"/>${stamp(230, 70, 125)}
     <text x="350" y="205" font-family="${font}" font-weight="700" font-size="74" fill="${ink}">शिव सीमेंट स्टोर</text>
     <text x="352" y="262" font-family="${font}" font-size="34" fill="${muted}">Shiv Cement Store · पटना, बिहार</text>
     <text x="352" y="340" font-family="${font}" font-weight="700" font-size="38" fill="${ink}">आज के भाव · डिलीवरी पर भुगतान</text>
     <text x="352" y="390" font-family="${font}" font-size="30" fill="${muted}">Today’s rates · Cash on delivery · Bulk quotes</text>`,
    store,
  ],
];

for (const folder of new Set(images.map((image) => image[3])))
  mkdirSync(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, body, folder] of images) {
    const [width, height] = Array.isArray(size) ? size : [size, size];
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>
      </body></html>`,
    );
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.screenshot({ path: join(folder, name), omitBackground: true });
    console.log(join(folder, name).replace(root, ''));
  }
} finally {
  await browser.close();
}
