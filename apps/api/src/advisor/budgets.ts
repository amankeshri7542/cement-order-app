import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { istToday, type AdvisorLimit } from '@shiv/shared';
import { budgetKey, budgetUsed, chargeBudget, refundBudget } from '../abuse';
import { getConfig } from '../config';
import { Db } from '../db';
import { fail } from '../http';
import type { ModelUsage } from './provider';

const hour = 3_600_000;
const day = 24 * hour;
const costDayScope = 'advisor:cost-day';
const costMonthScope = 'advisor:cost-month';

/** Too many at once to get a turn at the database. Saying no is always safe here. */
export const databaseBusy = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  ['P2034', 'P2028', 'P2024'].includes(error.code);

class OverLimit extends Error {}

/**
 * Adds to a budget row in one statement, or changes nothing if that would pass the limit. The row's
 * own lock is what makes the sum correct, so a burst of questions cannot read the same total and all
 * pass, and they queue instead of failing and retrying. This is why the cap holds at 50 at once.
 */
async function charge(
  tx: Prisma.TransactionClient,
  scope: string,
  subject: string,
  limit: number,
  duration: number,
  cost = 1,
  warn = false,
) {
  if (cost > limit) throw new OverLimit();
  const key = budgetKey(scope, subject);
  const expires = new Date(Date.now() + duration).toISOString();
  const rows = await tx.$queryRaw<{ count: number }[]>`
    INSERT INTO "AuthRateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, ${cost}::int, ${expires}::timestamp)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthRateLimit"."expiresAt" <= (now() AT TIME ZONE 'UTC')
        THEN EXCLUDED."count" ELSE "AuthRateLimit"."count" + EXCLUDED."count" END,
      "expiresAt" = CASE WHEN "AuthRateLimit"."expiresAt" <= (now() AT TIME ZONE 'UTC')
        THEN EXCLUDED."expiresAt" ELSE "AuthRateLimit"."expiresAt" END
    WHERE "AuthRateLimit"."expiresAt" <= (now() AT TIME ZONE 'UTC')
      OR "AuthRateLimit"."count" + EXCLUDED."count" <= ${limit}::int
    RETURNING "count"`;
  const count = rows[0]?.count;
  if (count === undefined) throw new OverLimit();
  // Tells the operator once, as a shop-wide budget passes 80%. One phone's own limit stays quiet,
  // or swapping phones could write to the audit log for free.
  const warning = Math.max(1, Math.ceil(limit * 0.8));
  if (warn && count >= warning && count - cost < warning) {
    console.warn(
      JSON.stringify({ event: 'SECURITY_BUDGET_WARNING', scope, count, limit, duration }),
    );
    await tx.auditLog.create({
      data: {
        actorId: 'system',
        event: 'SECURITY_BUDGET_WARNING',
        entityId: scope,
        details: { count, limit, duration },
      },
    });
  }
}

/** What a model call cost, from what it reported. Whole micro dollars, rounded up. */
export function costOf(usage: ModelUsage): number {
  const c = getConfig();
  return Math.ceil(
    (usage.inputTokens * c.ADVISOR_INPUT_MICRO_USD_PER_MILLION +
      usage.cacheWriteTokens * c.ADVISOR_CACHE_WRITE_MICRO_USD_PER_MILLION +
      usage.cacheReadTokens * c.ADVISOR_CACHE_READ_MICRO_USD_PER_MILLION +
      usage.outputTokens * c.ADVISOR_OUTPUT_MICRO_USD_PER_MILLION) /
      1_000_000,
  );
}

/** The most a call can cost. Bytes are always at least the token count, and output is capped. */
export function worstCaseCost(inputBytes: number, outputTokens: number): number {
  const c = getConfig();
  return Math.ceil(
    (inputBytes * c.ADVISOR_INPUT_MICRO_USD_PER_MILLION +
      outputTokens * c.ADVISOR_OUTPUT_MICRO_USD_PER_MILLION) /
      1_000_000,
  );
}

export type Reservation = { microUsd: number; day: string; month: string };

/**
 * All of Ask's limits, on the same persistent budget rows as the rest of the API, so they survive a
 * restart and hold across processes.
 */
@Injectable()
export class AdvisorBudgets {
  constructor(@Inject(Db) private db: Db) {}

  private together(run: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    return this.db.$transaction(run, { maxWait: 5000, timeout: 10000 });
  }

  /** The hard floor under everything, charged on every turn, fixed text included. */
  async flood(tokenHash: string, ip: string) {
    const c = getConfig();
    try {
      await this.together(async (tx) => {
        await charge(tx, 'advisor:turns:ip', ip, c.ADVISOR_TURNS_PER_IP_HOUR, hour);
        await charge(tx, 'advisor:turns:store', 'store', c.ADVISOR_TURNS_PER_DAY, day, 1, true);
        await charge(tx, 'advisor:turns:device', tokenHash, c.ADVISOR_TURNS_PER_DEVICE_DAY, day);
      });
    } catch (error) {
      if (error instanceof OverLimit)
        fail(
          'ADVISOR_LIMIT',
          'You have asked a lot today. The guide is still here, or ask the shop.',
          429,
        );
      if (databaseBusy(error))
        fail('RESOURCE_BUSY', 'Service is busy. Please try again shortly.', 429);
      throw error;
    }
  }

  /** New device tokens from one network address. Swapping tokens gets nobody more questions. */
  async mint(ip: string) {
    const c = getConfig();
    try {
      await this.together((tx) =>
        charge(tx, 'advisor:mint:ip', ip, c.ADVISOR_DEVICES_PER_IP_DAY, day),
      );
    } catch (error) {
      if (error instanceof OverLimit)
        fail(
          'ADVISOR_LIMIT',
          'Too many new devices from this network today. Please try again tomorrow.',
          429,
        );
      if (databaseBusy(error))
        fail('RESOURCE_BUSY', 'Service is busy. Please try again shortly.', 429);
      throw error;
    }
  }

  /**
   * One question that will reach a model. Fixed text costs nothing and does not count. Returns which
   * limit was reached, or null. The whole thing is one transaction: at a limit, nothing is charged.
   */
  async question(
    tokenHash: string,
    userId: string | null,
    ip: string,
  ): Promise<AdvisorLimit | null> {
    const c = getConfig();
    let reached: AdvisorLimit = 'DEVICE';
    try {
      await this.together(async (tx) => {
        reached = userId ? 'ACCOUNT' : 'DEVICE';
        if (userId)
          await charge(
            tx,
            'advisor:questions:account',
            userId,
            c.ADVISOR_QUESTIONS_PER_ACCOUNT_DAY,
            day,
          );
        else
          await charge(
            tx,
            'advisor:questions:device',
            tokenHash,
            c.ADVISOR_QUESTIONS_PER_DEVICE_DAY,
            day,
          );
        reached = 'NETWORK';
        await charge(tx, 'advisor:questions:ip', ip, c.ADVISOR_QUESTIONS_PER_IP_DAY, day);
      });
      return null;
    } catch (error) {
      if (error instanceof OverLimit) return reached;
      if (databaseBusy(error)) return 'SHOP';
      throw error;
    }
  }

  /**
   * Holds the worst case for a call against the day's and the month's money before it is made. Null
   * means the shop's cap is reached, or too many are competing to tell: either way, no model is
   * called. A call that goes ahead has already paid for the most it could cost.
   */
  async reserve(microUsd: number): Promise<Reservation | null> {
    const c = getConfig();
    const today = istToday();
    const month = today.slice(0, 7);
    try {
      await this.together(async (tx) => {
        await charge(
          tx,
          costDayScope,
          today,
          c.ADVISOR_DAILY_BUDGET_MICRO_USD,
          2 * day,
          microUsd,
          true,
        );
        await charge(
          tx,
          costMonthScope,
          month,
          c.ADVISOR_MONTHLY_BUDGET_MICRO_USD,
          40 * day,
          microUsd,
          true,
        );
      });
      return { microUsd, day: today, month };
    } catch (error) {
      if (error instanceof OverLimit || databaseBusy(error)) return null;
      throw error;
    }
  }

  /** Puts right what a call really cost. Not knowing what it cost, the reservation stays spent. */
  async settle(reservation: Reservation, spent: number | null) {
    if (spent === null) return;
    const back = reservation.microUsd - spent;
    if (back > 0) {
      await refundBudget(this.db, costDayScope, reservation.day, back);
      await refundBudget(this.db, costMonthScope, reservation.month, back);
    } else if (back < 0) {
      await chargeBudget(this.db, costDayScope, reservation.day, -back);
      await chargeBudget(this.db, costMonthScope, reservation.month, -back);
    }
  }

  /** Nothing was sent, so nothing was spent. */
  release(reservation: Reservation) {
    return this.settle(reservation, 0);
  }

  async spent() {
    const today = istToday();
    return {
      todayMicroUsd: await budgetUsed(this.db, costDayScope, today),
      monthMicroUsd: await budgetUsed(this.db, costMonthScope, today.slice(0, 7)),
    };
  }
}
