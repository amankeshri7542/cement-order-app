#!/usr/bin/env node
// Audits the app screen currently on a connected emulator/phone for two TalkBack basics:
// every tappable control has a spoken name, and every touch target is at least 48dp.
// Prints problems and appends them to .local/android/a11y-<name>.json.
//
//   node scripts/android-a11y-audit.mjs --name basket [--serial emulator-5554]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const name = arg('name', 'screen');
const serial = arg('serial', '');
const root = new URL('..', import.meta.url).pathname;
const sdk = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
const adb = (...args) =>
  execFileSync(join(sdk, 'platform-tools/adb'), [...(serial ? ['-s', serial] : []), ...args], {
    encoding: 'utf8',
  });

const density = Number(adb('shell', 'wm', 'density').match(/(\d+)\s*$/m)?.[1] || 160);
const screenHeight = Number(adb('shell', 'wm', 'size').match(/x(\d+)/)?.[1] || 1e9);
const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
const nodes = [...xml.matchAll(/<node ([^>]*?)(\/?)>/g)].map((match, index) => {
  const attrs = Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]),
  );
  const [x1, y1, x2, y2] = (attrs.bounds?.match(/\d+/g) || []).map(Number);
  return { index, attrs, x1, y1, x2, y2, selfClosing: match[2] === '/' };
});
const inside = (outer, inner) =>
  inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;
const problems = [];
for (const node of nodes) {
  const { attrs } = node;
  if (attrs.package !== 'in.shivcement.store' || attrs.clickable !== 'true') continue;
  if (attrs['visible-to-user'] === 'false') continue;
  const widthDp = Math.round(((node.x2 - node.x1) * 160) / density);
  const heightDp = Math.round(((node.y2 - node.y1) * 160) / density);
  const own = attrs['content-desc'] || attrs.text || '';
  const child = nodes.find(
    (other) =>
      other !== node && inside(node, other) && (other.attrs.text || other.attrs['content-desc']),
  );
  const label = own || child?.attrs.text || child?.attrs['content-desc'] || '';
  // Ignore targets partly scrolled out of view (clipped by the screen or a scroll container).
  const clipped =
    node.y1 <= 0 ||
    node.y2 >= screenHeight ||
    nodes.some(
      (other) =>
        other.attrs.scrollable === 'true' &&
        inside(other, node) &&
        (node.y1 <= other.y1 || node.y2 >= other.y2 || node.x1 <= other.x1 || node.x2 >= other.x2),
    );
  if (!label.trim())
    problems.push({ problem: 'no spoken name', bounds: attrs.bounds, class: attrs.class });
  if (!clipped && (widthDp < 48 || heightDp < 48))
    problems.push({
      problem: `touch target ${widthDp}×${heightDp}dp`,
      label,
      bounds: attrs.bounds,
    });
}
mkdirSync(join(root, '.local/android'), { recursive: true });
writeFileSync(
  join(root, `.local/android/a11y-${name}.json`),
  `${JSON.stringify(problems, null, 2)}\n`,
);
console.log(`${name}: ${problems.length ? `${problems.length} problem(s)` : 'ok'}`);
for (const problem of problems)
  console.log(`  ${problem.problem}${problem.label ? ` · ${problem.label}` : ''}`);
process.exitCode = problems.length ? 1 : 0;
