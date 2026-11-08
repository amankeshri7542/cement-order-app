/**
 * Where the demo seed may write. Pure, so tests can check every refusal without a database.
 * Messages name the database and host only, never the user or password.
 */
export const SIZES = ['small', 'medium', 'large'] as const;
export type Size = (typeof SIZES)[number];

export type SeedOptions = {
  size: Size;
  seed: number;
  /** The last day of history, as an India date (YYYY-MM-DD). */
  today: string;
  /** Drop and recreate the database first. */
  fresh: boolean;
  manifestPath: string | null;
};

export function seedTarget(env: Record<string, string | undefined>) {
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Set DATABASE_URL to a demo, development or test database (postgresql://…).');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('DATABASE_URL must be a postgresql:// address.');
  const database = decodeURIComponent(url.pathname.slice(1));
  const label = `database "${database}" on ${url.hostname || 'unknown host'}`;
  if (env.NODE_ENV === 'production')
    throw new Error(`Refusing ${label}: the demo seed never runs with NODE_ENV=production.`);
  if (!/^[A-Za-z0-9_]{1,63}$/.test(database))
    throw new Error(`Refusing ${label}: unexpected database name.`);
  if (!/_(dev|demo|test)$/.test(database))
    throw new Error(
      `Refusing ${label}: the demo seed only writes to a database whose name ends in _dev, _demo or _test.`,
    );
  return { database, host: url.hostname, label, url };
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function parseSeedArgs(argv: readonly string[], todayIst: string): SeedOptions {
  const options: SeedOptions = {
    size: 'small',
    seed: 42,
    today: todayIst,
    fresh: false,
    manifestPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value.`);
      return next;
    };
    if (arg === '--size') {
      const size = value();
      if (!(SIZES as readonly string[]).includes(size))
        throw new Error(`--size must be ${SIZES.join(', ')}.`);
      options.size = size as Size;
    } else if (arg === '--seed') {
      const raw = value();
      if (!/^\d{1,9}$/.test(raw)) throw new Error('--seed must be a whole number up to 9 digits.');
      options.seed = Number(raw);
    } else if (arg === '--today') {
      const raw = value();
      if (!isoDay.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`)))
        throw new Error('--today must be a date like 2026-11-08.');
      options.today = raw;
    } else if (arg === '--fresh') options.fresh = true;
    else if (arg === '--manifest') options.manifestPath = value();
    else
      throw new Error(`Unknown option ${arg}. Use --size, --seed, --today, --fresh or --manifest.`);
  }
  return options;
}

/**
 * The refusal for a database that already holds data the seed did not make. `foreignOrders` counts
 * orders without the demo id prefix; `batches` counts earlier seed runs.
 */
export function existingDataRefusal(counts: {
  foreignOrders: number;
  batches: number;
  label: string;
}): string | null {
  if (counts.foreignOrders > 0)
    return `Refusing ${counts.label}: it holds ${counts.foreignOrders} order(s) the demo seed did not create. Use a separate _demo database, or --fresh to drop and recreate this one.`;
  if (counts.batches > 0)
    return `Refusing ${counts.label}: demo data is already loaded. Rows in append-only tables cannot be deleted, so run again with --fresh to drop and recreate the database.`;
  return null;
}
