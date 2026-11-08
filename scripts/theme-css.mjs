#!/usr/bin/env node
// Writes the Naksha 2 design tokens (packages/tokens) as CSS custom properties for the owner desk:
// light, dark ("night ledger"), the device's own choice, print, and the "Bada akshar" text sizes.
//
//   node scripts/theme-css.mjs          regenerate packages/design/src/tokens.css
//   node scripts/theme-css.mjs --check  exit 1 when the file is missing or out of date (the drift test)
//
// The website keeps its own tokens in apps/storefront/app/base.css until it is redesigned.
//
// Reads the built package (packages/tokens/dist), so run `npm run build -w @shiv/tokens` first.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import tokens from '@shiv/tokens';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'packages/design/src/tokens.css');
const check = process.argv.includes('--check');

if (typeof tokens.cssVariables !== 'function') {
  console.error('@shiv/tokens has no cssVariables(); run `npm run build -w @shiv/tokens` first.');
  process.exit(1);
}

const options = { ...(await prettier.resolveConfig(file)), filepath: file };
const css = await prettier.format(tokens.cssVariables(), options);
const name = relative(root, file);
let current = null;
try {
  current = readFileSync(file, 'utf8');
} catch {
  // Missing counts as stale.
}
if (current === css) {
  if (check) console.log(`${name} matches packages/tokens`);
  process.exit(0);
}
if (check) {
  console.error(`${name} is out of date with packages/tokens; run npm run theme:css`);
  process.exit(1);
}
writeFileSync(file, css);
console.log(`wrote ${name}`);
