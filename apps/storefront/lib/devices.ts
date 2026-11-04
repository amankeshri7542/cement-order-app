import type { Language } from '@shiv/shared';

// Sessions keep the raw user agent of the sign-in request. Order matters: Edge and Opera also
// say "Chrome", Chrome also says "Safari", and Android and iPhone agents also name Linux and Mac.
const browsers: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/Firefox|FxiOS/, 'Firefox'],
  [/Chrome|CriOS/, 'Chrome'],
  [/Safari/, 'Safari'],
];
const systems: [RegExp, string, string][] = [
  [/Android/, 'Android phone', 'Android फ़ोन'],
  [/iPhone/, 'iPhone', 'iPhone'],
  [/iPad/, 'iPad', 'iPad'],
  [/Windows/, 'Windows computer', 'Windows कंप्यूटर'],
  [/CrOS/, 'Chromebook', 'Chromebook'],
  [/Macintosh|Mac OS X/, 'Mac', 'Mac'],
  [/Linux/, 'Linux computer', 'Linux कंप्यूटर'],
];

/** A readable name for a signed-in device: "Chrome on Android phone", or the label as stored. */
export function deviceLabel(raw: string, language: Language): string {
  const hi = language === 'hi';
  const label = raw.trim();
  // The customer app signs in through Android's HTTP client rather than a browser.
  if (/^okhttp\//i.test(label)) return hi ? 'Android फ़ोन पर ग्राहक ऐप' : 'Customer app on Android';
  if (!label || label === 'Unknown device') return hi ? 'अनजान डिवाइस' : 'Unknown device';
  const browser = browsers.find(([pattern]) => pattern.test(label))?.[1];
  const system = systems.find(([pattern]) => pattern.test(label));
  const place = system ? (hi ? system[2] : system[1]) : '';
  if (browser && place) return hi ? `${place} पर ${browser}` : `${browser} on ${place}`;
  return place || browser || (label.length > 60 ? `${label.slice(0, 59)}…` : label);
}
