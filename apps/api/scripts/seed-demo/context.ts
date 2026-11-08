import type { Size } from './guard';
import { monthsBefore } from './calendar';

/** What each size builds (plan v4, platform section 4.2). Orders follow from customers and months. */
export const PLANS = {
  small: { familyCount: 30, productCount: 120, customers: 200, months: 6, staff: 15 },
  medium: { familyCount: 40, productCount: 180, customers: 2000, months: 18, staff: 18 },
  large: { familyCount: 60, productCount: 300, customers: 50000, months: 36, staff: 40 },
} as const;

export type Plan = (typeof PLANS)[Size];

/** Ids of the firms and locations every module writes against. */
export const PLACES = {
  firmA: 'firm_main',
  firmB: 'demo-firm-b',
  shopA: 'loc_main',
  shopB: 'demo-loc-shop-b',
  godownA: 'demo-loc-godown-a',
  godownB: 'demo-loc-godown-b',
  godownSite: 'demo-site-godown',
} as const;

export type SeedContext = {
  size: Size;
  seed: number;
  batchId: string;
  plan: Plan;
  today: string;
  firstDay: string;
  /** Category slugs that already exist (the base seed may have made them). */
  existingCategories: Set<string>;
  /** Users who act in the history: owners and the staff who confirm, deliver and count. */
  actors: { owner: string; ownerB: string; cashierA: string; cashierB: string };
};

export function makeContext(input: {
  size: Size;
  seed: number;
  today: string;
  existingCategories: Set<string>;
}): SeedContext {
  const plan = PLANS[input.size];
  return {
    ...input,
    plan,
    batchId: `demo-batch-${input.size}-${input.seed}-${input.today}`,
    firstDay: monthsBefore(input.today, plan.months),
    actors: {
      owner: 'demo-u-owner-a',
      ownerB: 'demo-u-owner-b',
      cashierA: 'demo-u-staff-01',
      cashierB: 'demo-u-staff-02',
    },
  };
}
