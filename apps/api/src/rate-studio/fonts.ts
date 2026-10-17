import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Rate cards are SVG rasterised by sharp (librsvg + pango), which finds fonts only through
// fontconfig. Teko 600 (Latin and Devanagari) ships as an npm package rather than a system
// font, so before the first card is drawn this process gets a fontconfig file that keeps the
// machine's own fonts (DejaVu and Noto in the Docker image) and adds Teko's folder. On macOS,
// pango would otherwise use CoreText and ignore fontconfig, so local cards would not match.

/** Teko first; Noto and DejaVu cover any script Teko lacks. */
export const displayFamily = "Teko, 'Noto Sans Devanagari', 'DejaVu Sans', sans-serif";

let ready = false;

const xml = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function registerCardFonts(): void {
  if (ready) return;
  ready = true;
  try {
    const teko = dirname(
      require.resolve('@expo-google-fonts/teko/600SemiBold/Teko_600SemiBold.ttf'),
    );
    const base = process.env.FONTCONFIG_FILE || '/etc/fonts/fonts.conf';
    const mac =
      process.platform === 'darwin'
        ? ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library/Fonts')]
        : [];
    const folder = join(tmpdir(), `shiv-card-fonts-${process.getuid?.() ?? 'user'}`);
    mkdirSync(join(folder, 'cache'), { recursive: true });
    const file = join(folder, 'fonts.conf');
    writeFileSync(
      file,
      [
        '<?xml version="1.0"?>',
        '<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
        '<fontconfig>',
        `  <include ignore_missing="yes">${xml(base)}</include>`,
        ...[...mac, teko].map((dir) => `  <dir>${xml(dir)}</dir>`),
        `  <cachedir>${xml(join(folder, 'cache'))}</cachedir>`,
        '</fontconfig>',
        '',
      ].join('\n'),
    );
    process.env.FONTCONFIG_FILE = file;
    process.env.PANGOCAIRO_BACKEND = 'fc';
  } catch {
    // Without Teko the card falls back to Noto or DejaVu; prices and text stay correct.
  }
}
