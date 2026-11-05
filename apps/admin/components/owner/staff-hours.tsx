'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet, Skeleton } from '@shiv/design';
import { dayLabel, istToday, weekdayLabel } from '@shiv/shared';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { Problem, QueryStatus } from './common';
import own from './hazri/hazri.module.css';
import { hazriKey } from './hazri/today';
import type { StaffPhone } from './hazri/types';
import { minuteOf, timeOf } from './hazri/words';
import css from './owner.module.css';

type Schedule = {
  effectiveFrom: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  weeklyOffs: number[];
};
const enc = encodeURIComponent;
/** A week that starts on a Sunday, only to ask the shared words for each day's name. */
const sunday = (index: number) => `2026-11-0${index + 1}`;

function ScheduleForm({ userId, current }: { userId: string; current: Schedule | null }) {
  const t = useT();
  const { language } = useLanguage();
  const { notice } = useOwner();
  const today = istToday();
  const [start, setStart] = useState(timeOf(current?.startMinute ?? 540));
  const [end, setEnd] = useState(timeOf(current?.endMinute ?? 1140));
  const [breakText, setBreakText] = useState(String(current?.breakMinutes ?? 60));
  const [offs, setOffs] = useState<number[]>(current?.weeklyOffs ?? [0]);
  const [from, setFrom] = useState(today);
  const startMinute = minuteOf(start);
  const endMinute = minuteOf(end);
  const breakMinutes = Number(breakText);
  const backwards = startMinute !== null && endMinute !== null && endMinute <= startMinute;
  const breakFine = Number.isInteger(breakMinutes) && breakMinutes >= 0 && breakMinutes <= 300;
  const fine =
    startMinute !== null && endMinute !== null && !backwards && breakFine && from >= today;
  const save = useAction(async () => {
    await api(`/admin/staff/${enc(userId)}/schedule`, 'PUT', {
      effectiveFrom: from,
      startMinute,
      endMinute,
      breakMinutes,
      weeklyOffs: offs,
    });
    notice(t('owner.shift.saved', { day: dayLabel(from, language) }));
  }, [['staff-hours', userId]]);
  return (
    <form
      className={css.stack}
      onSubmit={(event) => {
        event.preventDefault();
        if (fine) save.mutate(undefined);
      }}
    >
      <h3>{t('owner.shift.title')}</h3>
      {current ? (
        <p className={css.hint}>
          {t('owner.shift.current', {
            start: timeOf(current.startMinute),
            end: timeOf(current.endMinute),
            day: dayLabel(current.effectiveFrom, language),
          })}
        </p>
      ) : (
        <p className={css.hint}>{t('owner.shift.none')}</p>
      )}
      <div className={own.timePair}>
        <Field label={t('owner.shift.start')}>
          <input
            type="time"
            required
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </Field>
        <Field label={t('owner.shift.end')}>
          <input
            type="time"
            required
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </Field>
      </div>
      <Field label={t('owner.shift.break')}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={300}
          required
          value={breakText}
          onChange={(event) => setBreakText(event.target.value)}
        />
      </Field>
      <fieldset className={css.formFieldset}>
        <legend>{t('owner.shift.offs')}</legend>
        <div className={own.dayChecks}>
          {[0, 1, 2, 3, 4, 5, 6].map((day) => (
            <label className={css.check} key={day}>
              <input
                type="checkbox"
                checked={offs.includes(day)}
                onChange={() =>
                  setOffs(offs.includes(day) ? offs.filter((off) => off !== day) : [...offs, day])
                }
              />
              {weekdayLabel(sunday(day), language)}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label={t('owner.shift.from')}>
        <input
          type="date"
          min={today}
          required
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </Field>
      <p className={css.hint}>{t('owner.shift.newRow')}</p>
      {current?.effectiveFrom === from && (
        <p className={own.lookBlock} role="status">
          {t('owner.shift.sameDay')}
        </p>
      )}
      {backwards && (
        <p className={own.lookBlock} role="status">
          {t('owner.shift.backwards')}
        </p>
      )}
      <Problem error={save.error} />
      <Button className={css.wide} disabled={save.isPending || !fine}>
        {t('owner.shift.save')}
      </Button>
    </form>
  );
}

/** Someone with no phone, or one that cannot run the app. A manager marks them by hand instead. */
function NoPhoneSwitch({ userId, name }: { userId: string; name: string }) {
  const t = useT();
  const { notice } = useOwner();
  const phones = useQuery({
    queryKey: [...hazriKey, 'phones'],
    queryFn: () => api<{ items: StaffPhone[] }>('/admin/staff-phones'),
  });
  const set = useAction(
    async (noPhone: boolean) => {
      await api(`/admin/staff/${enc(userId)}/no-phone`, 'PUT', { noPhone });
      notice(t(noPhone ? 'owner.shift.noPhoneOn' : 'owner.shift.noPhoneOff', { name }));
    },
    [hazriKey],
  );
  const person = phones.data?.items.find((row) => row.id === userId);
  return (
    <div>
      <QueryStatus query={phones} />
      {phones.data && (
        <label className={css.check}>
          <input
            type="checkbox"
            checked={person?.noPhone ?? false}
            disabled={set.isPending}
            onChange={(event) => set.mutate(event.target.checked)}
          />
          {t('owner.shift.noPhone')}
        </label>
      )}
      <Problem error={set.error} />
    </div>
  );
}

/** A person's shift and phone. A new shift is a new row with a date, so old months still add up. */
export function StaffHours({
  person,
  close,
}: {
  person: { id: string; name: string };
  close: () => void;
}) {
  const t = useT();
  const schedule = useQuery({
    queryKey: ['staff-hours', person.id],
    queryFn: () => api<{ schedule: Schedule | null }>(`/admin/staff/${enc(person.id)}/schedule`),
  });
  return (
    <Sheet
      title={t('owner.shift.sheet', { name: person.name })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={css.stack}>
        {schedule.isPending && <Skeleton label={t('owner.loading')} />}
        <Problem error={schedule.error} />
        {schedule.data && (
          <ScheduleForm
            key={schedule.data.schedule?.effectiveFrom ?? 'new'}
            userId={person.id}
            current={schedule.data.schedule}
          />
        )}
        <NoPhoneSwitch userId={person.id} name={person.name} />
      </div>
    </Sheet>
  );
}
