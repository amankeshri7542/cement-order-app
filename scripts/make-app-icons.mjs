#!/usr/bin/env node
// Draws the Android app icon, adaptive-icon layers and splash mark from the shop's "शिव" stamp
// (the same mark as the website header) and saves them under apps/mobile/assets/.
// Renders with Google Chrome (as the browser tests do) so the Devanagari is shaped by a real text engine.
//
//   node scripts/make-app-icons.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'apps/mobile/assets');
const store = join(root, 'docs/play-store');
const ink = '#173345';
const clay = '#B45438';
const paper = '#F5F3ED';
const font = "'Kohinoor Devanagari', 'Noto Sans Devanagari', 'Devanagari Sangam MN', sans-serif";

// The stamp: clay block with one large rounded corner (as on the shop signboard), "शिव" in
// paper white.
const stamp = (size, x, y, color = clay, text = paper) => {
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

const images = {
  // Full launcher icon (legacy and Play listing): ink square with the stamp.
  'icon.png': [1024, `<rect width="1024" height="1024" fill="${ink}"/>${stamp(600, 212, 188)}`],
  // Adaptive foreground: the stamp inside the 66% safe zone, transparent around it.
  'adaptive-icon.png': [1024, stamp(520, 252, 230)],
  // Themed (monochrome) icon for Android 13+: a single-colour silhouette.
  'adaptive-monochrome.png': [1024, stamp(520, 252, 230, '#000000', '#FFFFFF')],
  // Splash mark, shown centred on the ink splash background.
  'splash-icon.png': [512, stamp(360, 76, 62)],
  // Google Play feature graphic (1024×500): the signboard with what the app does.
  'feature-graphic.png': [
    [1024, 500],
    `<rect width="1024" height="500" fill="${ink}"/>${stamp(230, 70, 125)}
     <text x="350" y="205" font-family="${font}" font-weight="700" font-size="74" fill="${paper}">शिव सीमेंट स्टोर</text>
     <text x="352" y="262" font-family="${font}" font-size="34" fill="#F2B49C">Shiv Cement Store · पटना, बिहार</text>
     <text x="352" y="340" font-family="${font}" font-weight="700" font-size="38" fill="${paper}">आज के भाव · डिलीवरी पर भुगतान</text>
     <text x="352" y="390" font-family="${font}" font-size="30" fill="#C9D3D8">Today’s rates · Cash on delivery · Bulk quotes</text>`,
  ],
};

mkdirSync(out, { recursive: true });
mkdirSync(store, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, [size, body]] of Object.entries(images)) {
    const [width, height] = Array.isArray(size) ? size : [size, size];
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>
      </body></html>`,
    );
    await page.evaluate(() => globalThis.document.fonts.ready);
    const folder = name.startsWith('feature') ? store : out;
    await page.screenshot({ path: join(folder, name), omitBackground: true });
    console.log(join(folder, name).replace(root, ''));
  }
} finally {
  await browser.close();
}
