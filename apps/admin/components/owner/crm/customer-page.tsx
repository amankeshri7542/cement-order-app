'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@shiv/design';
import { dayLabel, money } from '@shiv/shared';
import { api } from '../../../lib/api';
import { useLanguage, useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import css from '../owner.module.css';
import own from './crm.module.css';
import { FollowUpSheet, kindWord } from './follow-up';
import { bookMoney } from './pure';
import { YaadDilao } from './reminder';
import type { CustomerFacts, CustomerRates, Reminder } from './types';

/** "Tally ₹1,18,000 · 6:40 PM tak · farq ₹7,000 · dekho": second to the khata, with its time. */
function TallyLine({
  tally,
  onTally,
}: {
  tally: NonNullable<CustomerFacts['tally']>;
  onTally?: () => void;
}) {
  const t = useT();
  const words = useWords();
  const see = onTally && (
    <button type="button" className={css.linkButton} onClick={onTally}>
      {t('owner.tally.see')}
    </button>
  );
  if (!tally.connected) return <p className={own.quiet}>{t('owner.crm.tally.notConnected')}</p>;
  const number = tally.number;
  if (!number || number.state === 'NOT_LINKED' || number.tallyPaise === null)
    return (
      <p className={own.quiet}>
        {t('owner.crm.tally.notLinked')} {see}
      </p>
    );
  const when = number.asOf ? words.moment(number.asOf) : '';
  return (
    <>
      <p className={own.second}>
        {[
          t('owner.crm.tally.number', { amount: bookMoney(number.tallyPaise) }),
          when && t('owner.crm.tally.until', { when }),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {number.state === 'COPYING' ? (
        <p className={own.quiet}>{t('owner.crm.tally.copying')}</p>
      ) : number.differencePaise && number.differencePaise !== '0' ? (
        <p className={own.look}>
          {t('owner.crm.tally.difference', { amount: bookMoney(number.differencePaise) })} {see}
        </p>
      ) : (
        see && <p className={own.quiet}>{see}</p>
      )}
      {number.stale && (
        <p className={own.look}>
          {t('owner.tally.numbers.stale', { when: when || t('owner.tally.numbers.tallyNoTime') })}
        </p>
      )}
      {number.tieOut === 'REWRITTEN' && (
        <p className={own.look}>{t('owner.tally.numbers.rewritten')}</p>
      )}
      {number.tieOut === 'FAILED' && <p className={own.look}>{t('owner.crm.tally.notSure')}</p>}
    </>
  );
}

/** The left side of the customer page: the facts, and what a person can do about them. */
export function CustomerFactsCard({ id, onTally }: { id: string; onTally?: () => void }) {
  const t = useT();
  const words = useWords();
  const { language } = useLanguage();
  const { can } = useOwner();
  const [writing, setWriting] = useState(false);
  const facts = useQuery({
    queryKey: ['customers', 'crm', id],
    queryFn: () => api<CustomerFacts>(`/admin/customers/${id}/crm`),
  });
  const data = facts.data;
  const stop = useAction(
    async (stopped: boolean) => {
      await api(`/admin/customers/${id}/reminder-stop`, 'PUT', { stopped });
    },
    [['customers', 'crm', id], ['followups'], ['crm']],
    'owner.saved',
  );
  const view = useAction(
    async (on: boolean) => {
      await api(`/admin/customers/${id}/khata-view`, 'PUT', { on });
    },
    [['customers', 'crm', id]],
    'owner.saved',
  );
  if (!data) return <QueryStatus query={facts} />;
  const signoff = data.signoff;
  const khata = data.khata;
  const used =
    khata && khata.limitPaise && khata.balancePaise > 0
      ? Math.round((khata.balancePaise * 100) / khata.limitPaise)
      : null;
  return (
    <section className={css.card} aria-label={t('owner.crm.facts')}>
      <div className={own.row}>
        {signoff.signed ? (
          <span className={`${own.tag} ${own.tagGood}`}>
            {t('owner.crm.signed', { day: dayLabel(signoff.asOf, language) })}
          </span>
        ) : can('khata.opening.draft') ? (
          <Link href="/udhaar/opening" className={`${own.tag} ${own.tagLook}`}>
            {t('owner.crm.block.notSigned')}
          </Link>
        ) : (
          <span className={`${own.tag} ${own.tagLook}`}>{t('owner.crm.block.notSigned')}</span>
        )}
        {data.reminders.stopped && (
          <span className={`${own.tag} ${own.tagLook}`}>{t('owner.crm.block.stopped')}</span>
        )}
      </div>
      {data.tally && <TallyLine tally={data.tally} onTally={onTally} />}
      <dl className={own.facts}>
        {khata?.limitPaise !== null && khata?.limitPaise !== undefined && (
          <>
            <dt>{t('owner.crm.limit')}</dt>
            <dd>
              {money(khata.limitPaise)}
              {used !== null && ` · ${t('owner.crm.limitUsed', { percent: used })}`}
            </dd>
          </>
        )}
        {khata?.oldestDue && (
          <>
            <dt>{t('owner.crm.oldest')}</dt>
            <dd>
              {khata.oldestDue.opening
                ? t('owner.crm.oldestOpening')
                : dayLabel(khata.oldestDue.on, language)}
            </dd>
          </>
        )}
        {data.lastPayment && (
          <>
            <dt>{t('owner.crm.lastMoney')}</dt>
            <dd>
              {money(data.lastPayment.amountPaise)} · {words.age(data.lastPayment.at)}
            </dd>
          </>
        )}
        {data.lastOrder && (
          <>
            <dt>{t('owner.crm.lastOrder')}</dt>
            <dd>
              <Link href={`/orders/${data.lastOrder.id}`} className={css.inlineLink}>
                {data.lastOrder.number}
              </Link>{' '}
              · {words.age(data.lastOrder.createdAt)}
            </dd>
          </>
        )}
        {data.nextFollowUp && (
          <>
            <dt>{t('owner.crm.nextCall')}</dt>
            <dd>
              {t(kindWord[data.nextFollowUp.kind])} · {dayLabel(data.nextFollowUp.dueOn, language)}
            </dd>
          </>
        )}
        {data.reminders.lastAt && (
          <>
            <dt>{t('owner.crm.lastReminder')}</dt>
            <dd>{words.age(data.reminders.lastAt)}</dd>
          </>
        )}
      </dl>
      <div className={own.buttons}>
        {can('crm.followups') && (
          <Button type="button" variant="secondary" onClick={() => setWriting(true)}>
            {t('owner.crm.newCall')}
          </Button>
        )}
        {can('crm.remind') && <ReminderFromPage id={id} />}
      </div>
      <div className={own.buttons}>
        {can('crm.remind') && !data.reminders.stopped && (
          <Button
            type="button"
            variant="ghost"
            disabled={stop.isPending}
            onClick={() => stop.mutate(true)}
          >
            {t('owner.crm.stopReminders')}
          </Button>
        )}
        {can('customers.edit') && data.reminders.stopped && (
          <Button
            type="button"
            variant="ghost"
            disabled={stop.isPending}
            onClick={() => stop.mutate(false)}
          >
            {t('owner.crm.resumeReminders')}
          </Button>
        )}
        {can('khata.opening.approve') && signoff.signed && (
          <Button
            type="button"
            variant="ghost"
            disabled={view.isPending}
            aria-pressed={data.khataViewOn}
            onClick={() => view.mutate(!data.khataViewOn)}
          >
            {t(data.khataViewOn ? 'owner.crm.hideFromCustomer' : 'owner.crm.showToCustomer')}
          </Button>
        )}
      </div>
      <Problem error={stop.error ?? view.error} />
      {writing && <FollowUpSheet customerId={id} close={() => setWriting(false)} />}
    </section>
  );
}

/** Asks the server what the button may do here, so a stop or an unsigned opening shows as a word. */
function ReminderFromPage({ id }: { id: string }) {
  const preview = useQuery({
    queryKey: ['customers', 'crm', id, 'reminder'],
    queryFn: () => api<Reminder>(`/admin/customers/${id}/reminder`),
  });
  if (!preview.data) return null;
  if (preview.data.blocked === 'NO_BALANCE' || preview.data.blocked === 'NO_PHONE') return null;
  if (!preview.data.blocked && !preview.data.allowed) return null;
  return <YaadDilao customerId={id} blocked={preview.data.blocked} />;
}

const ruleValue = (
  t: ReturnType<typeof useT>,
  rule: Pick<CustomerRates['rules'][number], 'valueType' | 'value'>,
) =>
  rule.valueType === 'RATE'
    ? money(rule.value)
    : rule.valueType === 'AMOUNT_OFF'
      ? t('owner.crm.rates.amountOff', { amount: money(rule.value) })
      : t('owner.crm.rates.percentOff', { percent: rule.value / 100 });

/** Decision 48: the group, their own rates, and where they pay under the list. */
export function CustomerRatesCard({ id }: { id: string }) {
  const t = useT();
  const { language } = useLanguage();
  const { can } = useOwner();
  const rates = useQuery({
    enabled: can('rates.read'),
    queryKey: ['customers', 'rates', id],
    queryFn: () => api<CustomerRates>(`/admin/customers/${id}/rates`),
  });
  if (!can('rates.read')) return null;
  const data = rates.data;
  return (
    <section className={css.card} aria-label={t('owner.crm.rates.title')}>
      <div className={own.spread}>
        <h2>{t('owner.crm.rates.title')}</h2>
        {can('pricing.edit') && (
          <Link href="/rates" className={css.inlineLink}>
            {t('owner.crm.rates.change')} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      <QueryStatus query={rates} />
      {data && (
        <>
          <p>
            {data.group
              ? t('owner.crm.rates.group', { name: data.group.name })
              : t('owner.crm.rates.noGroup')}
          </p>
          {data.rules.length > 0 && (
            <ul className={own.lines}>
              {data.rules.map((rule) => (
                <li key={rule.id}>
                  <span>
                    {rule.appliesTo ?? t('owner.crm.rates.everything')}
                    {rule.minQuantity > 1 &&
                      ` · ${t('owner.crm.rates.from', { quantity: rule.minQuantity })}`}
                    <span className={own.quiet}>
                      {' '}
                      {t(
                        rule.kind === 'SPECIAL' ? 'owner.crm.rates.own' : 'owner.crm.rates.ofGroup',
                      )}
                      {rule.endsOn &&
                        ` · ${t('owner.crm.rates.until', { day: dayLabel(rule.endsOn, language) })}`}
                      {!rule.started &&
                        rule.startsOn &&
                        ` · ${t('owner.crm.rates.startsOn', { day: dayLabel(rule.startsOn, language) })}`}
                    </span>
                  </span>
                  <span className={own.money}>{ruleValue(t, rule)}</span>
                </li>
              ))}
            </ul>
          )}
          {data.lines.length > 0 ? (
            <div className={own.scroll}>
              <table className={own.table}>
                <thead>
                  <tr>
                    <th>{t('owner.crm.rates.item')}</th>
                    <th className={own.moneyCell}>{t('owner.crm.rates.list')}</th>
                    <th className={own.moneyCell}>{t('owner.crm.rates.theirs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line) => (
                    <tr key={line.productId}>
                      <td>{line.name}</td>
                      <td className={own.moneyCell}>{money(line.listPaise)}</td>
                      <td className={own.moneyCell}>{money(line.ratePaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={own.quiet}>{t('owner.crm.rates.listOnly')}</p>
          )}
        </>
      )}
    </section>
  );
}
