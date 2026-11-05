'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, Sheet, StatusPill } from '@shiv/design';
import { dayLabel, momentLabel, money } from '@shiv/shared';
import { api } from '../../../lib/api';
import { useLanguage, useT } from '../../../lib/i18n';
import { useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import own from '../hazri/hazri.module.css';
import css from '../owner.module.css';
import { ledgerWords, monthName } from './pure';
import pay from './salary.module.css';
import { AdvanceSheet, salaryKey, TakeBackSheet, TermsSheet } from './sheets';
import type { Facts, Ledger, LedgerItem, Slip, TermsRow } from './types';

const enc = encodeURIComponent;

/** What the attendance record says. On the page beside the pay, and it moves no rupee. */
export function FactsLine({ facts }: { facts: Facts }) {
  const t = useT();
  return (
    <p className={pay.facts}>
      <strong>{t('owner.salary.facts.title')}</strong>{' '}
      {t('owner.salary.facts.body', {
        present: facts.daysPresent,
        late: facts.daysLate,
        offs: facts.weeklyOffsWorked,
        noOut: facts.missingOut,
      })}
    </p>
  );
}

export function Money({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={`${css.ledgerLine} ${strong ? pay.netLine : ''}`}>
      <span>{label}</span>
      <span className={css.amount}>
        {value < 0 ? '-' : ''}
        {money(Math.abs(value))}
      </span>
    </div>
  );
}

/** One person's slip, as it was frozen when the month was locked. */
export function SlipSheet({
  slip,
  paidPaise,
  close,
}: {
  slip: Slip;
  paidPaise: number;
  close: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  return (
    <Sheet
      title={t('owner.salary.slip.title', { name: slip.name })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={`print-slip ${css.stack}`}>
        <div>
          <strong>{t('owner.deskName')}</strong>
          <h3 className={pay.slipName}>{slip.name}</h3>
          <p className={css.sub}>
            {t('owner.salary.slip.month', { month: monthName(slip.month) })}
          </p>
        </div>
        <div className={css.ledger}>
          <Money label={t('owner.salary.line.monthly')} value={slip.monthlyPaise} />
          {slip.adjustments.map((row, index) => (
            <Money
              key={index}
              label={`${t(
                row.kind === 'DEDUCTION' ? 'owner.salary.line.take' : 'owner.salary.line.add',
              )}: ${row.reason}`}
              value={row.kind === 'DEDUCTION' ? -row.amountPaise : row.amountPaise}
            />
          ))}
          {slip.recoveryPaise > 0 && (
            <Money label={t('owner.salary.line.recovery')} value={-slip.recoveryPaise} />
          )}
          {slip.roundOffPaise !== 0 && (
            <Money label={t('owner.salary.line.roundOff')} value={slip.roundOffPaise} />
          )}
          <Money label={t('owner.salary.line.net')} value={slip.netPaise} strong />
        </div>
        <p>{t('owner.salary.slip.paid', { amount: money(paidPaise) })}</p>
        {slip.advanceLeftPaise > 0 && (
          <p>{t('owner.salary.slip.advanceLeft', { amount: money(slip.advanceLeftPaise) })}</p>
        )}
        <FactsLine facts={slip.facts} />
        <p className={css.hint}>
          {t('owner.salary.slip.lockedOn', { when: momentLabel(slip.lockedAt, language) })}
        </p>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}>
          <Printer size={18} aria-hidden="true" /> {t('owner.salary.slip.print')}
        </Button>
      </div>
    </Sheet>
  );
}

function AckLine({ ack }: { ack: LedgerItem['ack'] }) {
  const t = useT();
  if (ack === 'GOT') return <span className={own.toneOk}>{t('owner.salary.ack.got')}</span>;
  if (ack === 'NOT_GOT') return <strong>{t('owner.salary.ack.notGot')}</strong>;
  return <span className={css.hint}>{t('owner.salary.ack.none')}</span>;
}

function LedgerRow({
  row,
  mayAct,
  takeBack,
}: {
  row: LedgerItem;
  mayAct: boolean;
  takeBack: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const paid = row.kind === 'PAID' || row.kind === 'ADVANCE_GIVEN';
  return (
    <li className={pay.entry}>
      <div className={css.row}>
        <strong>{t(ledgerWords[row.kind] ?? 'owner.salary.entry.other')}</strong>
        <span className={css.amount}>{money(row.amountPaise)}</span>
      </div>
      <p className={css.hint}>
        {[
          momentLabel(row.at, language),
          row.month && monthName(row.month),
          row.channel === 'CASH' && t('owner.salary.money.cash'),
          row.channel === 'UPI' && t('owner.salary.money.upi'),
          row.paidFrom === 'GALLA' && t('owner.salary.money.drawerPlain'),
          row.paidFrom === 'OWNER' && t('owner.salary.money.owner'),
          row.utr && t('owner.salary.money.utrIs', { utr: row.utr }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {/* What someone typed stays plain text. */}
      {row.note && <p className={css.said}>{row.note}</p>}
      {row.reversed && <StatusPill label={t('owner.salary.entry.takenBack')} />}
      {paid && !row.reversed && <AckLine ack={row.ack} />}
      {paid && !row.reversed && mayAct && (
        <div className={css.actions}>
          <Button variant="secondary" onClick={takeBack}>
            {t('owner.salary.takeBack.button')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** One person's money record. Nothing is erased: a mistake gets an opposite entry, and both show. */
export function PersonSheet({
  person,
  month,
  close,
}: {
  person: { userId: string; name: string };
  month: string;
  close: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const { can, me } = useOwner();
  const mayAct = can('staff.salary.pay');
  const ledger = useQuery({
    queryKey: [...salaryKey, 'person', person.userId],
    queryFn: () => api<Ledger>(`/admin/salary/people/${enc(person.userId)}`),
  });
  const terms = useQuery({
    queryKey: [...salaryKey, 'terms'],
    queryFn: () => api<{ items: TermsRow[] }>('/admin/salary/terms'),
  });
  const rate = terms.data?.items.find((row) => row.userId === person.userId);
  const [open, setOpen] = useState<'terms' | 'advance' | LedgerItem | null>(null);
  return (
    <Sheet
      title={t('owner.salary.person.title', { name: person.name })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={css.stack}>
        <QueryStatus query={ledger} />
        {rate?.amountPaise && rate.effectiveFrom ? (
          <p>
            {t('owner.salary.person.rate', {
              amount: money(rate.amountPaise),
              day: dayLabel(rate.effectiveFrom, language),
            })}
          </p>
        ) : (
          terms.data && <p>{t('owner.salary.noTermsLine')}</p>
        )}
        {ledger.data && (
          <div className={css.ledger}>
            <Money label={t('owner.salary.person.due')} value={ledger.data.wagesDuePaise} />
            <Money label={t('owner.salary.person.advance')} value={ledger.data.advancePaise} />
          </div>
        )}
        {ledger.data && !ledger.data.chainOk && (
          <p className={own.lookBlock} role="alert">
            {t('owner.salary.person.chainBroken')}
          </p>
        )}
        {mayAct && (
          <div className={css.actions}>
            <Button variant="secondary" onClick={() => setOpen('terms')}>
              {t('owner.salary.terms.change')}
            </Button>
            {person.userId !== me.id && (
              <Button variant="secondary" onClick={() => setOpen('advance')}>
                {t('owner.salary.advance.give')}
              </Button>
            )}
          </div>
        )}
        <h3>{t('owner.salary.person.record')}</h3>
        {ledger.data && !ledger.data.items.length && <p>{t('owner.salary.person.empty')}</p>}
        {!!ledger.data?.items.length && (
          <ul className={pay.entries}>
            {ledger.data.items.map((row) => (
              <LedgerRow key={row.id} row={row} mayAct={mayAct} takeBack={() => setOpen(row)} />
            ))}
          </ul>
        )}
        <Problem error={terms.error} />
      </div>
      {open === 'terms' && (
        <TermsSheet
          person={person}
          from={`${month}-01`}
          current={rate?.amountPaise ?? null}
          close={() => setOpen(null)}
        />
      )}
      {open === 'advance' && <AdvanceSheet person={person} close={() => setOpen(null)} />}
      {open && typeof open === 'object' && (
        <TakeBackSheet
          title={t('owner.salary.takeBack.entryTitle')}
          body={t('owner.salary.takeBack.entryBody', { amount: money(open.amountPaise) })}
          run={(reason, key) =>
            api(`/admin/salary/ledger/${enc(open.id)}/reverse`, 'POST', {
              reason,
              idempotencyKey: key,
            })
          }
          close={() => setOpen(null)}
        />
      )}
    </Sheet>
  );
}
