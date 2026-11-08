import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import {
  assertDemoSinks,
  demoDataLoaded,
  forgetDemoLock,
  realSenders,
  sendBlocked,
} from '../src/demo-lock';
import { Bulk, wire } from '../scripts/seed-demo/bulk';
import {
  addDays,
  busyness,
  dayRange,
  istInstant,
  monthsBefore,
} from '../scripts/seed-demo/calendar';
import { PLANS } from '../scripts/seed-demo/context';
import { existingDataRefusal, parseSeedArgs, seedTarget } from '../scripts/seed-demo/guard';
import { PhoneBook } from '../scripts/seed-demo/names';
import { Rng } from '../scripts/seed-demo/rng';
import { categories, planCatalogue } from '../scripts/seed-demo/modules/catalogue';

const url = (name: string, host = '127.0.0.1') => `postgresql://u:secret-pass@${host}:5432/${name}`;

describe('seed target guard', () => {
  it('accepts only databases ending in _dev, _demo or _test', () => {
    for (const name of ['shiv_cement_dev', 'shiv_cement_demo', 'shiv_cement_test'])
      expect(seedTarget({ DATABASE_URL: url(name) }).database).toBe(name);
    for (const name of [
      'shiv_cement',
      'shiv_cement_prod',
      'shiv_dev_copy',
      'demo',
      'shiv_cement_test2',
    ])
      expect(() => seedTarget({ DATABASE_URL: url(name) })).toThrow(/_dev, _demo or _test/);
  });
  it('refuses NODE_ENV=production even on a demo name', () => {
    expect(() =>
      seedTarget({ DATABASE_URL: url('shiv_cement_demo'), NODE_ENV: 'production' }),
    ).toThrow(/production/);
  });
  it('refuses odd names that could break out of quoting, and non-postgres URLs', () => {
    expect(() => seedTarget({ DATABASE_URL: url('x";DROP DATABASE y;--_test') })).toThrow(
      /unexpected/,
    );
    expect(() => seedTarget({ DATABASE_URL: url('shiv-cement_test') })).toThrow(/unexpected/);
    expect(() => seedTarget({ DATABASE_URL: 'mysql://u:p@h/x_test' })).toThrow(/postgresql/);
    expect(() => seedTarget({})).toThrow(/Set DATABASE_URL/);
  });
  it('never puts the password in a refusal', () => {
    try {
      seedTarget({ DATABASE_URL: url('shiv_cement') });
    } catch (error) {
      expect(String(error)).not.toContain('secret-pass');
      expect(String(error)).toContain('shiv_cement');
    }
  });
});

describe('seed arguments', () => {
  it('has safe defaults', () => {
    expect(parseSeedArgs([], '2026-11-08')).toEqual({
      size: 'small',
      seed: 42,
      today: '2026-11-08',
      fresh: false,
      manifestPath: null,
    });
  });
  it('reads every option', () => {
    expect(
      parseSeedArgs(
        [
          '--size',
          'large',
          '--seed',
          '7',
          '--today',
          '2026-01-31',
          '--fresh',
          '--manifest',
          'x.json',
        ],
        '2026-11-08',
      ),
    ).toEqual({ size: 'large', seed: 7, today: '2026-01-31', fresh: true, manifestPath: 'x.json' });
  });
  it('refuses bad values and unknown options', () => {
    expect(() => parseSeedArgs(['--size', 'huge'], 'd')).toThrow(/--size/);
    expect(() => parseSeedArgs(['--seed', '-1'], 'd')).toThrow(/--seed/);
    expect(() => parseSeedArgs(['--seed', '1e3'], 'd')).toThrow(/--seed/);
    expect(() => parseSeedArgs(['--today', '2026-13-40'], 'd')).toThrow(/--today/);
    expect(() => parseSeedArgs(['--size'], 'd')).toThrow(/needs a value/);
    expect(() => parseSeedArgs(['--size', '--fresh'], 'd')).toThrow(/needs a value/);
    expect(() => parseSeedArgs(['--wipe'], 'd')).toThrow(/Unknown option/);
  });
});

describe('existing data refusal', () => {
  it('refuses foreign orders first, then an earlier batch, else allows', () => {
    expect(existingDataRefusal({ foreignOrders: 3, batches: 1, label: 'x' })).toMatch(
      /3 order\(s\) the demo seed did not create/,
    );
    expect(existingDataRefusal({ foreignOrders: 0, batches: 1, label: 'x' })).toMatch(/--fresh/);
    expect(existingDataRefusal({ foreignOrders: 0, batches: 0, label: 'x' })).toBeNull();
  });
});

describe('random source', () => {
  it('is the same for the same seed and different for another', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
  });
  it('forks depend on the seed and label only, not on use', () => {
    const used = new Rng(42);
    for (let i = 0; i < 100; i++) used.next();
    expect(used.fork('x').next()).toBe(new Rng(42).fork('x').next());
    expect(new Rng(42).fork('x').next()).not.toBe(new Rng(42).fork('y').next());
  });
  it('keeps ints in range and refuses a bad seed', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(() => new Rng(-1)).toThrow();
    expect(() => new Rng(1.5)).toThrow();
    expect(() => r.pick([])).toThrow();
  });
});

describe('catalogue plan', () => {
  it('makes exactly the planned products and families at every size, with every category', () => {
    for (const plan of Object.values(PLANS)) {
      const chosen = planCatalogue(plan.familyCount, plan.productCount);
      expect(chosen).toHaveLength(plan.familyCount);
      expect(chosen.reduce((n, c) => n + c.count, 0)).toBe(plan.productCount);
      expect(chosen.every((c) => c.count >= 1 && c.count <= c.family.variants.length)).toBe(true);
      expect(new Set(chosen.map((c) => c.family.category))).toEqual(
        new Set(categories.map((c) => c.id)),
      );
    }
  });
  it('refuses more than it can hold', () => {
    expect(() => planCatalogue(61, 300)).toThrow(/families/);
    expect(() => planCatalogue(30, 1000)).toThrow(/hold only/);
  });
});

describe('phone numbers', () => {
  it('are unique valid Indian mobiles and skip reserved ones', () => {
    const book = new PhoneBook(new Rng(5));
    const first = new PhoneBook(new Rng(5)).next();
    book.reserve([first]);
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const p = book.next();
      expect(p).toMatch(/^\+91[6-9]\d{9}$/);
      expect(seen.has(p)).toBe(false);
      seen.add(p);
    }
    expect(seen.has(first)).toBe(false);
  });
});

describe('calendar', () => {
  it('counts India days and instants', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(dayRange('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ]);
    expect(istInstant('2026-11-08', 9, 30).toISOString()).toBe('2026-11-08T04:00:00.000Z');
    expect(monthsBefore('2026-11-08', 6)).toBe('2026-05-09');
  });
  it('makes the building season busier than the monsoon and Sunday short', () => {
    expect(busyness('2026-03-10')).toBeGreaterThan(busyness('2026-08-11'));
    expect(busyness('2026-11-01')).toBeLessThan(busyness('2026-11-02'));
  });
});

describe('batch writer', () => {
  it('encodes values for array parameters', () => {
    expect(wire('ts', new Date('2026-11-08T04:00:00.000Z'))).toBe('2026-11-08 04:00:00.000');
    expect(wire('json', { a: 1 })).toBe('{"a":1}');
    expect(wire('text[]', ['a', 'b "c"'])).toBe('{"a","b \\"c\\""}');
    expect(wire('int[]', [0, 6])).toBe('{0,6}');
    expect(wire('int', null)).toBeNull();
    expect(() => wire('ts', new Date('nope'))).toThrow();
    expect(() => wire('int[]', [1.5])).toThrow();
  });
  it('refuses unsafe table, column and type names', () => {
    const bulk = new Bulk({} as never);
    expect(() => bulk.table('Bad"; DROP', { id: 'text' })).toThrow(/table/);
    expect(() => bulk.table('Ok', { 'id"': 'text' })).toThrow(/column/);
    expect(() => bulk.table('Ok2', { id: '"Enum"; x' as never })).toThrow(/type/);
    bulk.table('Ok3', { id: 'text' });
    expect(() => bulk.table('Ok3', { id: 'text' })).toThrow(/twice/);
  });
  it('writes parents before children whenever any buffer fills', async () => {
    const calls: string[] = [];
    const db = { $executeRawUnsafe: async (sql: string) => calls.push(sql.split('"')[1]!) };
    const bulk = new Bulk(db as never, 2);
    bulk.table('Parent', { id: 'text' });
    bulk.table('Child', { id: 'text' });
    await bulk.add('Parent', { id: 'p1' });
    await bulk.add('Child', { id: 'c1' });
    await bulk.add('Child', { id: 'c2' });
    expect(calls).toEqual(['Parent', 'Child']);
    expect(bulk.written.get('Child')).toBe(2);
    await expect(bulk.add('Nope', {})).rejects.toThrow(/not registered/);
  });
});

describe('sink lock rules', () => {
  const base = {
    OTP_PROVIDER: 'mock',
    WHATSAPP_PROVIDER: 'fake',
    WA_REPLY_PROVIDER: 'off',
  } as unknown as Config;
  const db = (n: number) => ({ demoBatch: { count: async () => n } }) as never;

  it('names every real sender', () => {
    expect(realSenders(base)).toEqual([]);
    expect(realSenders({ ...base, WA_REPLY_PROVIDER: 'fake' })).toEqual([]);
    const all = realSenders({
      ...base,
      OTP_PROVIDER: 'twilio',
      WHATSAPP_PROVIDER: 'meta',
      WA_REPLY_PROVIDER: 'd360',
      FIREBASE_PROJECT_ID: 'p',
      WEB_PUSH_PUBLIC_KEY: 'k',
    } as Config);
    expect(all.join(' ')).toMatch(/twilio.*meta.*d360.*FIREBASE.*WEB_PUSH/);
  });
  it('refuses to start on demo data with a real sender, and allows sinks', async () => {
    await expect(
      assertDemoSinks(db(1), { ...base, WHATSAPP_PROVIDER: 'meta' } as Config),
    ).rejects.toThrow(/Refusing to start.*WhatsApp alerts/);
    await expect(assertDemoSinks(db(1), base)).resolves.toBeUndefined();
    await expect(
      assertDemoSinks(db(0), { ...base, OTP_PROVIDER: 'twilio' } as Config),
    ).resolves.toBeUndefined();
  });
  it('remembers the answer for 30 seconds, then asks again', async () => {
    forgetDemoLock();
    let n = 0;
    const counting = { demoBatch: { count: async () => n } } as never;
    expect(await demoDataLoaded(counting, 1000)).toBe(false);
    n = 1;
    expect(await demoDataLoaded(counting, 20_000)).toBe(false);
    expect(await demoDataLoaded(counting, 31_001)).toBe(true);
    forgetDemoLock();
    expect(await sendBlocked(counting)).toBe(true);
    forgetDemoLock();
  });
});
