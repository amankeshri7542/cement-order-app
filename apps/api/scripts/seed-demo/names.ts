import type { Rng } from './rng';

// Names are put together from syllables, so no seeded person is a real one. Places are real Patna
// areas, because the desk groups customers by area and invented areas would read wrong.
const starts = [
  'Ra',
  'Su',
  'Vi',
  'Ma',
  'De',
  'Ka',
  'Pra',
  'Shi',
  'A',
  'Ni',
  'Ja',
  'Ha',
  'Go',
  'Bi',
];
const middles = ['j', 'n', 'sh', 'v', 'm', 'r', 'k', 'l', 'nd', 'th', 'dh', 'b'];
const ends = ['esh', 'an', 'ay', 'ish', 'endra', 'ohan', 'ant', 'ul', 'eev', 'ik', 'ita', 'una'];
const familyStarts = ['Pra', 'Ya', 'Si', 'Ku', 'Cha', 'Sha', 'Mi', 'Pa', 'Ro', 'Ve'];
const familyEnds = ['sad', 'dav', 'nha', 'mar', 'udhary', 'rma', 'shra', 'ndey', 'y', 'rma'];

export const patnaAreas = [
  ['Kankarbagh', '800020'],
  ['Boring Road', '800001'],
  ['Rajendra Nagar', '800016'],
  ['Danapur', '801503'],
  ['Phulwari Sharif', '801505'],
  ['Bailey Road', '800014'],
  ['Patliputra Colony', '800013'],
  ['Anisabad', '800002'],
  ['Bypass', '800007'],
  ['Digha', '800011'],
  ['Khagaul', '801105'],
  ['Saguna More', '801503'],
] as const;

export function personName(rng: Rng): string {
  const first = rng.pick(starts) + rng.pick(middles) + rng.pick(ends);
  const family = rng.pick(familyStarts) + rng.pick(familyEnds);
  return `${first} ${family}`;
}

export function firmName(rng: Rng): string {
  const word = rng.pick(familyStarts) + rng.pick(middles) + rng.pick(ends);
  return `${word} ${rng.pick(['Construction', 'Builders', 'Enterprises', 'Infra', 'Contractors'])}`;
}

/**
 * Unique Indian mobile numbers. Each matches the app's phone rule, so any of them could belong to
 * a real person: that is why the API sends nothing while demo data is loaded (the sink lock).
 */
export class PhoneBook {
  private readonly used = new Set<string>();

  constructor(private readonly rng: Rng) {}

  next(): string {
    for (;;) {
      let digits = String(this.rng.int(6, 9));
      for (let i = 0; i < 9; i++) digits += String(this.rng.int(0, 9));
      const phone = `+91${digits}`;
      if (!this.used.has(phone)) {
        this.used.add(phone);
        return phone;
      }
    }
  }

  /** Marks numbers already in the database as taken. */
  reserve(phones: Iterable<string>) {
    for (const phone of phones) this.used.add(phone);
  }
}
