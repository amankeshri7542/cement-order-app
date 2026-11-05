'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button, EmptyState, Field, StatusPill } from '@shiv/design';
import { momentLabel, money } from '@shiv/shared';
import { ApiError, api, download } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { PageHeader, Problem, QueryStatus } from '../common';
import own from '../hazri/hazri.module.css';
import css from '../owner.module.css';
import { FactsLine, Money, PersonSheet, SlipSheet } from './person';
import {
  adjustmentRows,
  currentMonth,
  monthChoices,
  monthName,
  paidAnswer,
  previousMonth,
  recoveryReason,
} from './pure';
import pay from './salary.module.css';
import {
  AdjustSheet,
  PaySheet,
  RecoverySheet,
  salaryKey,
  TakeBackSheet,
  TermsSheet,
} from './sheets';
import type { Adjustment, DraftLine, Ledger, LockedLine, PayLine, RunMonth } from './types';

const enc = encodeURIComponent;
type Person = { userId: string; name: string };

/** One person's month before it is locked. A figure beside its reason, and only an owner moves it. */
function DraftCard({ row, month }: { row: DraftLine; month: string }) {
  const t = useT();
  const { can } = useOwner();
  const mayAct = can('staff.salary.pay');
  const [open, setOpen] = useState<'adjust' | 'recovery' | 'person' | Adjustment | null>(null);
  const lines = adjustmentRows(row.adjustments);
  const why = recoveryReason(row.adjustments);
  return (
    <article className={css.card}>
      <div className={css.row}>
        <h3>
          <button type="button" className={css.linkButton} onClick={() => setOpen('person')}>
            {row.name}
          </button>
        </h3>
      </div>
      <div className={css.ledger}>
        <Money label={t('owner.salary.line.monthly')} value={row.monthlyPaise} />
        {lines.map((line) => (
          <div key={line.id} className={line.takenBack ? pay.takenBack : undefined}>
            <Money
              label={`${t(
                line.kind === 'DEDUCTION' ? 'owner.salary.line.take' : 'owner.salary.line.add',
              )}: ${line.reason}`}
              value={line.kind === 'DEDUCTION' ? -line.amountPaise : line.amountPaise}
            />
            {line.takenBack ? (
              <p className={css.hint}>
                {t('owner.salary.line.takenBack', { reason: line.takenBack.reason })}
              </p>
            ) : (
              mayAct && (
                <button type="button" className={own.linkish} onClick={() => setOpen(line)}>
                  {t('owner.salary.takeBack.button')}
                </button>
              )
            )}
          </div>
        ))}
        {(row.advanceBalancePaise > 0 || row.line.recoveryPaise > 0) && (
          <div>
            <Money label={t('owner.salary.line.recovery')} value={-row.line.recoveryPaise} />
            <p className={css.hint}>
              {t('owner.salary.line.advanceLeft', { amount: money(row.advanceBalancePaise) })}
              {why && ` · ${why}`}
            </p>
            {mayAct && (
              <button type="button" className={own.linkish} onClick={() => setOpen('recovery')}>
                {t('owner.salary.recovery.change')}
              </button>
            )}
          </div>
        )}
        {row.line.roundOffPaise !== 0 && (
          <Money label={t('owner.salary.line.roundOff')} value={row.line.roundOffPaise} />
        )}
        <Money label={t('owner.salary.line.net')} value={row.line.netPaise} strong />
      </div>
      <FactsLine facts={row.facts} />
      {mayAct && (
        <div className={css.actions}>
          <Button
            variant="secondary"
            aria-label={t('owner.salary.adjust.for', { name: row.name })}
            onClick={() => setOpen('adjust')}
          >
            {t('owner.salary.adjust.button')}
          </Button>
        </div>
      )}
      {open === 'adjust' && <AdjustSheet person={row} month={month} close={() => setOpen(null)} />}
      {open === 'recovery' && (
        <RecoverySheet
          person={row}
          month={month}
          balancePaise={row.advanceBalancePaise}
          plannedPaise={row.line.recoveryPaise}
          close={() => setOpen(null)}
        />
      )}
      {open === 'person' && <PersonSheet person={row} month={month} close={() => setOpen(null)} />}
      {open && typeof open === 'object' && (
        <TakeBackSheet
          title={t('owner.salary.takeBack.lineTitle')}
          body={t('owner.salary.takeBack.lineBody', { reason: open.reason })}
          run={(reason) =>
            api(`/admin/salary/adjustments/${enc(open.id)}/reverse`, 'POST', { reason })
          }
          close={() => setOpen(null)}
        />
      )}
    </article>
  );
}

/** After the lock: the frozen figure, what has been paid, and the slip. */
function LockedCard({ row, month }: { row: LockedLine; month: string }) {
  const t = useT();
  const { can } = useOwner();
  const mayAct = can('staff.salary.pay');
  const [open, setOpen] = useState<'slip' | 'pay' | 'person' | null>(null);
  const owed = row.netPaise - row.paidPaise;
  // Whether they said they got it. "Nahi mila" must be seen without opening anyone's record.
  const ledger = useQuery({
    enabled: row.paidPaise > 0,
    queryKey: [...salaryKey, 'person', row.userId],
    queryFn: () => api<Ledger>(`/admin/salary/people/${enc(row.userId)}`),
  });
  const answer = paidAnswer(ledger.data?.items ?? [], month);
  return (
    <article className={css.card}>
      <div className={css.row}>
        <h3>
          <button type="button" className={css.linkButton} onClick={() => setOpen('person')}>
            {row.name}
          </button>
        </h3>
        <StatusPill
          tone={owed <= 0 ? 'green' : 'neutral'}
          label={
            owed <= 0
              ? t('owner.salary.paidAll')
              : t('owner.salary.owedPill', { amount: money(owed) })
          }
        />
      </div>
      <div className={css.ledger}>
        <Money label={t('owner.salary.line.monthly')} value={row.slip.monthlyPaise} />
        {row.slip.adjustments.map((line, index) => (
          <Money
            key={index}
            label={`${t(
              line.kind === 'DEDUCTION' ? 'owner.salary.line.take' : 'owner.salary.line.add',
            )}: ${line.reason}`}
            value={line.kind === 'DEDUCTION' ? -line.amountPaise : line.amountPaise}
          />
        ))}
        {row.slip.recoveryPaise > 0 && (
          <Money label={t('owner.salary.line.recovery')} value={-row.slip.recoveryPaise} />
        )}
        {row.slip.roundOffPaise !== 0 && (
          <Money label={t('owner.salary.line.roundOff')} value={row.slip.roundOffPaise} />
        )}
        <Money label={t('owner.salary.line.net')} value={row.netPaise} strong />
        <Money label={t('owner.salary.line.paid')} value={row.paidPaise} />
      </div>
      {answer === 'NOT_GOT' && (
        <p className={own.lookBlock} role="status">
          {t('owner.salary.ack.notGot')}
        </p>
      )}
      {answer === 'GOT' && <p className={own.toneOk}>{t('owner.salary.ack.got')}</p>}
      {answer === 'NONE' && <p className={css.hint}>{t('owner.salary.ack.none')}</p>}
      <FactsLine facts={row.slip.facts} />
      <div className={css.actions}>
        <Button
          variant="secondary"
          aria-label={t('owner.salary.slip.for', { name: row.name })}
          onClick={() => setOpen('slip')}
        >
          {t('owner.salary.slip.open')}
        </Button>
        {mayAct && owed > 0 && (
          <Button
            aria-label={t('owner.salary.pay.for', { name: row.name })}
            onClick={() => setOpen('pay')}
          >
            {t('owner.salary.pay.save')}
          </Button>
        )}
      </div>
      {open === 'slip' && (
        <SlipSheet slip={row.slip} paidPaise={row.paidPaise} close={() => setOpen(null)} />
      )}
      {open === 'pay' && (
        <PaySheet person={row} month={month} owedPaise={owed} close={() => setOpen(null)} />
      )}
      {open === 'person' && <PersonSheet person={row} month={month} close={() => setOpen(null)} />}
    </article>
  );
}

function LockBar({ data }: { data: RunMonth }) {
  const t = useT();
  const words = useWords();
  const { confirm, notice } = useOwner();
  const lock = useAction(async () => {
    try {
      const done = await api<{ people: number }>(
        `/admin/salary/runs/${enc(data.month)}/lock`,
        'POST',
        { confirm: true },
      );
      notice(t('owner.salary.lock.done', { count: done.people }));
    } catch (error) {
      // The other owner got there first, or a lost answer hid that this tap worked.
      if (error instanceof ApiError && error.code === 'MONTH_LOCKED')
        notice(t('owner.hazri.alreadyDone'));
      else throw error;
    }
  }, [salaryKey]);
  const refusal = lock.error instanceof ApiError ? lock.error : null;
  const open =
    refusal?.code === 'REVIEWS_OPEN'
      ? ((refusal.details?.open as number | undefined) ?? data.openReviews)
      : 0;
  return (
    <section className={css.card} aria-label={t('owner.salary.lock.title')}>
      <h2>{t('owner.salary.lock.title')}</h2>
      <p>{t('owner.salary.lock.line')}</p>
      {!data.over && <p className={own.lookBlock}>{t('owner.salary.lock.notOver')}</p>}
      {refusal?.code === 'REVIEWS_OPEN' ? (
        <div className={own.lookBlock} role="alert">
          <p>{t('owner.salary.lock.reviewsOpen', { count: open })}</p>
          <Link className={css.inlineLink} href="/hazri?tab=reviews">
            {t('owner.salary.lock.toReviews')} <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : refusal?.code === 'MONTH_NOT_OVER' ? (
        <p className={own.lookBlock} role="alert">
          {words.error(refusal)}
        </p>
      ) : (
        <Problem error={lock.error} />
      )}
      <Button
        disabled={lock.isPending}
        onClick={async () => {
          if (
            await confirm({
              title: t('owner.salary.lock.confirmTitle', { month: monthName(data.month) }),
              body: t('owner.salary.lock.confirmBody'),
              confirmLabel: t('owner.salary.lock.confirmYes'),
            })
          )
            lock.mutate(undefined);
        }}
      >
        {t('owner.salary.lock.button')}
      </Button>
    </section>
  );
}

/** Fixed pay, with attendance beside it as a fact. An owner reads it and locks it. */
export function Salary() {
  const t = useT();
  const { language } = useLanguage();
  const words = useWords();
  const { can, notice } = useOwner();
  const mayAct = can('staff.salary.pay');
  const [month, setMonth] = useState(previousMonth());
  const run = useQuery({
    queryKey: [...salaryKey, 'run', month],
    queryFn: () => api<RunMonth>(`/admin/salary/runs/${enc(month)}`),
  });
  const [setting, setSetting] = useState<Person | null>(null);
  const data = run.data;
  const locked = data?.status === 'LOCKED';
  return (
    <>
      <PageHeader title={t('owner.salary.title')} />
      <div className={css.stack}>
        <Field label={t('owner.salary.month')}>
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            {monthChoices().map((choice) => (
              <option key={choice} value={choice}>
                {monthName(choice)}
                {choice === currentMonth() ? ` (${t('owner.salary.running')})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <p className={css.hint}>{t('owner.salary.factsMoveNothing')}</p>
        <QueryStatus query={run} />
        {data && (
          <div className={css.row}>
            <StatusPill
              tone={locked ? 'green' : 'neutral'}
              label={
                locked && data.lockedAt
                  ? t('owner.salary.lockedOn', { when: momentLabel(data.lockedAt, language) })
                  : t('owner.salary.draft')
              }
            />
            {locked && (
              <Button
                variant="secondary"
                onClick={() =>
                  void download(
                    `/admin/salary/runs/${enc(month)}/export.csv`,
                    `shiv-salary-${month}.csv`,
                  ).catch((error) => notice(words.error(error), true))
                }
              >
                <Download size={18} aria-hidden="true" /> {t('owner.salary.csv')}
              </Button>
            )}
          </div>
        )}
        {data && data.openReviews > 0 && !locked && (
          <Link className={`${css.card} ${css.cardLink}`} href="/hazri?tab=reviews">
            {t('owner.salary.lock.reviewsOpen', { count: data.openReviews })}{' '}
            <span aria-hidden="true">→</span>
          </Link>
        )}
        {data && !data.lines.length && !data.noTerms.length && (
          <EmptyState title={t('owner.salary.empty')} />
        )}
        {data?.lines.map((row: PayLine) =>
          row.locked ? (
            <LockedCard key={row.userId} row={row} month={month} />
          ) : (
            <DraftCard key={row.userId} row={row} month={month} />
          ),
        )}
        {data && data.noTerms.length > 0 && !locked && (
          <section className={css.card} aria-label={t('owner.salary.noTerms')}>
            <h2>{t('owner.salary.noTerms')}</h2>
            <p className={css.hint}>{t('owner.salary.noTermsHelp')}</p>
            <ul className={own.phoneList}>
              {data.noTerms.map((person) => (
                <li className={own.phoneRow} key={person.userId}>
                  <div>
                    <strong>{person.name}</strong>
                  </div>
                  {mayAct && (
                    <Button
                      variant="secondary"
                      aria-label={t('owner.salary.terms.for', { name: person.name })}
                      onClick={() => setSetting(person)}
                    >
                      {t('owner.salary.terms.set')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {data && !locked && mayAct && <LockBar data={data} />}
      </div>
      {setting && (
        <TermsSheet person={setting} from={`${month}-01`} close={() => setSetting(null)} />
      )}
    </>
  );
}
