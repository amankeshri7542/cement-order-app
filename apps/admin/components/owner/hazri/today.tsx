'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Sheet, Skeleton } from '@shiv/design';
import { dayLabel, istToday, timeLabel } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../../lib/api';
import { useLanguage, useT } from '../../../lib/i18n';
import { useAction, useOwner, type Shop } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import css from '../owner.module.css';
import { HazriStatus, ShowHere } from './common';
import own from './hazri.module.css';
import type { DayEventRow, PersonDayData, Proof, Roster, RosterRow } from './types';
import {
  correctionProblem,
  dayBounds,
  eventKey,
  flagKey,
  hoursOf,
  minuteOf,
  reasonLines,
  stamp,
  takenAt,
  timeOf,
  wasOffline,
} from './words';

export const hazriKey = ['hazri'];

type OpenPerson = { row: RosterRow; shopId: string };
const present = (row: RosterRow) => !!row.firstInAt;

/** A clock time on the record, or a dash when there is none. */
const clock = (value: string | null) => (value ? timeLabel(value) : '-');

export function HazriToday({ shops }: { shops: Shop[] }) {
  const t = useT();
  const today = istToday();
  const [day, setDay] = useState(today);
  const [person, setPerson] = useState<OpenPerson | null>(null);
  return (
    <div className={css.stack}>
      <Field label={t('owner.hazri.day')}>
        <input
          type="date"
          max={today}
          value={day}
          onChange={(event) => setDay(event.target.value || today)}
        />
      </Field>
      {shops.map((shop) => (
        <ShopRoster
          key={shop.id}
          shop={shop}
          day={day}
          named={shops.length > 1}
          open={(row) => setPerson({ row, shopId: shop.id })}
        />
      ))}
      {person && <PersonDay open={person} day={day} close={() => setPerson(null)} />}
    </div>
  );
}

function ShopRoster({
  shop,
  day,
  named,
  open,
}: {
  shop: Shop;
  day: string;
  named: boolean;
  open: (row: RosterRow) => void;
}) {
  const t = useT();
  const { me, can } = useOwner();
  const isToday = day === istToday();
  const roster = useQuery({
    queryKey: [...hazriKey, 'day', shop.id, day],
    queryFn: () =>
      api<Roster>(
        `/admin/attendance/day?locationId=${encodeURIComponent(shop.id)}&day=${encodeURIComponent(day)}`,
      ),
    refetchInterval: isToday ? 30000 : false,
  });
  const [marking, setMarking] = useState<RosterRow | null>(null);
  const [showing, setShowing] = useState(false);
  const rows = roster.data?.items ?? [];
  const here = rows.filter(present).length;
  const absent = rows.filter((row) => row.status === 'ABSENT').length;
  const looking = rows.filter(
    (row) => row.status === 'REVIEW' || row.flags.includes('REVIEW_OPEN'),
  ).length;
  const mayMark = isToday && can('attendance.mark', shop.id);
  return (
    <section className={css.card} aria-label={shop.name}>
      {named && <h2>{shop.name}</h2>}
      <QueryStatus query={roster} />
      {roster.data && !rows.length && <EmptyState title={t('owner.hazri.today.empty')} />}
      {!!rows.length && (
        <>
          <dl className={own.counts}>
            <div>
              <dt>{t('owner.hazri.today.came')}</dt>
              <dd>{here}</dd>
            </div>
            <div>
              <dt>{t('owner.hazri.today.notCome')}</dt>
              <dd>{absent}</dd>
            </div>
            <div>
              <dt>{t('owner.hazri.today.toLook')}</dt>
              <dd>{looking}</dd>
            </div>
          </dl>
          <div className={own.peopleHead} aria-hidden="true">
            <div className={own.headMain}>
              <span className={own.personName}>{t('owner.hazri.today.name')}</span>
              <span className={own.facts}>
                <span>{t('owner.hazri.today.in')}</span>
                <span>{t('owner.hazri.today.out')}</span>
                <span>{t('owner.hazri.today.hours')}</span>
              </span>
              <span className={own.personState}>{t('owner.hazri.today.state')}</span>
            </div>
          </div>
          <ul className={own.people}>
            {rows.map((row) => (
              <RosterLine
                key={row.userId}
                row={row}
                isToday={isToday}
                open={() => open(row)}
                mark={mayMark && row.userId !== me.id ? () => setMarking(row) : null}
              />
            ))}
          </ul>
        </>
      )}
      {isToday && can('attendance.mark', shop.id) && (
        <div className={css.actions}>
          <Button variant="secondary" onClick={() => setShowing(true)}>
            {t('owner.hazri.here.button')}
          </Button>
        </div>
      )}
      {marking && <HandMark row={marking} shopId={shop.id} close={() => setMarking(null)} />}
      {showing && (
        <ShowHere locationId={shop.id} shopName={shop.name} close={() => setShowing(false)} />
      )}
    </section>
  );
}

function RosterLine({
  row,
  isToday,
  open,
  mark,
}: {
  row: RosterRow;
  isToday: boolean;
  open: () => void;
  mark: (() => void) | null;
}) {
  const t = useT();
  const notes = row.flags
    .map((flag) => flagKey(flag, isToday))
    .filter((key): key is MessageKey => !!key);
  return (
    <li className={own.person}>
      <button type="button" className={own.personMain} onClick={open}>
        <span className={own.personName}>
          <strong>{row.name}</strong>
          <span className={css.hint}>
            {t(`owner.role.${row.role}` as MessageKey)}
            {row.noPhone && ` · ${t('owner.hazri.today.noPhone')}`}
            {!row.noPhone && !row.linked && ` · ${t('owner.hazri.today.notLinked')}`}
          </span>
        </span>
        <span className={own.facts}>
          <span>
            <span className={own.factLabel}>{t('owner.hazri.today.in')}</span>
            {clock(row.firstInAt)}
          </span>
          <span>
            <span className={own.factLabel}>{t('owner.hazri.today.out')}</span>
            {clock(row.lastOutAt)}
          </span>
          <span>
            <span className={own.factLabel}>{t('owner.hazri.today.hours')}</span>
            {row.minutes === null ? '-' : t('owner.hazri.hoursValue', hoursOf(row.minutes))}
          </span>
        </span>
        <span className={own.personState}>
          <HazriStatus status={row.status} />
        </span>
        {(row.lateMinutes > 0 || notes.length > 0) && (
          <span className={own.notes}>
            {row.lateMinutes > 0 && (
              <span>{t('owner.hazri.late', { minutes: row.lateMinutes })}</span>
            )}
            {notes.map((key) => (
              <span key={key}>{t(key)}</span>
            ))}
          </span>
        )}
      </button>
      {mark && (
        <Button
          variant="secondary"
          className={own.markButton}
          aria-label={t('owner.hazri.mark.for', { name: row.name })}
          onClick={mark}
        >
          {t(row.firstInAt && !row.lastOutAt ? 'owner.hazri.mark.out' : 'owner.hazri.mark.in')}
        </Button>
      )}
    </li>
  );
}

/** For someone with no phone or a broken one. Only at the time now: there is no time to choose. */
function HandMark({ row, shopId, close }: { row: RosterRow; shopId: string; close: () => void }) {
  const t = useT();
  const { notice } = useOwner();
  const kind = row.firstInAt && !row.lastOutAt ? 'MANUAL_OUT' : 'MANUAL_IN';
  const [note, setNote] = useState('');
  // The same key for every try, so a tap twice or a lost answer marks once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const mark = useAction(async () => {
    const done = await api<{ already?: boolean; serverAt: string }>(
      '/admin/attendance/manual',
      'POST',
      {
        userId: row.userId,
        kind,
        locationId: shopId,
        note: note.trim(),
        idempotencyKey,
      },
    );
    notice(
      t(done.already ? 'owner.hazri.mark.already' : 'owner.hazri.mark.done', {
        name: row.name,
        time: timeLabel(done.serverAt),
      }),
    );
    close();
  }, [hazriKey]);
  return (
    <Sheet
      title={t(kind === 'MANUAL_OUT' ? 'owner.hazri.mark.titleOut' : 'owner.hazri.mark.titleIn', {
        name: row.name,
      })}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!mark.isPending) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          mark.mutate(undefined);
        }}
      >
        <p>{t('owner.hazri.mark.body')}</p>
        <Field label={t('owner.hazri.mark.why')}>
          <input
            required
            minLength={2}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Problem error={mark.error} />
        <Button className={css.wide} disabled={mark.isPending}>
          {t(kind === 'MANUAL_OUT' ? 'owner.hazri.mark.out' : 'owner.hazri.mark.in')}
        </Button>
      </form>
    </Sheet>
  );
}

function EventLine({ event }: { event: DayEventRow }) {
  const t = useT();
  const { language } = useLanguage();
  const offline = wasOffline(event.claimedAgeMs);
  const taken = takenAt(event.serverAt, event.claimedAgeMs);
  const lines = reasonLines(
    { ...event, qrShownAt: null, reasons: event.reasons.filter((code) => code !== 'OFFLINE') },
    language,
  ).filter(({ key }) => key !== 'owner.hazri.why.other');
  return (
    <li className={own.event}>
      <span className={own.eventTime}>{timeLabel(event.serverAt)}</span>
      <div>
        <strong>{t(eventKey[event.kind] ?? 'owner.hazri.event.other')}</strong>
        {event.shopName && <span className={css.hint}> · {event.shopName}</span>}
        {offline && (
          <p className={css.hint}>
            {t('owner.hazri.person.bothTimes', {
              taken: stamp(taken, event.serverAt, language),
              server: stamp(event.serverAt, taken, language),
            })}
          </p>
        )}
        {event.result === 'RETRY' && <p className={css.hint}>{t('owner.hazri.person.retry')}</p>}
        {event.result !== 'RETRY' &&
          lines.map(({ key, params }) => (
            <p className={css.hint} key={key}>
              {t(key, params)}
            </p>
          ))}
        {event.kind === 'CORRECTION' && event.correctedAt && (
          <p className={css.hint}>
            {t(
              event.correctsKind === 'OUT'
                ? 'owner.hazri.person.correctedOut'
                : 'owner.hazri.person.correctedIn',
              { time: timeLabel(event.correctedAt), name: event.actorName },
            )}
          </p>
        )}
        {event.kind === 'DECISION' && (
          <p className={css.hint}>
            {t(
              event.reasons.includes('ACCEPTED')
                ? 'owner.hazri.person.acceptedBy'
                : 'owner.hazri.person.rejectedBy',
              { name: event.actorName },
            )}
          </p>
        )}
        {event.byHand && event.kind.startsWith('MANUAL') && (
          <p className={css.hint}>{t('owner.hazri.person.markedBy', { name: event.actorName })}</p>
        )}
        {/* What someone typed stays plain text. */}
        {event.reason && (
          <p className={css.hint}>{t('owner.hazri.person.note', { note: event.reason })}</p>
        )}
        {event.review && (
          <p className={css.hint}>
            {t(`owner.hazri.person.review.${event.review.status}` as MessageKey)}
            {event.review.note && ` · ${event.review.note}`}
          </p>
        )}
      </div>
    </li>
  );
}

/** One person's whole day: every row, who did what, and a correction that never overwrites. */
export function PersonDay({
  open,
  day,
  close,
}: {
  open: OpenPerson;
  day: string;
  close: () => void;
}) {
  const t = useT();
  const { language } = useLanguage();
  const { me, can } = useOwner();
  const { row, shopId } = open;
  const record = useQuery({
    queryKey: [...hazriKey, 'person', row.userId, day],
    queryFn: () =>
      api<PersonDayData>(
        `/admin/attendance/person/${encodeURIComponent(row.userId)}/${encodeURIComponent(day)}`,
      ),
  });
  const mayFix = can('attendance.correct', shopId) && row.userId !== me.id;
  return (
    <Sheet
      title={t('owner.hazri.person.title', { name: row.name, day: dayLabel(day, language) })}
      closeLabel={t('owner.close')}
      onClose={close}
    >
      <div className={css.stack}>
        <QueryStatus query={record} />
        {record.data && !record.data.events.length && <p>{t('owner.hazri.person.empty')}</p>}
        {!!record.data?.events.length && (
          <ol className={own.events}>
            {record.data.events.map((event) => (
              <EventLine key={event.id} event={event} />
            ))}
          </ol>
        )}
        {mayFix && record.data && (
          <CorrectionForm row={row} day={day} events={record.data.events} />
        )}
        {can('attendance.proof.read') && <ProofBlock userId={row.userId} day={day} />}
      </div>
    </Sheet>
  );
}

/** A mistake gets a correction beside it. The old time stays, and tonight's summary names it. */
function CorrectionForm({
  row,
  day,
  events,
}: {
  row: RosterRow;
  day: string;
  events: DayEventRow[];
}) {
  const t = useT();
  const { notice } = useOwner();
  const [corrects, setCorrects] = useState<'IN' | 'OUT'>('IN');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const minute = minuteOf(time);
  const problem = time
    ? correctionProblem({
        corrects,
        minute,
        day,
        now: new Date(),
        ...dayBounds(events),
      })
    : null;
  const save = useAction(async () => {
    await api('/admin/attendance/corrections', 'POST', {
      userId: row.userId,
      day,
      corrects,
      minute,
      reason: reason.trim(),
      idempotencyKey: fresh,
    });
    notice(t('owner.hazri.fix.done', { name: row.name, time: timeOf(minute ?? 0) }));
    setTime('');
    setReason('');
    setFresh(crypto.randomUUID());
  }, [hazriKey]);
  return (
    <form
      className={own.fixForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (minute !== null && !problem) save.mutate(undefined);
      }}
    >
      <h3>{t('owner.hazri.fix.title')}</h3>
      <p className={css.hint}>{t('owner.hazri.fix.body')}</p>
      <Field label={t('owner.hazri.fix.which')}>
        <select
          value={corrects}
          onChange={(event) => setCorrects(event.target.value as 'IN' | 'OUT')}
        >
          <option value="IN">{t('owner.hazri.today.in')}</option>
          <option value="OUT">{t('owner.hazri.today.out')}</option>
        </select>
      </Field>
      <Field label={t('owner.hazri.fix.time')}>
        <input
          type="time"
          required
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
      </Field>
      <Field label={t('owner.hazri.fix.reason')}>
        <input
          required
          minLength={2}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {problem && (
        <p className={own.lookBlock} role="status">
          {t(problem)}
        </p>
      )}
      <Problem error={save.error} />
      <Button
        variant="secondary"
        className={css.wide}
        disabled={save.isPending || !!problem || minute === null}
      >
        {t('owner.hazri.fix.save')}
      </Button>
    </form>
  );
}

/** Owners only. Plain about what it can show and what it cannot. */
function ProofBlock({ userId, day }: { userId: string; day: string }) {
  const t = useT();
  const proof = useQuery({
    queryKey: [...hazriKey, 'proof', userId, day],
    queryFn: () =>
      api<Proof>(
        `/admin/attendance/proof/${encodeURIComponent(userId)}/${encodeURIComponent(day)}`,
      ),
  });
  if (proof.isPending) return <Skeleton label={t('owner.loading')} />;
  if (proof.error)
    return (
      <p className={css.hint} role="status">
        {t(
          proof.error instanceof ApiError && proof.error.code === 'FORBIDDEN'
            ? 'owner.hazri.proof.notYours'
            : 'owner.hazri.proof.cantRead',
        )}
      </p>
    );
  return (
    <section className={own.proof} aria-label={t('owner.hazri.proof.title')}>
      <h3>{t('owner.hazri.proof.title')}</h3>
      <p className={proof.data.chainOk ? own.toneOk : own.lookBlock}>
        {proof.data.chainOk
          ? t('owner.hazri.proof.ok')
          : t('owner.hazri.proof.broken', { seq: proof.data.brokenAtSeq ?? '' })}
      </p>
      <p>
        {proof.data.nightCode
          ? t('owner.hazri.proof.code', { code: proof.data.nightCode })
          : t('owner.hazri.proof.noCode')}
      </p>
      <p className={css.hint}>{t('owner.hazri.proof.means')}</p>
    </section>
  );
}

/** A way to the cards, from wherever the count is shown. */
export function ReviewsLink({ count }: { count: number }) {
  const t = useT();
  if (!count) return null;
  return (
    <Link href="/hazri?tab=reviews" className={`${css.card} ${css.cardLink}`}>
      {t('owner.hazri.toLookLink', { count })} <span aria-hidden="true">→</span>
    </Link>
  );
}
