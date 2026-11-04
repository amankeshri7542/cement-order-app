'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, PhoneField, StatusPill } from '@shiv/design';
import { momentLabel, waReviews } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { MoreRows, PageHeader, Problem, QueryStatus, usePaged } from './common';
import css from './owner.module.css';

type Reading = {
  intent: string;
  lines: {
    rawText: string;
    productName: string | null;
    quantity: number | null;
    unitWord: string | null;
  }[];
  placeText: string;
  deliveryDate: string | null;
  timeWish: string;
  forWhom: string;
};
type Row = {
  id: string;
  threadId: string;
  createdAt: string;
  contact: { masked: string; savedName: string; profileName: string };
  words: string;
  reader: string;
  band: string | null;
  errorCode: string | null;
  reading: Reading | null;
  wouldReplyWords: string[];
  review: string | null;
};
type Health = {
  mode: string;
  partner: string | null;
  paused: boolean;
  lastWebhookAt: string | null;
  lastAccount: string;
  today: { inbound: number; gated: number; byRules: number; byModel: number; noAnswer: number };
  numbersOff: number;
  monthSpentMicroUsd: number;
  monthCapMicroUsd: number;
};
type Gate = {
  reviewed: number;
  intentPercent: number | null;
  greenPercent: number | null;
  allBandsPercent: number | null;
  repliesToPersonal: number;
  silentMissPercent: number | null;
  passed: boolean;
  target: {
    reviewed: number;
    intentPercent: number;
    greenPercent: number;
    allBandsPercent: number;
    silentMissPercent: number;
  };
};
type NumberRow = {
  id: string;
  masked: string;
  savedName: string;
  profileName: string;
  aiMode: string;
};

const healthKey = ['wa', 'health'];
const gateKey = ['wa', 'gate'];
const readingsKey = ['wa', 'readings'];
const numbersKey = ['wa', 'numbers'];

/** Understood goods, place and day, in the words a person would use. */
function Understood({ reading }: { reading: Reading }) {
  const t = useT();
  return (
    <ul className={css.waLines}>
      <li>{t(`owner.wa.intent.${reading.intent}` as MessageKey)}</li>
      {reading.lines.map((line, index) => (
        <li key={index}>
          {line.quantity ?? '?'} {line.unitWord ?? ''} {line.productName ?? `"${line.rawText}"`}
        </li>
      ))}
      {reading.placeText && <li>{t('owner.wa.place', { place: reading.placeText })}</li>}
      {reading.deliveryDate && <li>{t('owner.wa.day', { day: reading.deliveryDate })}</li>}
      {reading.timeWish && <li>{t('owner.wa.timeWish', { time: reading.timeWish })}</li>}
      {reading.forWhom && <li>{t('owner.wa.forWhom', { name: reading.forWhom })}</li>}
    </ul>
  );
}
function BandPill({ band }: { band: string | null }) {
  const t = useT();
  if (!band) return null;
  const tone = band === 'GREEN' ? 'green' : band === 'RED' ? 'red' : 'blue';
  return <StatusPill tone={tone} label={t(`owner.wa.band.${band}` as MessageKey)} />;
}
function WouldSay({ words }: { words: string[] }) {
  const t = useT();
  return (
    <div>
      <h4>{t('owner.wa.wouldSay')}</h4>
      {words.length ? (
        words.map((line, index) => <p key={index}>{line}</p>)
      ) : (
        <p>{t('owner.wa.wouldStaySilent')}</p>
      )}
    </div>
  );
}

function HealthCard() {
  const t = useT();
  const { language } = useLanguage();
  const { can } = useOwner();
  const health = useQuery({
    queryKey: healthKey,
    queryFn: () => api<Health>('/admin/wa/health'),
  });
  const pause = useAction(
    (paused: boolean) => api('/admin/wa/pause', 'POST', { paused }),
    [healthKey],
  );
  const data = health.data;
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.connection')}</h3>
      <QueryStatus query={health} />
      {data && (
        <>
          <p>{t(data.mode === 'off' ? 'owner.wa.modeOff' : 'owner.wa.modeShadow')}</p>
          {data.partner && <p>{t('owner.wa.partner', { name: data.partner })}</p>}
          {data.paused && (
            <p>
              <StatusPill tone="red" label={t('owner.wa.paused')} />
            </p>
          )}
          {data.lastWebhookAt && (
            <p>
              {t('owner.wa.lastMessage')} {momentLabel(data.lastWebhookAt, language)}
            </p>
          )}
          <p>
            {t('owner.wa.todayCounts', {
              inbound: data.today.inbound,
              gated: data.today.gated,
              rules: data.today.byRules,
              model: data.today.byModel,
              none: data.today.noAnswer,
            })}
          </p>
          <p>
            {t('owner.wa.monthSpend', {
              spent: (data.monthSpentMicroUsd / 1_000_000).toFixed(2),
              cap: (data.monthCapMicroUsd / 1_000_000).toFixed(2),
            })}
          </p>
          {can('wa.ai.control') && (
            <Button
              variant="secondary"
              disabled={pause.isPending}
              onClick={() => pause.mutate(!data.paused)}
            >
              {t(data.paused ? 'owner.wa.resume' : 'owner.wa.pause')}
            </Button>
          )}
          <Problem error={pause.error} />
        </>
      )}
    </section>
  );
}

function GateCard() {
  const t = useT();
  const gate = useQuery({ queryKey: gateKey, queryFn: () => api<Gate>('/admin/wa/gate') });
  const data = gate.data;
  const shown = (value: number | null) => (value === null ? '-' : `${value}%`);
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.gate')}</h3>
      <QueryStatus query={gate} />
      {data && (
        <>
          <p>
            <StatusPill
              tone={data.passed ? 'green' : 'neutral'}
              label={t(data.passed ? 'owner.wa.gatePassed' : 'owner.wa.gateNotYet')}
            />
          </p>
          <ul className={css.waLines}>
            <li>
              {t('owner.wa.gateReviewed', { count: data.reviewed, target: data.target.reviewed })}
            </li>
            <li>
              {t('owner.wa.gateIntent', {
                now: shown(data.intentPercent),
                target: data.target.intentPercent,
              })}
            </li>
            <li>
              {t('owner.wa.gateGreen', {
                now: shown(data.greenPercent),
                target: data.target.greenPercent,
              })}
            </li>
            <li>
              {t('owner.wa.gateAll', {
                now: shown(data.allBandsPercent),
                target: data.target.allBandsPercent,
              })}
            </li>
            <li>
              {t('owner.wa.gateMissed', {
                now: shown(data.silentMissPercent),
                target: data.target.silentMissPercent,
              })}
            </li>
            <li>{t('owner.wa.gatePersonal', { count: data.repliesToPersonal })}</li>
          </ul>
        </>
      )}
    </section>
  );
}

function TryBox() {
  const t = useT();
  const [text, setText] = useState('');
  const attempt = useAction((words: string) =>
    api<{ errorCode: string | null; reading: Reading | null; wouldReplyWords: string[] }>(
      '/admin/wa/try',
      'POST',
      { text: words },
    ),
  );
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.try')}</h3>
      <p>{t('owner.wa.tryHelp')}</p>
      <Field label={t('owner.wa.tryLabel')}>
        <textarea
          value={text}
          maxLength={2000}
          rows={3}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div className={css.actions}>
        <Button disabled={!text.trim() || attempt.isPending} onClick={() => attempt.mutate(text)}>
          {t('owner.wa.tryGo')}
        </Button>
      </div>
      <Problem error={attempt.error} />
      {attempt.data && (
        <div className={css.waCard}>
          {attempt.data.reading ? (
            <Understood reading={attempt.data.reading} />
          ) : (
            <p>{t('owner.wa.noReading')}</p>
          )}
          <WouldSay words={attempt.data.wouldReplyWords} />
        </div>
      )}
    </section>
  );
}

function ReadingCard({ row }: { row: Row }) {
  const t = useT();
  const { language } = useLanguage();
  const { can } = useOwner();
  const mark = useAction(
    (review: string) => api(`/admin/wa/runs/${row.id}/review`, 'POST', { review }),
    [readingsKey, gateKey],
  );
  const stop = useAction(
    () => api(`/admin/wa/threads/${row.threadId}`, 'PATCH', { aiMode: 'OFF' }),
    [readingsKey, numbersKey, healthKey],
  );
  return (
    <article className={`${css.card} ${css.waCard}`}>
      <div className={css.row}>
        <strong>{row.contact.savedName || row.contact.masked}</strong>
        <BandPill band={row.band} />
      </div>
      {row.contact.profileName && (
        <p>{t('owner.wa.profileName', { name: row.contact.profileName })}</p>
      )}
      <p>{momentLabel(row.createdAt, language)}</p>
      <h4>{t('owner.wa.theyWrote')}</h4>
      <p className={css.waWords}>{row.words || t('owner.wa.wordsGone')}</p>
      <h4>{t('owner.wa.understood')}</h4>
      {row.reading ? <Understood reading={row.reading} /> : <p>{t('owner.wa.noReading')}</p>}
      <WouldSay words={row.wouldReplyWords} />
      <div className={css.chips}>
        {waReviews.map((review) => (
          <Button
            key={review}
            variant={row.review === review ? 'primary' : 'secondary'}
            disabled={mark.isPending}
            onClick={() => mark.mutate(review)}
          >
            {t(`owner.wa.review.${review}` as MessageKey)}
          </Button>
        ))}
      </div>
      {can('wa.ai.control') && (
        <Button
          variant="secondary"
          disabled={stop.isPending}
          onClick={() => stop.mutate(undefined)}
        >
          {t('owner.wa.markOff')}
        </Button>
      )}
      <Problem error={mark.error ?? stop.error} />
    </article>
  );
}

function Readings() {
  const t = useT();
  const [filter, setFilter] = useState<'unreviewed' | 'all'>('unreviewed');
  const readings = usePaged<Row>([...readingsKey, filter], `/admin/wa/readings?filter=${filter}`);
  const rows = readings.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className={css.stack}>
      <div className={css.row}>
        <h3>{t('owner.wa.readings')}</h3>
        <Button
          variant="secondary"
          onClick={() => setFilter(filter === 'all' ? 'unreviewed' : 'all')}
        >
          {t(filter === 'all' ? 'owner.wa.showToCheck' : 'owner.wa.showAll')}
        </Button>
      </div>
      <QueryStatus query={readings} />
      {rows.map((row) => (
        <ReadingCard key={row.id} row={row} />
      ))}
      {readings.data && !rows.length && <EmptyState title={t('owner.wa.nothingToCheck')} />}
      <MoreRows query={readings} />
    </section>
  );
}

function Numbers() {
  const t = useT();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const numbers = useQuery({
    queryKey: numbersKey,
    queryFn: () => api<{ items: NumberRow[] }>('/admin/wa/threads?filter=off'),
  });
  const mark = useAction(
    () =>
      api('/admin/wa/threads', 'POST', {
        phone: `+91${phone}`,
        ...(name.trim() ? { savedName: name.trim() } : {}),
      }),
    [numbersKey, healthKey],
  );
  const back = useAction(
    (id: string) => api(`/admin/wa/threads/${id}`, 'PATCH', { aiMode: 'AUTO' }),
    [numbersKey, healthKey],
  );
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.numbers')}</h3>
      <p>{t('owner.wa.numbersHelp')}</p>
      <PhoneField label={t('owner.wa.phone')} value={phone} onChange={setPhone} />
      <Field label={t('owner.wa.nameOptional')}>
        <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className={css.actions}>
        <Button
          disabled={phone.length !== 10 || mark.isPending}
          onClick={() =>
            mark.mutate(undefined, {
              onSuccess: () => {
                setPhone('');
                setName('');
              },
            })
          }
        >
          {t('owner.wa.markOff')}
        </Button>
      </div>
      <Problem error={mark.error ?? back.error} />
      <QueryStatus query={numbers} />
      {numbers.data?.items.map((row) => (
        <div className={css.row} key={row.id}>
          <span>
            {row.savedName || row.masked}
            {row.aiMode === 'OPTED_OUT' ? ` · ${t('owner.wa.wroteStop')}` : ''}
          </span>
          <Button variant="secondary" disabled={back.isPending} onClick={() => back.mutate(row.id)}>
            {t('owner.wa.readAgain')}
          </Button>
        </div>
      ))}
    </section>
  );
}

/** Chats the owner answered himself where no order was read: the reader may have missed one. */
function Replied() {
  const t = useT();
  const replied = useQuery({
    queryKey: ['wa', 'replied'],
    queryFn: () => api<{ items: NumberRow[] }>('/admin/wa/threads?filter=replied'),
  });
  const missed = useAction(
    (id: string) => api(`/admin/wa/threads/${id}/missed`, 'POST', {}),
    [gateKey],
  );
  if (!replied.data?.items.length) return null;
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.replied')}</h3>
      <p>{t('owner.wa.repliedHelp')}</p>
      {replied.data.items.map((row) => (
        <div className={css.row} key={row.id}>
          <span>{row.savedName || row.masked}</span>
          <Button
            variant="secondary"
            disabled={missed.isPending}
            onClick={() => missed.mutate(row.id)}
          >
            {t('owner.wa.wasAnOrder')}
          </Button>
        </div>
      ))}
      <Problem error={missed.error} />
    </section>
  );
}

/** The silent stage: see what the reader understood, mark it, and keep family numbers out. */
export function WhatsAppReading() {
  const t = useT();
  const { can } = useOwner();
  return (
    <div className={css.stack}>
      <section className={css.card}>
        <p>{t('owner.wa.intro')}</p>
      </section>
      {can('wa.admin') && <HealthCard />}
      {can('wa.read') && <GateCard />}
      {can('wa.ai.control') && <Numbers />}
      {can('wa.read') && <TryBox />}
      {can('wa.read') && can('wa.ai.control') && <Replied />}
      {can('wa.read') && <Readings />}
    </div>
  );
}

export function WhatsAppPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('owner.whatsappReading')} />
      <WhatsAppReading />
    </>
  );
}
