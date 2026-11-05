// Bakes the website's drawings to flat AVIF files, so no engraver ever runs on a customer's phone.
//
//   node scripts/bake-plates.mjs [plate-name ...]     (no names means every plate)
//
// Output goes to apps/storefront/art/ with a generated index.ts of static imports. Next hashes the
// files and serves them as immutable, so a commissioned drawing can replace any file of the same
// name with no code change. Fails when a plate is over its budget (plan 03 section 8.4).
import { createRequire } from 'node:module';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { ENGRAVER } = require('./art/engraver.cjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/storefront/art');
mkdirSync(out, { recursive: true });
const only = new Set(process.argv.slice(2));
const E = ENGRAVER();

const paper = [234, 231, 222];
const paperDown = [222, 218, 206];
const ink = [25, 29, 27];
const night = [18, 21, 19];
const nightInk = [226, 222, 208];
const lamp = [242, 163, 58];
const hex = (rgb) => ({ r: rgb[0], g: rgb[1], b: rgb[2] });

// The two canvases everything is drawn for: 1440 x 900 at 2x, and 390 x 844 at 2x.
const DPR = 2;
const PITCH = 3.4;
const desktop = {
  hero: { w: 1008, h: 900, k: 55.8, cx: (1440 * 0.772 - 432) / 1008, hy: 0.95, eye: 2.3 },
  story: { w: 1008, h: 900, k: 48, cx: (1440 * 0.695 - 432) / 1008, hy: 0.8, eye: 2.6 },
  moonX: 0.12,
  moonY: 0.15,
  vw: 1440,
  vh: 900,
};
const phoneStoryK = 21.7;
const phone = {
  hero: { w: 390, h: 546, k: 390 / 14, cx: 0.635, hy: (48.96 + 13.7 * (390 / 14)) / 546, eye: 2.3 },
  story: {
    w: 390,
    h: 412,
    k: phoneStoryK,
    cx: 0.5,
    hy: (3 + 14.6 * phoneStoryK) / 412,
    eye: 2.6,
    fade: true,
  },
  moonX: 0.9,
  moonY: 0.075,
  vw: 390,
  vh: 844,
};

const manifest = { desktop: {}, phone: {} };
const sizes = [];
const budgets = { 'hero-m': 70, 'hero-d': 180 };

async function save(name, rgba, W, H, { flat, quality = 38 }) {
  if (only.size && !only.has(name)) return;
  let image = sharp(Buffer.from(rgba.buffer), { raw: { width: W, height: H, channels: 4 } });
  if (flat) image = image.flatten({ background: hex(flat) });
  const file = join(out, `${name}.avif`);
  await image.avif({ quality, effort: 7, chromaSubsampling: '4:2:0' }).toFile(file);
  const kb = statSync(file).size / 1024;
  sizes.push([name, W, H, Math.round(kb)]);
  if (budgets[name] && kb > budgets[name])
    throw new Error(`${name} is ${kb.toFixed(1)} KB, over its ${budgets[name]} KB budget.`);
}

function sceneOptions(layout, box, isNight, extra = {}) {
  const W = Math.round(box.w * DPR);
  const H = Math.round(box.h * DPR);
  return {
    W,
    H,
    o: {
      pitch: PITCH,
      night: isNight,
      k: box.k * DPR,
      cx: W * box.cx,
      hy: H * box.hy,
      groundCx: W * box.cx,
      eye: box.eye,
      fadeBottom: box.fade,
      moonX: layout.moonX,
      moonY: layout.moonY,
      ...extra,
    },
  };
}

async function scene(name, key, layout, box, isNight, extra) {
  if (only.size && !only.has(name)) return;
  const { W, H, o } = sceneOptions(layout, box, isNight, extra);
  const plate = E.renderScene(key, W, H, o);
  const rgba = E.toRGBA(plate, isNight ? night : paper, isNight ? nightInk : ink, lamp);
  await save(name, rgba, W, H, { flat: isNight ? night : paper });
}

// Where the rope's pan hangs, as a share of the hero canvas, so it needs no measuring in a browser.
function panBox(box) {
  const F0 = box.k * 30;
  const cxp = box.w * box.cx;
  const hyp = box.h * box.hy;
  const prj = (x, y, z) => {
    const dx = x - 22.6;
    const dz = z + 24;
    const xc = dx * 0.857 + dz * 0.514;
    const zc = -dx * 0.514 + dz * 0.857;
    return [cxp + (F0 * xc) / zc, hyp - (F0 * (y - box.eye)) / zc];
  };
  const tip = prj(-0.45, 15.54, -1.5);
  const low = prj(-0.45, 7.3, -1.5);
  const high = prj(-0.45, 13.4, -1.5);
  const pw = Math.max(44, box.k * 1.05);
  const tall = low[1] - tip[1] + pw;
  return { tip, pw, tall, rise: low[1] - high[1] };
}

// The lit house is cut into bays, so its windows come on one bay at a time.
function sliceCuts(box) {
  const W = box.w;
  const F = box.k * 30;
  const cx = W * box.cx;
  const prx = (x, z) => {
    const dx = x - 22.6;
    const dz = z + 24;
    const xc = dx * 0.857 + dz * 0.514;
    const zc = -dx * 0.514 + dz * 0.857;
    return cx + (F * xc) / zc;
  };
  return [0, prx(3.2, 0), prx(6.4, 0), prx(9.62, 0), prx(9.6, 4.33), prx(9.6, 8.67), W].map((v) =>
    Number((v / W).toFixed(4)),
  );
}

async function clouds(layout, suffix) {
  const { vw, vh } = layout;
  const isPhone = suffix === 'm';
  const scale = isPhone ? 2 : 1.5;
  const pitch = isPhone ? PITCH : 2.8;
  const fw = vw * 1.08;
  const topH = vh * 0.84;
  const underH = vh * 0.46;
  const W = Math.round(fw * scale);
  const H = Math.round(topH * scale);
  const wallY = H * 0.5;
  const bank = vh * scale;
  const shapes = isPhone
    ? [
        { x: W * 0.12, y: wallY + bank * 0.045, w: W * 0.8, h: bank * 0.09, n: 7, depth: 1 },
        { x: W * 0.74, y: wallY + bank * 0.05, w: W * 0.95, h: bank * 0.2, n: 8, depth: 2 },
      ]
    : [
        { x: W * 0.12, y: wallY + bank * 0.05, w: W * 0.4, h: bank * 0.075, n: 8, depth: 1 },
        { x: W * 0.36, y: wallY + bank * 0.05, w: W * 0.34, h: bank * 0.1, n: 7, depth: 1 },
        { x: W * 0.56, y: wallY + bank * 0.05, w: W * 0.28, h: bank * 0.15, n: 6, depth: 2 },
        { x: W * 0.76, y: wallY + bank * 0.07, w: W * 0.46, h: bank * 0.3, n: 9, depth: 2 },
        { x: W * 0.98, y: wallY + bank * 0.07, w: W * 0.26, h: bank * 0.2, n: 5, depth: 2 },
      ];
  const name = `clouds-top-${suffix}`;
  if (!only.size || only.has(name)) {
    const plate = E.renderClouds(W, H, {
      pitch,
      seed: 3,
      hushLeft: isPhone ? 0.9 : 0.6,
      shadeEnd: H,
      wall: { top: wallY, bottom: H * 2 },
      clouds: shapes,
    });
    await save(name, E.toRGBA(plate, paper, ink, lamp), W, H, { quality: 38 });
  }
  const uName = `clouds-under-${suffix}`;
  if (!only.size || only.has(uName)) {
    const us = Math.min(scale, 1.5);
    const uW = Math.round(fw * us);
    const uH = Math.round(underH * us);
    const plate = E.renderClouds(uW, uH, {
      pitch: pitch * 0.86,
      seed: 13,
      gain: 0.8,
      ceiling: uH * 0.3,
      shadeStart: uH * 0.3,
      edge: 0.6,
      clouds: [
        { x: uW * 0.18, y: uH * 0.3, w: uW * 0.6, h: uH * 0.6, n: 8, depth: 2, down: 1 },
        { x: uW * 0.62, y: uH * 0.3, w: uW * 0.66, h: uH * 0.82, n: 10, depth: 2, down: 1 },
        { x: uW * 0.95, y: uH * 0.3, w: uW * 0.4, h: uH * 0.64, n: 6, depth: 2, down: 1 },
      ],
    });
    await save(uName, E.toRGBA(plate, paper, ink, lamp), uW, uH, { quality: 38 });
  }
  if (!isPhone && (!only.size || only.has('clouds-back-d'))) {
    const bW = Math.round(vw * 1.04 * 1.5);
    const bH = Math.round(vh * 1.5);
    const plate = E.renderClouds(bW, bH, {
      pitch: pitch * 0.9,
      seed: 8,
      gain: 0.46,
      soft: 12,
      edge: 0.45,
      fadeBelow: bH * 0.9,
      fadeLen: bH * 0.08,
      clouds: [{ x: bW * 1.0, y: bH * 0.62, w: bW * 0.3, h: bH * 0.2, n: 5, depth: 1 }],
    });
    await save('clouds-back-d', E.toRGBA(plate, paper, ink, lamp), bW, bH, { quality: 36 });
  }
  // The solid middle of the wall is plain paper, so it costs no picture.
  return { topH: 0.84, solidH: 1.05, underH: 0.46, wallTop: 0.42, width: 1.08 };
}

async function object(name, key, W, H, opts = {}) {
  if (only.size && !only.has(name)) return;
  const plate = E.renderObject(key, W, H, { pitch: PITCH, night: false });
  const rgba = E.toRGBA(plate, opts.paper || paper, ink, lamp);
  await save(name, rgba, W, H, { flat: opts.flat, quality: opts.quality ?? 40 });
}

async function device(layout, suffix) {
  const { hero, story } = layout;
  const tag = suffix === 'd' ? 'desktop' : 'phone';
  await scene(`hero-${suffix}`, 'hero', layout, hero, false, { noPan: true });
  for (let i = 1; i <= 5; i++) await scene(`s${i}-${suffix}`, i, layout, story, false);
  await scene(`home-dusk-${suffix}`, 6, layout, story, true, { lightsOff: true });
  await scene(`home-lit-${suffix}`, 6, layout, story, true);
  const naksha = `naksha-${suffix}`;
  if (!only.size || only.has(naksha)) {
    const W = Math.round(story.w * DPR);
    const H = Math.round(story.h * DPR);
    const plate = E.renderGhost(W, H, {
      pitch: PITCH,
      k: story.k * DPR,
      cx: W * story.cx,
      hy: H * story.hy,
      eye: story.eye,
    });
    await save(naksha, E.toRGBA(plate, paper, ink, lamp), W, H, { quality: 45 });
  }
  const pan = panBox(hero);
  await object(`pan-${suffix}`, 'pan', Math.round(pan.pw * DPR), Math.round(pan.tall * DPR));
  const round = (v) => Number(v.toFixed(4));
  manifest[tag] = {
    hero: { width: Math.round(hero.w * DPR), height: Math.round(hero.h * DPR) },
    story: { width: Math.round(story.w * DPR), height: Math.round(story.h * DPR) },
    pan: {
      left: round((pan.tip[0] - pan.pw / 2) / hero.w),
      top: round(pan.tip[1] / hero.h),
      width: round(pan.pw / hero.w),
      height: round(pan.tall / hero.h),
      rise: round(pan.rise / pan.tall),
    },
    slices: sliceCuts(story),
    thread: {
      left: round((story.w * story.cx - story.k * 30 * 0.245) / story.w),
      width: round((story.k * 30 * 0.48) / story.w),
    },
    clouds: await clouds(layout, suffix),
  };
}

await device(desktop, 'd');
await device(phone, 'm');
await object('tractor', 'tractor', 860, 430);
// Specimens, flat on the page's own paper.
await object('sp-cement', 'cement', 1000, 800, { flat: paper });
await object('sp-sariya', 'sariya', 1400, 860, { flat: paper });
await object('sp-bricks', 'bricks', 800, 680, { flat: paper });
await object('sp-balu', 'balu', 800, 600, { flat: paper });
await object('sp-gitti', 'gitti', 800, 600, { flat: paper });
await object('plumb', 'plumb', 400, 1040, { flat: paperDown });

if (!only.size) {
  const names = sizes.map(([name]) => name).sort();
  const lines = [
    '// Generated by scripts/bake-plates.mjs. Do not edit by hand.',
    ...names.map(
      (name) =>
        `import ${name.replace(/-(\w)/g, (_, c) => c.toUpperCase())} from './${name}.avif';`,
    ),
    '',
    'export const plates = {',
    ...names.map((name) => `  '${name}': ${name.replace(/-(\w)/g, (_, c) => c.toUpperCase())},`),
    '} as const;',
    '',
  ];
  writeFileSync(join(out, 'index.ts'), lines.join('\n'));
  // Numbers only, so the film's code can read them without pulling in every image.
  writeFileSync(
    join(out, 'geometry.ts'),
    `// Generated by scripts/bake-plates.mjs. Do not edit by hand.\nexport const geometry = ${JSON.stringify(manifest, null, 2)} as const;\n`,
  );
}
for (const [name, W, H, kb] of sizes) console.log(`${name.padEnd(16)} ${W}x${H}  ${kb} KB`);
console.log(`total ${sizes.reduce((sum, row) => sum + row[3], 0)} KB`);
