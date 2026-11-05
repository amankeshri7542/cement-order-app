'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet } from '@shiv/design';
import { addDays, istToday } from '@shiv/shared';
import { api } from '../../../lib/api';
import { rupeesToPaise } from '../../../lib/money';
import { useT } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus, useShopChoice } from '../common';
import css from '../owner.module.css';
import own from './crm.module.css';
import { dayFor, type When } from './pure';
import type { Call, FollowUpKind } from './types';

const kinds: FollowUpKind[] = ['PAYMENT', 'ORDER', 'CALLBACK', 'OTHER'];
export const kindWord = {
  PAYMENT: 'owner.crm.kind.payment',
  ORDER: 'owner.crm.kind.order',
  CALLBACK: 'owner.crm.kind.callback',
  OTHER: 'owner.crm.kind.other',
} as const;
/** After a write, everything that shows a call reads again. */
export const callKeys = [['followups'], ['customers'], ['crm']];

/** Kal, Agle hafte, Tareekh chuno. The date is worked out in India time. */
export function WhenChoice({
  when,
  setWhen,
  picked,
  setPicked,
  allowToday = true,
}: {
  when: When;
  setWhen: (when: When) => void;
  picked: string;
  setPicked: (day: string) => void;
  allowToday?: boolean;
}) {
  const t = useT();
  const options: [When, Parameters<typeof t>[0]][] = [
    ...(allowToday
      ? ([['today', 'owner.crm.when.today']] as [When, 'owner.crm.when.today'][])
      : []),
    ['tomorrow', 'owner.crm.when.tomorrow'],
    ['week', 'owner.crm.when.week'],
    ['pick', 'owner.crm.when.pick'],
  ];
  return (
    <>
      <div className={css.chips} role="group" aria-label={t('owner.crm.when')}>
        {options.map(([value, word]) => (
          <Button
            key={value}
            type="button"
            variant={when === value ? 'primary' : 'secondary'}
            aria-pressed={when === value}
            onClick={() => setWhen(value)}
          >
            {t(word)}
          </Button>
        ))}
      </div>
      {when === 'pick' && (
        <Field label={t('owner.crm.when.date')}>
          <input
            type="date"
            value={picked}
            min={addDays(istToday(), allowToday ? 0 : 1)}
            max={addDays(istToday(), 366)}
            onChange={(event) => setPicked(event.target.value)}
            required
          />
        </Field>
      )}
    </>
  );
}
/** A call for later. Kab dega? creates the promise after a reminder, with the amount they said. */
export function FollowUpSheet({
  customerId,
  close,
  startKind = 'CALLBACK',
}: {
  customerId: string;
  close: () => void;
  startKind?: FollowUpKind;
}) {
  const t = useT();
  const { locationId, field } = useShopChoice('crm.followups');
  const [kind, setKind] = useState<FollowUpKind>(startKind);
  const [when, setWhen] = useState<When>('tomorrow');
  const [picked, setPicked] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const key = useRef(crypto.randomUUID());
  const action = useAction(
    async () => {
      await api('/admin/followups', 'POST', {
        customerId,
        dueOn: dayFor(when, picked, istToday()),
        kind,
        idempotencyKey: key.current,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(kind === 'PAYMENT' && amount ? { promisedPaise: rupeesToPaise(amount) } : {}),
        ...(locationId ? { locationId } : {}),
      });
      close();
    },
    callKeys,
    'owner.crm.callWritten',
  );
  return (
    <Sheet title={t('owner.crm.newCall')} closeLabel={t('owner.close')} onClose={close}>
      <form
        className={own.sheetBody}
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        {field}
        <div className={css.chips} role="group" aria-label={t('owner.crm.kind')}>
          {kinds.map((value) => (
            <Button
              key={value}
              type="button"
              variant={kind === value ? 'primary' : 'secondary'}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {t(kindWord[value])}
            </Button>
          ))}
        </div>
        <WhenChoice when={when} setWhen={setWhen} picked={picked} setPicked={setPicked} />
        {kind === 'PAYMENT' && (
          <Field label={t('owner.crm.promised')}>
            <input
              inputMode="decimal"
              value={amount}
              pattern="[0-9]+([.][0-9]{1,2})?"
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        )}
        <Field label={t('owner.crm.note')}>
          <textarea
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Problem error={action.error} />
        <Button disabled={action.isPending}>{t('owner.crm.writeCall')}</Button>
      </form>
    </Sheet>
  );
}

/** Baad mein: a later day and why, so the next person knows. */
export function SnoozeSheet({ call, close }: { call: Call; close: () => void }) {
  const t = useT();
  const [when, setWhen] = useState<When>('tomorrow');
  const [picked, setPicked] = useState('');
  const [reason, setReason] = useState('');
  const key = useRef(crypto.randomUUID());
  const action = useAction(
    async () => {
      await api(`/admin/followups/${call.id}`, 'PATCH', {
        action: 'SNOOZE',
        dueOn: dayFor(when, picked, istToday()),
        reason: reason.trim(),
        idempotencyKey: key.current,
      });
      close();
    },
    callKeys,
    'owner.crm.callMoved',
  );
  return (
    <Sheet title={t('owner.crm.later')} closeLabel={t('owner.close')} onClose={close}>
      <form
        className={own.sheetBody}
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        <WhenChoice
          when={when}
          setWhen={setWhen}
          picked={picked}
          setPicked={setPicked}
          allowToday={false}
        />
        <Field label={t('owner.crm.laterWhy')}>
          <input
            value={reason}
            maxLength={200}
            required
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Problem error={action.error} />
        <Button disabled={action.isPending || !reason.trim()}>{t('owner.crm.moveCall')}</Button>
      </form>
    </Sheet>
  );
}

type Person = { id: string; name: string };
/** Kisko do: only people who can take this shop's calls are offered. */
export function AssignSheet({ call, close }: { call: Call; close: () => void }) {
  const t = useT();
  const { notice } = useOwner();
  const people = useQuery({
    queryKey: ['followups', 'people', call.locationId],
    queryFn: () =>
      api<{ items: Person[] }>(`/admin/followups/people?locationId=${call.locationId}`),
  });
  const key = useRef(crypto.randomUUID());
  const action = useAction(async (assigneeId: string | null) => {
    await api(`/admin/followups/${call.id}`, 'PATCH', {
      action: 'ASSIGN',
      assigneeId,
      idempotencyKey: key.current,
    });
    close();
    notice(t('owner.crm.callGiven'));
  }, callKeys);
  return (
    <Sheet title={t('owner.crm.giveTo')} closeLabel={t('owner.close')} onClose={close}>
      <div className={own.sheetBody}>
        <QueryStatus query={people} />
        {people.data && (
          <div className={own.buttons}>
            {people.data.items.map((person) => (
              <Button
                key={person.id}
                type="button"
                variant={call.assignee?.id === person.id ? 'primary' : 'secondary'}
                aria-pressed={call.assignee?.id === person.id}
                disabled={action.isPending}
                onClick={() => action.mutate(person.id)}
              >
                {person.name}
              </Button>
            ))}
            {call.assignee && (
              <Button
                type="button"
                variant="ghost"
                disabled={action.isPending}
                onClick={() => action.mutate(null)}
              >
                {t('owner.crm.giveToNobody')}
              </Button>
            )}
          </div>
        )}
        <Problem error={action.error} />
      </div>
    </Sheet>
  );
}
