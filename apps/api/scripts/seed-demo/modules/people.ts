import type { PrismaClient } from '@prisma/client';
import type { Rng } from '../rng';
import { wire, type Bulk } from '../bulk';
import { addDays, dayRange, istInstant } from '../calendar';
import { PLACES, type SeedContext } from '../context';
import { firmName, patnaAreas, personName, type PhoneBook } from '../names';
import { SHOPS } from './places';

export type CustomerKind = 'house' | 'contractor' | 'regular';

export type SeedCustomer = {
  id: string;
  name: string;
  phone: string;
  kind: CustomerKind;
  shop: string;
  area: string;
  pincode: string;
  addresses: {
    label: string;
    name: string;
    phone: string;
    line1: string;
    area: string;
    pincode: string;
  }[];
  /** Buys on udhaar. */
  credit: boolean;
  creditLimitPaise: number | null;
  /** How reliably they pay: 1 pays on time, 0.2 pays very late. */
  payer: number;
  /** For a first-house owner: the day their building starts. */
  startDay: string;
  weight: number;
};

export type SeedStaff = {
  id: string;
  name: string;
  phone: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'ACCOUNTANT' | 'STOCK_KEEPER' | 'DRIVER' | 'HELPER';
  locationId: string | null;
  /** Shop whose drawer pays them when salary comes from the galla. */
  payShop: string;
  monthlyPaise: number;
  startMinute: number;
  endMinute: number;
  weeklyOff: number;
  /** Habitually late, for realistic Hazri. */
  lateness: number;
};

export const userColumns = {
  id: 'text',
  phone: 'text',
  name: 'text',
  role: '"Role"',
  language: 'text',
  area: 'text',
  tags: 'text[]',
  creditAllowed: 'bool',
  creditLimitPaise: 'int',
  khataBalancePaise: 'int',
  lastOrderAt: 'ts',
  contractorStatus: 'text',
  createdAt: 'ts',
  updatedAt: 'ts',
} as const;

export const addressColumns = {
  id: 'text',
  userId: 'text',
  label: 'text',
  name: 'text',
  phone: 'text',
  line1: 'text',
  area: 'text',
  city: 'text',
  state: 'text',
  pincode: 'text',
  landmark: 'text',
  lastUsedAt: 'ts',
  createdAt: 'ts',
} as const;

const westAreas = new Set(['Danapur', 'Phulwari Sharif', 'Khagaul', 'Saguna More']);

/** Customers stay in memory (they are few); their rows are written after the history sets balances. */
export function planCustomers(ctx: SeedContext, rng: Rng, phones: PhoneBook): SeedCustomer[] {
  const days = dayRange(ctx.firstDay, ctx.today);
  const customers: SeedCustomer[] = [];
  for (let i = 0; i < ctx.plan.customers; i++) {
    const kind = rng.weighted<CustomerKind>([
      ['house', 0.6],
      ['contractor', 0.15],
      ['regular', 0.25],
    ]);
    const [area, pincode] = rng.pick(patnaAreas);
    const name = kind === 'contractor' && rng.chance(0.5) ? firmName(rng) : personName(rng);
    const phone = phones.next();
    const sites = kind === 'contractor' ? rng.int(2, 4) : 1;
    const addresses = Array.from({ length: sites }, (_, s) => {
      const [siteArea, sitePin] = s === 0 ? [area, pincode] : rng.pick(patnaAreas);
      return {
        label: s === 0 ? (kind === 'contractor' ? 'Office' : 'Ghar') : `Site ${s}`,
        name,
        phone,
        line1: `Plot ${rng.int(1, 400)}, Gali ${rng.int(1, 30)}`,
        area: siteArea,
        pincode: sitePin,
      };
    });
    // About 30% buy on credit: most contractors, some regulars, a few house owners.
    const credit =
      kind === 'contractor'
        ? rng.chance(0.85)
        : kind === 'regular'
          ? rng.chance(0.3)
          : rng.chance(0.15);
    customers.push({
      id: `demo-c${String(i + 1).padStart(6, '0')}`,
      name,
      phone,
      kind,
      shop: westAreas.has(area) ? PLACES.shopB : rng.chance(0.85) ? PLACES.shopA : PLACES.shopB,
      area,
      pincode,
      addresses,
      credit,
      creditLimitPaise: credit
        ? (kind === 'contractor' ? rng.int(2, 10) : rng.int(1, 3)) * 10000000
        : null,
      payer: rng.weighted([
        [1, 0.55],
        [0.6, 0.3],
        [0.25, 0.15],
      ]),
      startDay: days[rng.int(0, Math.max(0, days.length - 30))]!,
      weight: kind === 'contractor' ? 0.4 + rng.next() * 2.6 : 0.5 + rng.next(),
    });
  }
  return customers;
}

/**
 * Customer rows go in before the history, because orders point at them. The balance and last
 * order are filled in afterwards by `updateCustomerTotals`.
 */
export async function writeCustomers(
  ctx: SeedContext,
  bulk: Bulk,
  customers: readonly SeedCustomer[],
) {
  for (const c of customers) {
    const created = istInstant(c.kind === 'house' ? addDays(c.startDay, -3) : ctx.firstDay, 10, 0);
    await bulk.add('User', {
      id: c.id,
      phone: c.phone,
      name: c.name,
      role: c.kind === 'contractor' ? 'CONTRACTOR' : 'CUSTOMER',
      language: 'en',
      area: c.area,
      tags: [],
      creditAllowed: c.credit,
      creditLimitPaise: c.creditLimitPaise,
      khataBalancePaise: 0,
      lastOrderAt: null,
      contractorStatus: c.kind === 'contractor' ? 'VERIFIED' : 'NONE',
      createdAt: created,
      updatedAt: created,
    });
    for (const [a, address] of c.addresses.entries())
      await bulk.add('Address', {
        id: `${c.id}-a${a + 1}`,
        userId: c.id,
        ...address,
        city: 'Patna',
        state: 'Bihar',
        landmark: '',
        lastUsedAt: null,
        createdAt: created,
      });
  }
}

/** Sets each customer's khata balance and last order, in one statement per 5,000 people. */
export async function updateCustomerTotals(
  db: PrismaClient,
  totals: Map<string, { balance: number; lastOrderAt: Date | null }>,
) {
  const entries = [...totals.entries()].filter(([, t]) => t.balance !== 0 || t.lastOrderAt);
  for (let i = 0; i < entries.length; i += 5000) {
    const slice = entries.slice(i, i + 5000);
    await db.$executeRawUnsafe(
      `UPDATE "User" AS u SET "khataBalancePaise" = v.b, "lastOrderAt" = v.l::timestamp(3), "updatedAt" = COALESCE(v.l::timestamp(3), u."updatedAt")
       FROM unnest($1::text[], $2::int[], $3::text[]) AS v(id, b, l) WHERE u.id = v.id`,
      slice.map(([id]) => id),
      slice.map(([, t]) => t.balance),
      slice.map(([, t]) => (t.lastOrderAt ? wire('ts', t.lastOrderAt) : null)),
    );
    await db.$executeRawUnsafe(
      `UPDATE "Address" SET "lastUsedAt" = v.l::timestamp(3) FROM unnest($1::text[], $2::text[]) AS v(id, l)
       WHERE "Address".id = v.id || '-a1' AND v.l IS NOT NULL`,
      slice.map(([id]) => id),
      slice.map(([, t]) => (t.lastOrderAt ? wire('ts', t.lastOrderAt) : null)),
    );
  }
}

/** Staff by role. Sizes: 15, 18 or 40 people including the two owners. */
export function planStaff(ctx: SeedContext, rng: Rng, phones: PhoneBook): SeedStaff[] {
  const roles: [SeedStaff['role'], string | null][] = [
    ['OWNER', null],
    ['OWNER', null],
    ['CASHIER', PLACES.shopA],
    ['CASHIER', PLACES.shopB],
    ['ACCOUNTANT', null],
    ['MANAGER', PLACES.shopA],
    ['MANAGER', PLACES.shopB],
    ['STOCK_KEEPER', PLACES.godownA],
    ['STOCK_KEEPER', PLACES.shopA],
    ['DRIVER', PLACES.shopA],
    ['DRIVER', PLACES.shopB],
    ['HELPER', PLACES.shopA],
    ['HELPER', PLACES.shopB],
    ['HELPER', PLACES.godownA],
    ['DRIVER', PLACES.shopA],
  ];
  const extra: [SeedStaff['role'], string][] = [
    ['STOCK_KEEPER', PLACES.godownB],
    ['HELPER', PLACES.shopA],
    ['DRIVER', PLACES.shopB],
  ];
  while (roles.length < ctx.plan.staff) {
    const next = extra[(roles.length - 15) % extra.length]!;
    roles.push(
      roles.length >= 18 ? [rng.pick(['HELPER', 'DRIVER'] as const), rng.pick(SHOPS)] : next,
    );
  }
  const pay: Record<SeedStaff['role'], [number, number]> = {
    OWNER: [0, 0],
    MANAGER: [18000, 24000],
    CASHIER: [12000, 16000],
    ACCOUNTANT: [15000, 20000],
    STOCK_KEEPER: [11000, 14000],
    DRIVER: [12000, 15000],
    HELPER: [9000, 11000],
  };
  return roles.map(([role, locationId], i) => {
    const [lo, hi] = pay[role];
    const id =
      i === 0
        ? ctx.actors.owner
        : i === 1
          ? ctx.actors.ownerB
          : `demo-u-staff-${String(i - 1).padStart(2, '0')}`;
    return {
      id,
      name: personName(rng),
      phone: phones.next(),
      role,
      locationId,
      payShop:
        locationId === PLACES.shopB || locationId === PLACES.godownB ? PLACES.shopB : PLACES.shopA,
      monthlyPaise: role === 'OWNER' ? 0 : rng.int(lo / 500, hi / 500) * 50000,
      startMinute: role === 'DRIVER' || role === 'HELPER' ? 8 * 60 + 30 : 9 * 60,
      endMinute: 19 * 60 + 30,
      weeklyOff: rng.chance(0.7) ? 0 : rng.int(1, 6),
      lateness: rng.weighted([
        [0.03, 0.6],
        [0.12, 0.3],
        [0.3, 0.1],
      ]),
    };
  });
}

export async function writeStaff(ctx: SeedContext, bulk: Bulk, staff: readonly SeedStaff[]) {
  const started = istInstant(ctx.firstDay, 8, 0);
  for (const s of staff) {
    await bulk.add('User', {
      id: s.id,
      phone: s.phone,
      name: s.name,
      role: 'ADMIN',
      language: 'hinglish',
      area: '',
      tags: [],
      creditAllowed: false,
      creditLimitPaise: null,
      khataBalancePaise: 0,
      lastOrderAt: null,
      contractorStatus: 'NONE',
      createdAt: started,
      updatedAt: started,
    });
    await bulk.add('StaffMembership', {
      id: `${s.id}-m`,
      userId: s.id,
      locationId: s.locationId,
      role: s.role,
      startedAt: started,
      grantedById: s.role === 'OWNER' ? 'demo-seed' : ctx.actors.owner,
    });
    if (s.role === 'OWNER') continue;
    await bulk.add('StaffProfile', { userId: s.id, noPhone: false, updatedAt: started });
    await bulk.add('StaffSchedule', {
      id: `${s.id}-sch`,
      userId: s.id,
      effectiveFrom: ctx.firstDay,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
      breakMinutes: 60,
      weeklyOffs: [s.weeklyOff],
      createdById: ctx.actors.owner,
      createdAt: started,
    });
    await bulk.add('StaffPayTerms', {
      id: `${s.id}-pay`,
      userId: s.id,
      effectiveFrom: ctx.firstDay,
      amountPaise: s.monthlyPaise,
      createdById: ctx.actors.owner,
      createdAt: started,
    });
  }
}

export const staffTables = {
  StaffMembership: {
    id: 'text',
    userId: 'text',
    locationId: 'text',
    role: '"StaffRole"',
    startedAt: 'ts',
    grantedById: 'text',
  },
  StaffProfile: { userId: 'text', noPhone: 'bool', updatedAt: 'ts' },
  StaffSchedule: {
    id: 'text',
    userId: 'text',
    effectiveFrom: 'text',
    startMinute: 'int',
    endMinute: 'int',
    breakMinutes: 'int',
    weeklyOffs: 'int[]',
    createdById: 'text',
    createdAt: 'ts',
  },
  StaffPayTerms: {
    id: 'text',
    userId: 'text',
    effectiveFrom: 'text',
    amountPaise: 'int',
    createdById: 'text',
    createdAt: 'ts',
  },
} as const;

export { addDays };
