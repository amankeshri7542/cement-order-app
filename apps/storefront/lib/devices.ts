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
const systems: [RegExp, string][] = [
  [/Android/, 'Android phone'],
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Windows/, 'Windows computer'],
  [/CrOS/, 'Chromebook'],
  [/Macintosh|Mac OS X/, 'Mac'],
  [/Linux/, 'Linux computer'],
];

/** A readable name for a signed-in device: "Chrome on Android phone", or the label as stored. */
export function deviceLabel(raw: string): string {
  const label = raw.trim();
  // The customer app signs in through Android's HTTP client rather than a browser.
  if (/^okhttp\//i.test(label)) return 'Customer app on Android';
  if (!label || label === 'Unknown device') return 'Unknown device';
  const browser = browsers.find(([pattern]) => pattern.test(label))?.[1];
  const place = systems.find(([pattern]) => pattern.test(label))?.[1] ?? '';
  if (browser && place) return `${browser} on ${place}`;
  return place || browser || (label.length > 60 ? `${label.slice(0, 59)}…` : label);
}
