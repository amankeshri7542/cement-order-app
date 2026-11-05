'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet } from '@shiv/design';
import { api } from '../../../lib/api';
import { useT } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import css from '../owner.module.css';
import { paiseOf } from './pure';

function AskSheet({ close }: { close: () => void }) {
  const t = useT();
  const { notice } = useOwner();
  const people = useQuery({
    queryKey: ['salary', 'askable'],
    queryFn: () => api<{ items: { id: string; name: string }[] }>('/admin/salary/advances/people'),
  });
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [recovery, setRecovery] = useState('');
  const [note, setNote] = useState('');
  const attempt = useRef({ sent: '', key: '' });
  const typed = paiseOf(amount);
  const monthly = recovery.trim() ? paiseOf(recovery) : 0;
  const ask = useAction(async () => {
    const body = {
      userId,
      amountPaise: typed,
      recoveryPaise: monthly,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const sent = JSON.stringify(body);
    if (attempt.current.sent !== sent) attempt.current = { sent, key: crypto.randomUUID() };
    await api('/admin/salary/advances/ask', 'POST', {
      ...body,
      idempotencyKey: attempt.current.key,
    });
    notice(t('owner.salary.ask.sent'));
    close();
  }, [['approvals']]);
  return (
    <Sheet
      title={t('owner.salary.ask.title')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!ask.isPending) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          if (userId && typed && monthly !== null) ask.mutate(undefined);
        }}
      >
        <p>{t('owner.salary.ask.body')}</p>
        <QueryStatus query={people} />
        {people.data && (
          <Field label={t('owner.salary.ask.who')}>
            <select required value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">{t('owner.trips.choose')}</option>
              {people.data.items.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
        )}
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
        <Field label={t('owner.salary.reason')}>
          <input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Problem error={ask.error} />
        <Button
          className={css.wide}
          disabled={ask.isPending || !userId || !typed || monthly === null}
        >
          {t('owner.salary.ask.send')}
        </Button>
      </form>
    </Sheet>
  );
}

/** For a manager or cashier. Only an owner says yes, in Manzoori, and nobody's pay is shown here. */
export function AskAdvance() {
  const t = useT();
  const { can } = useOwner();
  const [open, setOpen] = useState(false);
  if (!can('approvals.ask') || !can('cash.count') || can('staff.salary.pay')) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('owner.salary.ask.title')}
      </Button>
      {open && <AskSheet close={() => setOpen(false)} />}
    </>
  );
}
