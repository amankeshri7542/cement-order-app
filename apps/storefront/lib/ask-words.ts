// Ask's fixed words, kept small here so the panel carries no zod. lib/ask-words.test.ts fails if
// they drift from the reviewed text in packages/shared/src/advisor.ts.
/** The one thing Ask keeps in the browser. It holds no conversation, and goes on signing out. */
export const ASK_DEVICE_KEY = 'shiv_advisor_device_v1';
export const askWords = {
  speaker: 'Shiv Cement AI',
  deviceHeader: 'x-advisor-device',
  checking: 'Checking the guide…',
  title: 'Ask about building your home.',
  firstOpen:
    'I am an AI. I explain materials and building. For structure and safety, I send you to an engineer.',
  underBox: 'AI answers. Do not share your phone number or address here.',
  sourceLine:
    'From our guide: {title}. Checked by a civil engineer, {month}. General guide, not advice on your house.',
  askShop: 'Ask the shop on WhatsApp',
  labels: {
    CHECKED: 'Checked',
    GENERAL: 'General, not checked',
    AI_BUSY: 'AI is busy. This is from our checked guide.',
    FROM_GUIDE: 'This is from our checked guide.',
  },
  starters: [
    'What do I buy first?',
    'How do I check bricks before I pay?',
    'How do I store cement at site?',
    'How much sariya do I need for a 1,000 sq ft slab?',
  ],
} as const;

/** "2027-03" as "March 2027". */
export function checkedMonth(checkedOn: string) {
  const [year, month] = checkedOn.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return '';
  return new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** One block of `event:`/`data:` text from the stream, or null while it is still arriving. */
export function parseEvents(buffer: string) {
  const events: unknown[] = [];
  let rest = buffer;
  for (;;) {
    const end = rest.indexOf('\n\n');
    if (end < 0) break;
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      /* A broken block is skipped. `done` always brings the whole answer. */
    }
  }
  return { events, rest };
}
