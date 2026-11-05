'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet } from '@shiv/design';
import { money } from '@shiv/shared';
import { ApiError, api } from '../../../lib/api';
import { useT, useWords } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { moneyInput, Problem } from '../common';
import own from '../hazri/hazri.module.css';
import css from '../owner.module.css';
import { overCashLimit, paiseOf, readSource, sourceValue } from './pure';
import type { Ledger } from './types';

export const salaryKey = ['salary'];
const enc = encodeURIComponent;
type Person = { userId: string; name: string };

/** Keeps one key for as long as the same thing is being sent, so a retry never does it twice. */
function useRetryKey() {
  const attempt = useRef({ sent: '', key: '' });
  return {
    keyFor: (body: unknown) => {
      const sent = JSON.stringify(body);
      if (attempt.current.sent !== sent) attempt.current = { sent, key: crypto.randomUUID() };
      return attempt.current.key;
    },
    done: () => {
      attempt.current = { sent: '', key: '' };
    },
  };
}

function SheetForm({
  title,
  busy,
  close,
  onSubmit,
  children,
}: {
  title: string;
  busy: boolean;
  close: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <Sheet
      title={title}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
    </Sheet>
  );
}

/** A new rate from a date. Earlier months keep the rate they had. */
export function TermsSheet({
  person,
  from,
  current,
  close,
}: {
  person: Person;
  from: string;
  current?: number | null;
  close: () => void;
}) {
  const t = useT();
  const { notice } = useOwner();
  const [amount, setAmount] = useState(current ? moneyInput(current) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(from);
  const typed = paiseOf(amount);
  const save = useAction(async () => {
    await api(`/admin/salary/terms/${enc(person.userId)}`, 'PUT', {
      effectiveFrom,
      amountPaise: typed,
    });
    notice(t('owner.salary.terms.saved', { name: person.name }));
    close();
  }, [salaryKey]);
  return (
    <SheetForm
      title={t('owner.salary.terms.title', { name: person.name })}
      busy={save.isPending}
      close={close}
      onSubmit={() => {
        if (typed) save.mutate(undefined);
      }}
    >
      <Field label={t('owner.salary.terms.amount')}>
        <input
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label={t('owner.salary.terms.from')}>
        <input
          type="date"
          required
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
        />
      </Field>
      <p className={css.hint}>{t('owner.salary.terms.help')}</p>
      <Problem error={save.error} />
      <Button className={css.wide} disabled={save.isPending || !typed || !effectiveFrom}>
        {t('owner.save')}
      </Button>
    </SheetForm>
  );
}

/** Add or take away, and always with a reason. Nothing here happens by itself. */
export function AdjustSheet({
  person,
  month,
  close,
}: {
  person: Person;
  month: string;
  close: () => void;
}) {
  const t = useT();
  const { notice } = useOwner();
  const [kind, setKind] = useState<'ADDITION' | 'DEDUCTION'>('ADDITION');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const retry = useRetryKey();
  const typed = paiseOf(amount);
  const save = useAction(async () => {
    const body = { userId: person.userId, kind, amountPaise: typed, reason: reason.trim() };
    await api(`/admin/salary/runs/${enc(month)}/adjustments`, 'POST', {
      ...body,
      idempotencyKey: retry.keyFor(body),
    });
    retry.done();
    notice(t('owner.salary.adjust.saved', { name: person.name }));
    close();
  }, [salaryKey]);
  return (
    <SheetForm
      title={t('owner.salary.adjust.title', { name: person.name })}
      busy={save.isPending}
      close={close}
      onSubmit={() => {
        if (typed) save.mutate(undefined);
      }}
    >
      <Field label={t('owner.salary.adjust.kind')}>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as 'ADDITION' | 'DEDUCTION')}
        >
          <option value="ADDITION">{t('owner.salary.adjust.add')}</option>
          <option value="DEDUCTION">{t('owner.salary.adjust.take')}</option>
        </select>
      </Field>
      <Field label={t('owner.salary.amount')}>
        <input
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label={t('owner.salary.reason')}>
        <input
          required
          minLength={2}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {kind === 'DEDUCTION' && <p className={css.hint}>{t('owner.salary.adjust.limit')}</p>}
      <Problem error={save.error} />
      <Button className={css.wide} disabled={save.isPending || !typed}>
        {t('owner.save')}
      </Button>
    </SheetForm>
  );
}

/** A wrong line stays on the page, with the entry that took it back beside it. */
export function TakeBackSheet({
  title,
  body,
  run,
  close,
}: {
  title: string;
  body: string;
  run: (reason: string, key: string) => Promise<unknown>;
  close: () => void;
}) {
  const t = useT();
  const { notice } = useOwner();
  const [reason, setReason] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const save = useAction(async () => {
    try {
      await run(reason.trim(), key);
      notice(t('owner.salary.takeBack.done'));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REVERSED_ALREADY')
        notice(t('owner.hazri.alreadyDone'));
      else throw error;
    }
    close();
  }, [salaryKey]);
  return (
    <SheetForm
      title={title}
      busy={save.isPending}
      close={close}
      onSubmit={() => save.mutate(undefined)}
    >
      <p>{body}</p>
      <Field label={t('owner.salary.reason')}>
        <input
          required
          minLength={2}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <Problem error={save.error} />
      <Button className={css.wide} disabled={save.isPending}>
        {t('owner.salary.takeBack.button')}
      </Button>
    </SheetForm>
  );
}

export function RecoverySheet({
  person,
  month,
  balancePaise,
  plannedPaise,
  close,
}: {
  person: Person;
  month: string;
  balancePaise: number;
  plannedPaise: number;
  close: () => void;
}) {
  const t = useT();
  const { notice } = useOwner();
  const [amount, setAmount] = useState(moneyInput(plannedPaise));
  const [reason, setReason] = useState('');
  const typed = paiseOf(amount);
  const save = useAction(async () => {
    await api(`/admin/salary/runs/${enc(month)}/recovery`, 'POST', {
      userId: person.userId,
      recoveryPaise: typed,
      reason: reason.trim(),
    });
    notice(t('owner.salary.recovery.saved', { name: person.name }));
    close();
  }, [salaryKey]);
  return (
    <SheetForm
      title={t('owner.salary.recovery.title', { name: person.name })}
      busy={save.isPending}
      close={close}
      onSubmit={() => {
        if (typed !== null) save.mutate(undefined);
      }}
    >
      <p>{t('owner.salary.recovery.balance', { amount: money(balancePaise) })}</p>
      <Field label={t('owner.salary.recovery.amount')}>
        <input
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label={t('owner.salary.reason')}>
        <input
          required
          minLength={2}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <p className={css.hint}>{t('owner.salary.recovery.help')}</p>
      <Problem error={save.error} />
      <Button className={css.wide} disabled={save.isPending || typed === null}>
        {t('owner.save')}
      </Button>
    </SheetForm>
  );
}

/** Cash or UPI, from where, and an optional reference. The same fields for pay and for an advance. */
function MoneyFields({
  personId,
  amountPaise,
  channel,
  setChannel,
  source,
  setSource,
  utr,
  setUtr,
}: {
  personId: string;
  amountPaise: number | null;
  channel: 'CASH' | 'UPI';
  setChannel: (value: 'CASH' | 'UPI') => void;
  source: string;
  setSource: (value: string) => void;
  utr: string;
  setUtr: (value: string) => void;
}) {
  const t = useT();
  const { shops } = useOwner();
  const ledger = useQuery({
    queryKey: [...salaryKey, 'person', personId],
    queryFn: () => api<Ledger>(`/admin/salary/people/${enc(personId)}`),
  });
  return (
    <>
      <Field label={t('owner.salary.money.how')}>
        <select
          value={channel}
          onChange={(event) => {
            const next = event.target.value as 'CASH' | 'UPI';
            setChannel(next);
            // A drawer only pays out in cash.
            if (next === 'UPI') setSource(sourceValue({ paidFrom: 'OWNER' }));
          }}
        >
          <option value="CASH">{t('owner.salary.money.cash')}</option>
          <option value="UPI">{t('owner.salary.money.upi')}</option>
        </select>
      </Field>
      <Field label={t('owner.salary.money.from')}>
        <select value={source} onChange={(event) => setSource(event.target.value)}>
          <option value="OWNER">{t('owner.salary.money.owner')}</option>
          {channel === 'CASH' &&
            shops.map((shop) => (
              <option key={shop.id} value={sourceValue({ paidFrom: 'GALLA', locationId: shop.id })}>
                {t('owner.salary.money.drawer', { shop: shop.name })}
              </option>
            ))}
        </select>
      </Field>
      {channel === 'UPI' && (
        <Field label={t('owner.salary.money.utr')}>
          <input maxLength={40} value={utr} onChange={(event) => setUtr(event.target.value)} />
        </Field>
      )}
      {overCashLimit(amountPaise, channel, ledger.data?.items ?? []) && (
        <p className={own.lookBlock} role="status">
          {t('owner.salary.money.cashWarning')}
        </p>
      )}
    </>
  );
}

export function PaySheet({
  person,
  month,
  owedPaise,
  close,
}: {
  person: Person;
  month: string;
  owedPaise: number;
  close: () => void;
}) {
  const t = useT();
  const words = useWords();
  const { notice } = useOwner();
  const [amount, setAmount] = useState(moneyInput(Math.max(owedPaise, 0)));
  const [channel, setChannel] = useState<'CASH' | 'UPI'>('CASH');
  const [source, setSource] = useState('OWNER');
  const [utr, setUtr] = useState('');
  const retry = useRetryKey();
  const typed = paiseOf(amount);
  const save = useAction(async () => {
    const body = {
      userId: person.userId,
      amountPaise: typed,
      channel,
      ...readSource(source),
      ...(channel === 'UPI' && utr.trim() ? { utr: utr.trim() } : {}),
    };
    await api(`/admin/salary/runs/${enc(month)}/pay`, 'POST', {
      ...body,
      idempotencyKey: retry.keyFor(body),
    });
    retry.done();
    notice(t('owner.salary.pay.saved', { name: person.name, amount: money(typed ?? 0) }));
    close();
  }, [salaryKey]);
  const tooMuch =
    save.error instanceof ApiError && save.error.code === 'PAYING_TOO_MUCH'
      ? (save.error.details?.duePaise as number | undefined)
      : undefined;
  return (
    <SheetForm
      title={t('owner.salary.pay.title', { name: person.name })}
      busy={save.isPending}
      close={close}
      onSubmit={() => {
        if (typed) save.mutate(undefined);
      }}
    >
      <p>{t('owner.salary.pay.owed', { amount: money(Math.max(owedPaise, 0)) })}</p>
      <Field label={t('owner.salary.amount')}>
        <input
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <MoneyFields
        personId={person.userId}
        amountPaise={typed}
        channel={channel}
        setChannel={setChannel}
        source={source}
        setSource={setSource}
        utr={utr}
        setUtr={setUtr}
      />
      {tooMuch === undefined ? (
        <Problem error={save.error} />
      ) : (
        <p className={css.error} role="alert">
          {words.error(save.error)} {t('owner.salary.pay.dueIs', { amount: money(tooMuch) })}
        </p>
      )}
      <Button className={css.wide} disabled={save.isPending || !typed}>
        {t('owner.salary.pay.save')}
      </Button>
    </SheetForm>
  );
}

export function AdvanceSheet({ person, close }: { person: Person; close: () => void }) {
  const t = useT();
  const { notice } = useOwner();
  const [amount, setAmount] = useState('');
  const [recovery, setRecovery] = useState('');
  const [channel, setChannel] = useState<'CASH' | 'UPI'>('CASH');
  const [source, setSource] = useState('OWNER');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const retry = useRetryKey();
  const typed = paiseOf(amount);
  const monthly = recovery.trim() ? paiseOf(recovery) : 0;
  const save = useAction(async () => {
    const body = {
      userId: person.userId,
      amountPaise: typed,
      recoveryPaise: monthly,
      channel,
      ...readSource(source),
      ...(channel === 'UPI' && utr.trim() ? { utr: utr.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    await api('/admin/salary/advances', 'POST', { ...body, idempotencyKey: retry.keyFor(body) });
    retry.done();
    notice(t('owner.salary.advance.saved', { name: person.name, amount: money(typed ?? 0) }));
    close();
  }, [salaryKey]);
  return (
    <SheetForm
      title={t('owner.salary.advance.title', { name: person.name })}
      busy={save.isPending}
      close={close}
      onSubmit={() => {
        if (typed && monthly !== null) save.mutate(undefined);
      }}
    >
      <Field label={t('owner.salary.amount')}>
        <input
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      <Field label={t('owner.salary.advance.monthly')}>
        <input
          inputMode="decimal"
          value={recovery}
          onChange={(event) => setRecovery(event.target.value)}
        />
      </Field>
      <MoneyFields
        personId={person.userId}
        amountPaise={typed}
        channel={channel}
        setChannel={setChannel}
        source={source}
        setSource={setSource}
        utr={utr}
        setUtr={setUtr}
      />
      <Field label={t('owner.salary.advance.note')}>
        <input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <Problem error={save.error} />
      <Button className={css.wide} disabled={save.isPending || !typed || monthly === null}>
        {t('owner.salary.advance.save')}
      </Button>
    </SheetForm>
  );
}
