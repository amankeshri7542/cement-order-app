'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet, StatusPill } from '@shiv/design';
import { istToday, momentLabel, money } from '@shiv/shared';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { moneyInput, PageHeader, Problem, QueryStatus, rupeesToPaise } from './common';
import { DriverCash } from './driver-cash';
import css from './owner.module.css';

type Sheet_ = {
  opening: number;
  sales: number;
  udhaar: number;
  refunds: number;
  paidIn: number;
  paidOut: number;
  /** Paid to staff from this drawer. Never with a name, so a cashier learns nobody's pay. */
  staffPaid: number;
  expectedPaise: number;
  entries: { id: string; kind: string; amountPaise: number; reason: string; createdAt: string }[];
  carried: boolean;
  close: {
    id: string;
    countedPaise: number;
    differencePaise: number;
    reason: string;
    closedByName: string;
    createdAt: string;
    canCorrect: boolean;
  } | null;
  history: {
    id: string;
    countedPaise: number;
    differencePaise: number;
    reason: string;
    closedByName: string;
    createdAt: string;
  }[];
};
const paiseOf = (rupees: string) => {
  try {
    return rupeesToPaise(rupees);
  } catch {
    return null;
  }
};

/** The cash drawer's day. The server's figure is the only "hona chahiye". */
export function Galla() {
  const t = useT();
  const { language } = useLanguage();
  const { can, shops, shopId } = useOwner();
  const choices = shops.filter((shop) => can('galla.read', shop.id));
  const locationId = (shopId && choices.find((shop) => shop.id === shopId)?.id) || choices[0]?.id;
  const [day, setDay] = useState(istToday());
  const key = ['galla', locationId, day];
  const sheet = useQuery({
    enabled: !!locationId,
    queryKey: key,
    queryFn: () => api<Sheet_>(`/admin/galla?locationId=${locationId}&day=${day}`),
  });
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [entry, setEntry] = useState<'PAID_IN' | 'PAID_OUT' | null>(null);
  const data = sheet.data;
  const typed = paiseOf(counted);
  const difference = data && typed !== null ? typed - data.expectedPaise : null;
  const mayClose = !!locationId && can('galla.close', locationId);
  const close = useAction(
    async () => {
      await api('/admin/galla/close', 'POST', {
        locationId,
        day,
        countedPaise: typed,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(correcting && data?.close ? { supersedesId: data.close.id } : {}),
      });
      setCounted('');
      setReason('');
      setCorrecting(false);
    },
    [key],
    'owner.galla.closed',
  );
  const rows: [string, number][] = data
    ? [
        [t('owner.galla.opening'), data.opening],
        [t('owner.galla.sales'), data.sales],
        [t('owner.galla.udhaar'), data.udhaar],
        [t('owner.galla.paidIn'), data.paidIn],
        [t('owner.galla.refunds'), -data.refunds],
        [t('owner.galla.paidOut'), -data.paidOut],
        [t('owner.galla.staffPaid'), -data.staffPaid],
      ]
    : [];
  const showForm = mayClose && data && (!data.close || correcting);
  return (
    <>
      <PageHeader title={t('owner.galla.title')} />
      <div className={css.stack}>
        <Field label={t('owner.galla.day')}>
          <input
            type="date"
            max={istToday()}
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </Field>
        <QueryStatus query={sheet} />
        {data && (
          <section className={css.card}>
            <table className={css.table}>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className={css.amount}>
                      {value < 0 ? '-' : ''}
                      {money(Math.abs(value))}
                    </td>
                  </tr>
                ))}
                <tr className={css.totalRow}>
                  <th scope="row">{t('owner.galla.expected')}</th>
                  <td className={css.amount}>{money(data.expectedPaise)}</td>
                </tr>
              </tbody>
            </table>
            {data.carried && <p className={css.warnBlock}>{t('owner.galla.carried')}</p>}
            {data.close && (
              <div>
                <p>
                  <StatusPill
                    tone={data.close.differencePaise ? 'red' : 'green'}
                    label={t('owner.galla.closedBy', { name: data.close.closedByName })}
                  />
                </p>
                <p>{t('owner.galla.countedWas', { amount: money(data.close.countedPaise) })}</p>
                {data.close.differencePaise !== 0 && (
                  <p>
                    {t(data.close.differencePaise < 0 ? 'owner.galla.short' : 'owner.galla.over', {
                      amount: money(Math.abs(data.close.differencePaise)),
                    })}
                    {' · '}
                    {data.close.reason}
                  </p>
                )}
                <p className={css.sub}>{momentLabel(data.close.createdAt, language)}</p>
                {data.history.map((row) => (
                  <p className={css.sub} key={row.id}>
                    {t('owner.galla.earlier', {
                      amount: money(row.countedPaise),
                      name: row.closedByName,
                    })}
                    {row.differencePaise !== 0 &&
                      ` · ${t('owner.galla.earlierDifference', {
                        amount: `${row.differencePaise < 0 ? '-' : ''}${money(Math.abs(row.differencePaise))}`,
                      })}`}
                    {row.reason && ` · ${row.reason}`}
                  </p>
                ))}
                {mayClose && !correcting && !data.close.canCorrect && (
                  <p className={css.sub}>{t('owner.galla.correctOther')}</p>
                )}
                {mayClose && !correcting && data.close.canCorrect && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setCorrecting(true);
                      setCounted(moneyInput(data.close?.countedPaise));
                    }}
                  >
                    {t('owner.galla.correct')}
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
        {showForm && (
          <form
            className={css.card}
            onSubmit={(event) => {
              event.preventDefault();
              close.mutate(undefined);
            }}
          >
            <Field label={t('owner.galla.howMuch')}>
              <input
                inputMode="decimal"
                required
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
              />
            </Field>
            {difference !== null && difference !== 0 && (
              <p className={css.error} role="status">
                {t(difference < 0 ? 'owner.galla.short' : 'owner.galla.over', {
                  amount: money(Math.abs(difference)),
                })}{' '}
                {t('owner.galla.why')}
              </p>
            )}
            {(correcting || (difference !== null && difference !== 0)) && (
              <Field label={t('owner.galla.reason')}>
                <input
                  required
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
            )}
            <Problem error={close.error} />
            <Button disabled={typed === null || close.isPending}>{t('owner.galla.close')}</Button>
          </form>
        )}
        {mayClose && data && !data.close && day === istToday() && (
          <div className={css.actions}>
            <Button variant="secondary" onClick={() => setEntry('PAID_OUT')}>
              {t('owner.galla.addPaidOut')}
            </Button>
            <Button variant="secondary" onClick={() => setEntry('PAID_IN')}>
              {t('owner.galla.addPaidIn')}
            </Button>
          </div>
        )}
        {data && data.entries.length > 0 && (
          <section className={css.card}>
            <h2>{t('owner.galla.entries')}</h2>
            {data.entries.map((row) => (
              <div className={css.row} key={row.id}>
                <span>{row.reason}</span>
                <span className={css.amount}>
                  {row.kind === 'PAID_OUT' ? '-' : ''}
                  {money(row.amountPaise)}
                </span>
              </div>
            ))}
          </section>
        )}
        {locationId && can('cash.count', locationId) && (
          <DriverCash locationId={locationId} sheetKey={key} />
        )}
      </div>
      {entry && locationId && (
        <EntrySheet
          kind={entry}
          locationId={locationId}
          queryKey={key}
          close={() => setEntry(null)}
        />
      )}
    </>
  );
}

function EntrySheet({
  kind,
  locationId,
  queryKey,
  close,
}: {
  kind: 'PAID_IN' | 'PAID_OUT';
  locationId: string;
  queryKey: (string | undefined)[];
  close: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // The same key for every try, so a retry after a lost answer pays out once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const typed = paiseOf(amount);
  const save = useAction(
    async () => {
      await api('/admin/galla/entries', 'POST', {
        locationId,
        kind,
        amountPaise: typed,
        reason: reason.trim(),
        idempotencyKey,
      });
      close();
    },
    [queryKey],
    'owner.rates.saved',
  );
  return (
    <Sheet
      title={t(kind === 'PAID_OUT' ? 'owner.galla.addPaidOut' : 'owner.galla.addPaidIn')}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label={t('owner.galla.amount')}>
          <input
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label={t('owner.galla.reason')}>
          <input
            required
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Problem error={save.error} />
        <div className={css.sheetBar}>
          <Button className={css.wide} disabled={!typed || !reason.trim() || save.isPending}>
            {t('owner.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
