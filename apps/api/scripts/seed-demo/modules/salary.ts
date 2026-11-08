import { createHash } from 'node:crypto';
import { workOutPay } from '@shiv/shared';
import { ledgerHash, payStream } from '../../../src/staff/pay';
import type { Bulk } from '../bulk';
import { addDays, istInstant } from '../calendar';
import { PLACES, type SeedContext } from '../context';
import type { Rng } from '../rng';
import type { MonthFacts } from './attendance';
import type { SeedStaff } from './people';

/** A salary paid out of a shop's drawer: the galla sheet counts it on that day. */
export type DrawerPayout = {
  day: string;
  at: Date;
  shop: string;
  amountPaise: number;
  actorId: string;
};

function monthsBetween(firstDay: string, today: string) {
  const months: string[] = [];
  // Payroll starts with the first full month of history and stops before the current month.
  let [y, m] = firstDay.slice(0, 7).split('-').map(Number) as [number, number];
  if (firstDay.slice(8) !== '01') m++;
  for (;;) {
    if (m > 12) {
      y++;
      m = 1;
    }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month >= today.slice(0, 7)) break;
    months.push(month);
    m++;
  }
  return months;
}

/**
 * One locked pay run per month, a slip per person, and their wages ledger: EARNED when the month
 * locks, then PAID in the first week of the next month, from a shop's drawer or by the owner over
 * UPI. The ledger is the same hash chain the API writes.
 */
export async function seedSalary(
  ctx: SeedContext,
  bulk: Bulk,
  rng: Rng,
  staff: readonly SeedStaff[],
  facts: Map<string, MonthFacts>,
  now: Date,
): Promise<DrawerPayout[]> {
  const payouts: DrawerPayout[] = [];
  const people = staff.filter((s) => s.role !== 'OWNER');
  const chain = new Map(people.map((p) => [p.id, { seq: 0, prevHash: '', wages: 0 }]));
  const append = async (
    person: SeedStaff,
    entry: Record<string, unknown> & { deltaPaise: number },
  ) => {
    const c = chain.get(person.id)!;
    c.seq++;
    c.wages += entry.deltaPaise;
    const { deltaPaise: _delta, ...rest } = entry;
    const row = {
      userId: person.id,
      account: 'WAGES',
      ...rest,
      balanceAfterPaise: c.wages,
      channel: (rest.channel as string | undefined) ?? '',
      paidFrom: (rest.paidFrom as string | undefined) ?? '',
      locationId: (rest.locationId as string | null | undefined) ?? null,
      utr: '',
      recoveryPaise: null,
      reversesId: null,
      approvedById: null,
      note: '',
    };
    const hash = ledgerHash(c.prevHash, c.seq, row);
    await bulk.add('StaffLedgerEntry', {
      id: `demo-sl-${person.id}-${c.seq}`,
      ...row,
      stream: payStream(person.id),
      seq: c.seq,
      prevHash: c.prevHash,
      hash,
    });
    c.prevHash = hash;
  };

  for (const month of monthsBetween(ctx.firstDay, ctx.today)) {
    const next = addDays(`${month}-28`, 4).slice(0, 7);
    const lockedAt = istInstant(`${next}-01`, 10, 0);
    if (lockedAt > now) break;
    const runId = `demo-payrun-${month}`;
    await bulk.add('PayRun', {
      id: runId,
      month,
      status: 'LOCKED',
      lockedById: ctx.actors.owner,
      lockedAt,
      createdAt: lockedAt,
    });
    for (const person of people) {
      const line = workOutPay({
        monthlyPaise: person.monthlyPaise,
        additionsPaise: 0,
        deductionsPaise: 0,
        plannedRecoveryPaise: 0,
        advanceBalancePaise: 0,
      });
      const slip = {
        month,
        name: person.name,
        monthlyPaise: person.monthlyPaise,
        ...line,
        adjustments: [],
        facts: facts.get(`${person.id}|${month}`) ?? {
          daysPresent: 0,
          daysLate: 0,
          weeklyOffsWorked: 0,
          missingOut: 0,
        },
        advanceLeftPaise: 0,
        lockedAt: lockedAt.toISOString(),
      };
      await bulk.add('PayLine', {
        id: `demo-payline-${month}-${person.id}`,
        payRunId: runId,
        userId: person.id,
        slip,
        slipHash: createHash('sha256').update(JSON.stringify(slip)).digest('hex'),
        netPaise: line.netPaise,
      });
      await append(person, {
        kind: 'EARNED',
        amountPaise: line.netPaise,
        deltaPaise: line.netPaise,
        month,
        idempotencyKey: `earned:${month}:${person.id}`,
        actorId: ctx.actors.owner,
        serverAt: lockedAt,
      });
      const payDay = `${next}-0${rng.int(1, 7)}`;
      const paidAt = istInstant(payDay, rng.int(11, 17), rng.int(0, 59));
      if (paidAt > now) continue;
      const fromDrawer = rng.chance(0.6);
      // The drawer is paid out by that shop's cashier; an owner pays over UPI.
      const payer = fromDrawer
        ? person.payShop === PLACES.shopA
          ? ctx.actors.cashierA
          : ctx.actors.cashierB
        : ctx.actors.ownerB;
      await append(person, {
        kind: 'PAID',
        amountPaise: line.netPaise,
        deltaPaise: -line.netPaise,
        month,
        channel: fromDrawer ? 'CASH' : 'UPI',
        paidFrom: fromDrawer ? 'GALLA' : 'OWNER',
        locationId: fromDrawer ? person.payShop : null,
        idempotencyKey: `demo-paid-${month}-${person.id}`,
        actorId: payer,
        serverAt: paidAt,
      });
      if (fromDrawer)
        payouts.push({
          day: payDay,
          at: paidAt,
          shop: person.payShop,
          amountPaise: line.netPaise,
          actorId: payer,
        });
    }
  }
  return payouts;
}
