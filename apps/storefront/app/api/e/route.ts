// Anonymous page numbers and a few funnel events. No cookies, no IP, no ids: one log line each.
const NAMES = new Set([
  'LCP',
  'INP',
  'CLS',
  'FCP',
  'TTFB',
  'added',
  'list_opened',
  'whatsapp',
  'asked',
  'signin',
  'order_placed',
  'rate_asked',
  'film_stepdown',
  'search_empty',
]);
const MAX_BYTES = 512;
// A script posting all day must not fill the logs. Real traffic here is far below this.
const MAX_PER_MINUTE = 600;
let minute = 0;
let written = 0;
function allowed(now = Date.now()) {
  const current = Math.floor(now / 60000);
  if (current !== minute) {
    minute = current;
    written = 0;
  }
  return ++written <= MAX_PER_MINUTE;
}

export async function POST(request: Request) {
  // Refused unread: a huge body costs nothing, and the answer is the same whatever is sent.
  const size = Number(request.headers.get('content-length') ?? 0);
  if (!(size > 0) || size > MAX_BYTES || !allowed()) return new Response(null, { status: 204 });
  const text = await request.text().catch(() => '');
  if (!text || text.length > MAX_BYTES) return new Response(null, { status: 204 });
  try {
    const { name, value, path, tier, memory } = JSON.parse(text) as Record<string, unknown>;
    if (typeof name === 'string' && NAMES.has(name))
      console.info(
        JSON.stringify({
          event: 'WEB_EVENT',
          name,
          value: typeof value === 'number' && Number.isFinite(value) ? value : undefined,
          // Paths only ever name public pages. Anything else is dropped rather than logged.
          path: typeof path === 'string' && /^\/[\w/-]{0,120}$/.test(path) ? path : undefined,
          tier: tier === 'full' || tier === 'lite' || tier === 'still' ? tier : undefined,
          memory: typeof memory === 'number' && memory >= 0 && memory <= 64 ? memory : undefined,
        }),
      );
  } catch {
    /* Bad input is ignored: the answer is the same either way. */
  }
  return new Response(null, { status: 204 });
}
