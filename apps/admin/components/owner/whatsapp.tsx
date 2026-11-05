'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Confirm,
  DateChips,
  EmptyState,
  Field,
  PhoneField,
  StatusPill,
} from '@shiv/design';
import {
  money,
  momentLabel,
  refusalReasons,
  waReviews,
  waTestNumbersMax,
  type RefusalReason,
  type WaPayWhen,
  type WaStage,
} from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { ContactActions, MoreRows, PageHeader, Problem, QueryStatus, usePaged } from './common';
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
  stage: WaStage;
  openDrafts: number;
  repliesToday: { sent: number; failed: number; skipped: number };
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
const replyKey = ['wa', 'reply'];
const draftsKey = ['wa', 'drafts'];
const sizesKey = ['wa', 'sizes'];
const tallyKey = ['wa', 'tally'];

type CardLine = {
  rawText: string;
  productId: string | null;
  productName: string | null;
  quantity: number | null;
  unitWord: string | null;
  loadSizeId?: string | null;
  loadCount?: number | null;
  unit: string | null;
  listPricePaise: number | null;
  priceVersion: number | null;
};
type DraftCard = {
  id: string;
  locationId: string;
  status: string;
  version: number;
  pasted: boolean;
  band: string | null;
  flags: string[];
  words: string | null;
  truncated: boolean;
  createdAt: string;
  lines: CardLine[];
  placeText: string;
  pincode: string | null;
  fulfilment: 'PICKUP' | 'DELIVERY' | 'UNKNOWN';
  deliveryDate: string | null;
  timeWish: string;
  orderedBy: { name: string; profileName: string; masked: string; phone: string | null };
  payWhen: WaPayWhen;
  payer: { id: string; name: string; masked: string; creditAllowed: boolean } | null;
  payerWords: string;
  paymentWords: string;
  papaRepliedAt: string | null;
  aiOff: boolean;
  readerError: string | null;
  decided: {
    byName: string;
    at: string;
    reason: string | null;
    orderNumber: string | null;
  } | null;
  message: { status: string; reason: string | null; words: string | null } | null;
};
type LoadSize = { id: string; productId: string; label: string; quantity: number };
type ProductChoice = { id: string; name: string };
type ReplyView = {
  stage: WaStage;
  next: WaStage | null;
  readiness: {
    ready: boolean;
    checks: { key: string; ok: boolean }[];
  } | null;
  testNumbers: string[];
  quietMinutes: number;
  nightFromHour: number;
  nightToHour: number;
};
type TallyRow = {
  period: string;
  days: number;
  calls: number | null;
  orders: number | null;
  perTen: number | null;
};
const stageLevels: WaStage[] = ['OFF', 'TEST_NUMBERS', 'KNOWN_CUSTOMERS', 'EVERYONE'];
const payWhens: Exclude<WaPayWhen, 'UNSET'>[] = ['PAID_NOW', 'AT_DELIVERY', 'UDHAAR'];
const newKey = () => crypto.randomUUID();
const digitsOf = (phone: string | null | undefined) => phone?.replace(/^\+91/, '') ?? '';

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
          <p>
            {t(
              data.mode === 'off'
                ? 'owner.wa.modeOff'
                : data.mode === 'reply'
                  ? 'owner.wa.modeReply'
                  : 'owner.wa.modeShadow',
            )}
          </p>
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
            {t('owner.wa.repliesToday', {
              sent: data.repliesToday.sent,
              skipped: data.repliesToday.skipped,
              failed: data.repliesToday.failed,
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

/** Who may hear from the AI. Only an owner sees this, and the server checks every step again. */
function ReplyStageCard() {
  const t = useT();
  const view = useQuery({
    queryKey: replyKey,
    queryFn: () => api<ReplyView>('/admin/wa/reply'),
  });
  const [asking, setAsking] = useState<WaStage | null>(null);
  const [number, setNumber] = useState('');
  const [quiet, setQuiet] = useState<number | null>(null);
  const [nightFrom, setNightFrom] = useState<number | null>(null);
  const [nightTo, setNightTo] = useState<number | null>(null);
  const move = useAction(
    (to: WaStage) => api('/admin/wa/reply/stage', 'POST', { from: view.data!.stage, to }),
    [replyKey, healthKey],
  );
  const change = useAction(
    (body: Record<string, unknown>) => api('/admin/wa/reply/settings', 'PATCH', body),
    [replyKey],
  );
  const data = view.data;
  if (!data) return <QueryStatus query={view} />;
  const level = stageLevels.indexOf(data.stage);
  const below = stageLevels[level - 1];
  const stageName = (stage: WaStage) => t(`owner.wa.stage.${stage}` as MessageKey);
  const quietNow = quiet ?? data.quietMinutes;
  const fromNow = nightFrom ?? data.nightFromHour;
  const toNow = nightTo ?? data.nightToHour;
  const numberReady = number.length === 10 && data.testNumbers.length < waTestNumbersMax;
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.replies')}</h3>
      <p>
        <StatusPill
          tone={data.stage === 'OFF' ? 'neutral' : 'green'}
          label={stageName(data.stage)}
        />
      </p>
      <p>{t(`owner.wa.stageHelp.${data.stage}` as MessageKey)}</p>
      {data.next && data.readiness && (
        <>
          <h4>{t('owner.wa.readiness', { stage: stageName(data.next) })}</h4>
          <ul className={css.waLines}>
            {data.readiness.checks.map((check) => (
              <li key={check.key}>
                {t(check.ok ? 'owner.wa.checkOk' : 'owner.wa.checkNo')}:{' '}
                {t(`owner.wa.check.${check.key}` as MessageKey)}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={css.actions}>
        {data.next && (
          <Button
            disabled={!data.readiness?.ready || move.isPending}
            onClick={() => setAsking(data.next)}
          >
            {t('owner.wa.moveUp', { stage: stageName(data.next) })}
          </Button>
        )}
        {below && (
          <Button variant="secondary" disabled={move.isPending} onClick={() => move.mutate(below)}>
            {t('owner.wa.moveDown', { stage: stageName(below) })}
          </Button>
        )}
        {level > 1 && (
          <Button variant="danger" disabled={move.isPending} onClick={() => move.mutate('OFF')}>
            {t('owner.wa.allOff')}
          </Button>
        )}
      </div>
      <Problem error={move.error} />
      {asking && (
        <Confirm
          title={t('owner.wa.moveUp', { stage: stageName(asking) })}
          body={t(`owner.wa.stageHelp.${asking}` as MessageKey)}
          confirmLabel={t('owner.wa.moveSure')}
          cancelLabel={t('owner.wa.moveCancel')}
          busy={move.isPending}
          onConfirm={() => move.mutate(asking, { onSettled: () => setAsking(null) })}
          onCancel={() => setAsking(null)}
        />
      )}
      <h4>{t('owner.wa.testNumbers', { max: waTestNumbersMax })}</h4>
      <p className={css.hint}>{t('owner.wa.testNumbersHelp')}</p>
      {data.testNumbers.map((phone) => (
        <div className={css.row} key={phone}>
          <span>{phone}</span>
          <Button
            variant="secondary"
            disabled={change.isPending}
            onClick={() =>
              change.mutate({ testNumbers: data.testNumbers.filter((item) => item !== phone) })
            }
          >
            {t('owner.wa.remove')}
          </Button>
        </div>
      ))}
      <PhoneField label={t('owner.wa.testNumberAdd')} value={number} onChange={setNumber} />
      <div className={css.actions}>
        <Button
          variant="secondary"
          disabled={!numberReady || change.isPending}
          onClick={() =>
            change.mutate(
              { testNumbers: [...data.testNumbers, `+91${number}`] },
              { onSuccess: () => setNumber('') },
            )
          }
        >
          {t('owner.wa.add')}
        </Button>
      </div>
      <h4>{t('owner.wa.quietRules')}</h4>
      <Field label={t('owner.wa.quietMinutes')}>
        <input
          type="number"
          inputMode="numeric"
          min={30}
          max={60}
          value={quietNow}
          onChange={(event) => setQuiet(Number(event.target.value))}
        />
      </Field>
      <Field label={t('owner.wa.nightFrom')}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={23}
          value={fromNow}
          onChange={(event) => setNightFrom(Number(event.target.value))}
        />
      </Field>
      <Field label={t('owner.wa.nightTo')}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={23}
          value={toNow}
          onChange={(event) => setNightTo(Number(event.target.value))}
        />
      </Field>
      <div className={css.actions}>
        <Button
          variant="secondary"
          disabled={change.isPending}
          onClick={() =>
            change.mutate({
              quietMinutes: quietNow,
              nightFromHour: fromNow,
              nightToHour: toNow,
            })
          }
        >
          {t('owner.wa.saveRules')}
        </Button>
      </div>
      <Problem error={change.error} />
    </section>
  );
}

/** Anything that arrives another way. It sends nothing, and works with WhatsApp not connected. */
function PasteBox() {
  const t = useT();
  const { shopId } = useOwner();
  const [text, setText] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [key, setKey] = useState(newKey);
  const paste = useAction(
    () =>
      api('/admin/wa/paste', 'POST', {
        text,
        idempotencyKey: key,
        ...(phone.length === 10 ? { phone: `+91${phone}` } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(shopId ? { locationId: shopId } : {}),
      }),
    [draftsKey],
  );
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.paste')}</h3>
      <p>{t('owner.wa.pasteHelp')}</p>
      <Field label={t('owner.wa.pasteLabel')}>
        <textarea
          value={text}
          maxLength={20000}
          rows={4}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <PhoneField label={t('owner.wa.pastePhone')} value={phone} onChange={setPhone} />
      <Field label={t('owner.wa.nameOptional')}>
        <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className={css.actions}>
        <Button
          disabled={!text.trim() || paste.isPending}
          onClick={() =>
            paste.mutate(undefined, {
              onSuccess: () => {
                setText('');
                setPhone('');
                setName('');
                setKey(newKey());
              },
            })
          }
        >
          {t('owner.wa.pasteGo')}
        </Button>
      </div>
      <Problem error={paste.error} />
    </section>
  );
}

type EditLine = {
  rawText: string;
  productId: string | null;
  quantity: number | null;
  unitWord: string | null;
  loadSizeId: string | null;
  loadCount: number;
};
const editable = (card: DraftCard): EditLine[] =>
  card.lines.map((line) => ({
    rawText: line.rawText,
    productId: line.productId,
    quantity: line.quantity,
    unitWord: line.unitWord,
    loadSizeId: line.loadSizeId ?? null,
    loadCount: line.loadCount ?? 1,
  }));

/** One order waiting for a person. Who sent it and who pays are two separate questions. */
function DraftCardView({
  card,
  products,
  sizes,
  papaList,
}: {
  card: DraftCard;
  products: ProductChoice[];
  sizes: LoadSize[];
  papaList: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const { can, notice } = useOwner();
  const [lines, setLines] = useState(() => editable(card));
  const [fulfilment, setFulfilment] = useState(card.fulfilment);
  const [place, setPlace] = useState(card.placeText);
  const [pincode, setPincode] = useState(card.pincode ?? '');
  const [day, setDay] = useState(card.deliveryDate ?? '');
  const [who, setWho] = useState(card.orderedBy.name);
  const [whoPhone, setWhoPhone] = useState(digitsOf(card.orderedBy.phone));
  const [payWhen, setPayWhen] = useState(card.payWhen);
  const [payer, setPayer] = useState('');
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState('');
  const body = {
    expectedVersion: card.version,
    lines: lines.map((line) => ({
      rawText: line.rawText,
      productId: line.productId,
      quantity: line.quantity,
      unitWord: line.unitWord,
      ...(line.loadSizeId ? { loadSizeId: line.loadSizeId, loadCount: line.loadCount } : {}),
    })),
    placeText: place,
    pincode: pincode || null,
    fulfilment,
    deliveryDate: day || null,
    orderedByName: who,
    ...(whoPhone.length === 10 ? { orderedByPhone: `+91${whoPhone}` } : {}),
    payWhen,
    ...(payer.length === 10 ? { payerPhone: `+91${payer}` } : {}),
    // Paid some other way, so it no longer goes on that customer's account.
    ...(payWhen !== 'UDHAAR' && card.payer ? { payerPhone: null } : {}),
  };
  const before = {
    lines: editable(card),
    place: card.placeText,
    pincode: card.pincode ?? '',
    fulfilment: card.fulfilment,
    day: card.deliveryDate ?? '',
    who: card.orderedBy.name,
    whoPhone: digitsOf(card.orderedBy.phone),
    payWhen: card.payWhen,
    payer: '',
  };
  const now = { lines, place, pincode, fulfilment, day, who, whoPhone, payWhen, payer };
  const dirty = JSON.stringify(before) !== JSON.stringify(now);
  const save = () => api<DraftCard>(`/admin/wa/drafts/${card.id}`, 'PATCH', body);
  const saving = useAction(save, [draftsKey]);
  const confirming = useAction(async () => {
    // What is on the screen is what gets confirmed. A stale card is refused by the server.
    const fresh = dirty ? await save() : card;
    return api<{ already: boolean; byName?: string; at?: string; number: string }>(
      `/admin/wa/drafts/${card.id}/confirm`,
      'POST',
      {
        expectedVersion: fresh.version,
        priceVersions: Object.fromEntries(
          fresh.lines.map((line) => [line.productId ?? '', line.priceVersion ?? 0]),
        ),
      },
    );
  }, [draftsKey]);
  const refusal = useAction(
    (reason: RefusalReason) =>
      api(`/admin/wa/drafts/${card.id}/refuse`, 'POST', {
        expectedVersion: card.version,
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    [draftsKey],
  );
  const setLine = (index: number, change: Partial<EditLine>) =>
    setLines((all) => all.map((line, at) => (at === index ? { ...line, ...change } : line)));
  const confirmNow = () =>
    confirming.mutate(undefined, {
      onSuccess: (result) => {
        if (result.already)
          notice(
            t('owner.wa.alreadyDone', {
              name: result.byName ?? '',
              at: result.at ? momentLabel(result.at, language) : '',
            }),
          );
      },
    });
  const canConfirm = can('orders.confirm', card.locationId);
  return (
    <article className={`${css.card} ${css.waCard}`}>
      <div className={css.row}>
        <strong>{card.orderedBy.name || card.orderedBy.masked}</strong>
        <BandPill band={card.band} />
      </div>
      {card.orderedBy.name && <p className={css.hint}>{card.orderedBy.masked}</p>}
      {card.orderedBy.profileName && (
        <p>{t('owner.wa.profileName', { name: card.orderedBy.profileName })}</p>
      )}
      <p>{momentLabel(card.createdAt, language)}</p>
      {card.pasted && <StatusPill tone="blue" label={t('owner.wa.pasted')} />}
      {card.papaRepliedAt && <StatusPill tone="blue" label={t('owner.wa.papaReplied')} />}
      {card.flags.includes('AI_OFF') && <p>{t('owner.wa.aiOffCard')}</p>}
      {card.readerError === 'CAP_REACHED' && <p>{t('owner.wa.capCard')}</p>}
      {card.truncated && <p>{t('owner.wa.truncatedCard')}</p>}
      {card.flags.includes('REVOKED') && <p>{t('owner.wa.revokedCard')}</p>}
      {card.flags.includes('CUSTOMER_CHANGED') && <p>{t('owner.wa.changedCard')}</p>}
      {card.flags.includes('MAYBE_REPEAT') && <p>{t('owner.wa.repeatCard')}</p>}
      {card.flags.includes('CHANGE_ASKED') && <p>{t('owner.wa.changeAskedCard')}</p>}
      {card.flags.includes('CANCEL_ASKED') && <p>{t('owner.wa.cancelAskedCard')}</p>}
      <h4>{t('owner.wa.theyWrote')}</h4>
      <p className={css.waWords}>{card.words || t('owner.wa.wordsGone')}</p>
      {(card.payerWords || card.paymentWords) && (
        <p className={css.waWords}>
          {t('owner.wa.theySaidPay', {
            words: [card.payerWords, card.paymentWords].filter(Boolean).join(', '),
          })}
        </p>
      )}
      {card.timeWish && <p>{t('owner.wa.timeWish', { time: card.timeWish })}</p>}

      <h4>{t('owner.wa.whatTheyWant')}</h4>
      {lines.map((line, index) => {
        const listed = sizes.filter((size) => size.productId === line.productId);
        const shown = card.lines[index];
        return (
          <div className={css.stack} key={index}>
            {line.rawText && <p className={css.hint}>{`"${line.rawText}"`}</p>}
            <Field label={t('owner.wa.product')}>
              <select
                value={line.productId ?? ''}
                onChange={(event) =>
                  setLine(index, { productId: event.target.value || null, loadSizeId: null })
                }
              >
                <option value="">{t('owner.wa.productPick')}</option>
                {[
                  ...products,
                  ...(line.productId && !products.some((item) => item.id === line.productId)
                    ? [{ id: line.productId, name: shown?.productName ?? line.productId }]
                    : []),
                ].map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </Field>
            {listed.length > 0 && (
              <Field label={t('owner.wa.sizePick')}>
                <select
                  value={line.loadSizeId ?? ''}
                  onChange={(event) => {
                    const size = listed.find((item) => item.id === event.target.value);
                    setLine(index, {
                      loadSizeId: size?.id ?? null,
                      ...(size ? { quantity: size.quantity * line.loadCount } : {}),
                    });
                  }}
                >
                  <option value="">{t('owner.wa.sizeNone')}</option>
                  {listed.map((size) => (
                    <option key={size.id} value={size.id}>
                      {`${size.label} (${size.quantity})`}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {line.loadSizeId && (
              <Field label={t('owner.wa.sizeCount')}>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={line.loadCount}
                  onChange={(event) => {
                    const count = Math.max(1, Number(event.target.value) || 1);
                    const size = listed.find((item) => item.id === line.loadSizeId);
                    setLine(index, {
                      loadCount: count,
                      ...(size ? { quantity: size.quantity * count } : {}),
                    });
                  }}
                />
              </Field>
            )}
            <Field label={t('owner.wa.quantity')}>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={10000}
                disabled={Boolean(line.loadSizeId)}
                value={line.quantity ?? ''}
                onChange={(event) =>
                  setLine(index, {
                    quantity: event.target.value ? Number(event.target.value) : null,
                  })
                }
              />
            </Field>
            {line.quantity === null && line.unitWord && (
              <p className={css.hint}>{t('owner.wa.sizeNeeded', { word: line.unitWord })}</p>
            )}
            {shown?.listPricePaise != null && shown.productId === line.productId && (
              <p className={css.hint}>
                {t('owner.wa.listRate', {
                  rate: money(shown.listPricePaise),
                  unit: shown.unit ?? '',
                })}
              </p>
            )}
            <Button
              variant="secondary"
              onClick={() => setLines((all) => all.filter((_, at) => at !== index))}
            >
              {t('owner.wa.removeLine')}
            </Button>
          </div>
        );
      })}
      <div className={css.actions}>
        <Button
          variant="secondary"
          onClick={() =>
            setLines((all) => [
              ...all,
              {
                rawText: '',
                productId: null,
                quantity: null,
                unitWord: null,
                loadSizeId: null,
                loadCount: 1,
              },
            ])
          }
        >
          {t('owner.wa.addLine')}
        </Button>
      </div>

      <h4>{t('owner.wa.howItGoes')}</h4>
      <div className={css.chips}>
        {(['PICKUP', 'DELIVERY'] as const).map((value) => (
          <Button
            key={value}
            variant={fulfilment === value ? 'primary' : 'secondary'}
            aria-pressed={fulfilment === value}
            onClick={() => setFulfilment(value)}
          >
            {t(`owner.wa.fulfil.${value}` as MessageKey)}
          </Button>
        ))}
      </div>
      {fulfilment === 'DELIVERY' && (
        <>
          <Field label={t('owner.wa.placeLabel')}>
            <input
              value={place}
              maxLength={120}
              onChange={(event) => setPlace(event.target.value)}
            />
          </Field>
          <Field label={t('owner.wa.pincode')}>
            <input
              inputMode="numeric"
              maxLength={6}
              value={pincode}
              onChange={(event) => setPincode(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </>
      )}
      <DateChips
        value={day}
        onChange={setDay}
        labels={{
          today: t('owner.wa.dayToday'),
          tomorrow: t('owner.wa.dayTomorrow'),
          dayAfter: t('owner.wa.dayAfter'),
          pick: t('owner.wa.dayPick'),
        }}
      />

      <h4>{t('owner.wa.whoOrdered')}</h4>
      <Field label={t('owner.wa.whoName')}>
        <input value={who} maxLength={60} onChange={(event) => setWho(event.target.value)} />
      </Field>
      <PhoneField label={t('owner.wa.whoPhone')} value={whoPhone} onChange={setWhoPhone} />

      <h4>{t('owner.wa.whoPays')}</h4>
      <div className={css.chips}>
        {payWhens.map((value) => (
          <Button
            key={value}
            variant={payWhen === value ? 'primary' : 'secondary'}
            aria-pressed={payWhen === value}
            onClick={() => setPayWhen(value)}
          >
            {t(`owner.wa.pay.${value}` as MessageKey)}
          </Button>
        ))}
      </div>
      {payWhen === 'UDHAAR' && (
        <>
          {card.payer && (
            <p>
              {t('owner.wa.payerIs', {
                name: card.payer.name || card.payer.masked,
              })}
            </p>
          )}
          <PhoneField label={t('owner.wa.payerPhone')} value={payer} onChange={setPayer} />
        </>
      )}

      <div className={css.actions}>
        {dirty && (
          <Button
            variant="secondary"
            disabled={saving.isPending || confirming.isPending}
            onClick={() => saving.mutate(undefined)}
          >
            {t('owner.wa.saveCard')}
          </Button>
        )}
        {canConfirm && (
          <Button disabled={confirming.isPending || refusal.isPending} onClick={confirmNow}>
            {t(papaList ? 'owner.wa.makeOrder' : 'owner.wa.confirmCard')}
          </Button>
        )}
        {canConfirm && (
          <Button variant="secondary" onClick={() => setRefusing(!refusing)}>
            {t('owner.wa.refuseCard')}
          </Button>
        )}
      </div>
      {refusing && (
        <>
          <Field label={t('owner.wa.refuseNote')}>
            <input value={note} maxLength={120} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <div className={css.chips}>
            {refusalReasons.map((reason) => (
              <Button
                key={reason}
                variant="secondary"
                disabled={refusal.isPending || (reason === 'OTHER' && !note.trim())}
                onClick={() => refusal.mutate(reason)}
              >
                {t(`owner.wa.refuse.${reason}` as MessageKey)}
              </Button>
            ))}
          </div>
        </>
      )}
      <Problem error={saving.error ?? confirming.error ?? refusal.error} />
    </article>
  );
}

/** Decided or gone. If the customer's message did not go, a person can still send it by hand. */
function ClosedCard({ card }: { card: DraftCard }) {
  const t = useT();
  const { language } = useLanguage();
  const notSent =
    card.message && card.message.status !== 'SENT' && card.message.status !== 'QUEUED';
  return (
    <article className={`${css.card} ${css.waCard}`}>
      <div className={css.row}>
        <strong>{card.orderedBy.name || card.orderedBy.masked}</strong>
        <StatusPill tone="neutral" label={t(`owner.wa.closed.${card.status}` as MessageKey)} />
      </div>
      {card.pasted && <StatusPill tone="blue" label={t('owner.wa.pasted')} />}
      {card.decided && (
        <p>
          {t('owner.wa.decidedBy', {
            name: card.decided.byName,
            at: momentLabel(card.decided.at, language),
          })}
          {card.decided.orderNumber ? ` · ${card.decided.orderNumber}` : ''}
        </p>
      )}
      {notSent && (
        <>
          <p role="status">{t('owner.wa.messageNotSent')}</p>
          {card.orderedBy.phone && card.message?.words && (
            <ContactActions phone={card.orderedBy.phone} text={card.message.words} />
          )}
        </>
      )}
    </article>
  );
}

function Cards() {
  const t = useT();
  const { can } = useOwner();
  const [closed, setClosed] = useState(false);
  const papa = usePaged<DraftCard>([...draftsKey, 'papa'], '/admin/wa/drafts?filter=papa');
  const open = usePaged<DraftCard>([...draftsKey, 'open'], '/admin/wa/drafts?filter=open');
  const sizes = useQuery({
    queryKey: sizesKey,
    queryFn: () => api<{ items: LoadSize[] }>('/admin/wa/load-sizes'),
  });
  const products = useQuery({
    queryKey: ['wa', 'products'],
    enabled: can('stock.read'),
    queryFn: () => api<{ items: ProductChoice[] }>('/admin/products?limit=100'),
  });
  const list = (query: typeof open) => query.data?.pages.flatMap((page) => page.items) ?? [];
  const props = { products: products.data?.items ?? [], sizes: sizes.data?.items ?? [] };
  const papaRows = list(papa);
  const openRows = list(open);
  return (
    <section className={css.stack}>
      {papaRows.length > 0 && (
        <>
          <h3>{t('owner.wa.papaList')}</h3>
          <p>{t('owner.wa.papaListHelp')}</p>
          {papaRows.map((card) => (
            <DraftCardView key={`${card.id}:${card.version}`} card={card} papaList {...props} />
          ))}
          <MoreRows query={papa} />
        </>
      )}
      <div className={css.row}>
        <h3>{t('owner.wa.cards')}</h3>
        <Button variant="secondary" onClick={() => setClosed(!closed)}>
          {t(closed ? 'owner.wa.hideClosed' : 'owner.wa.showClosed')}
        </Button>
      </div>
      <QueryStatus query={open} />
      {openRows.map((card) => (
        <DraftCardView key={`${card.id}:${card.version}`} card={card} papaList={false} {...props} />
      ))}
      {open.data && !openRows.length && <EmptyState title={t('owner.wa.noCards')} />}
      <MoreRows query={open} />
      {closed && <ClosedCards />}
    </section>
  );
}
function ClosedCards() {
  const done = usePaged<DraftCard>([...draftsKey, 'closed'], '/admin/wa/drafts?filter=closed');
  return (
    <>
      {done.data?.pages
        .flatMap((page) => page.items)
        .map((card) => (
          <ClosedCard key={card.id} card={card} />
        ))}
      <MoreRows query={done} />
    </>
  );
}

/** The family's list of what each trolley or truck holds. The AI never guesses this. */
function LoadSizes() {
  const t = useT();
  const sizes = useQuery({
    queryKey: sizesKey,
    queryFn: () => api<{ items: LoadSize[] }>('/admin/wa/load-sizes'),
  });
  const products = useQuery({
    queryKey: ['wa', 'products'],
    queryFn: () => api<{ items: ProductChoice[] }>('/admin/products?limit=100'),
  });
  const [productId, setProductId] = useState('');
  const [label, setLabel] = useState('');
  const [quantity, setQuantity] = useState('');
  const add = useAction(
    () =>
      api('/admin/wa/load-sizes', 'POST', {
        productId,
        label: label.trim(),
        quantity: Number(quantity),
      }),
    [sizesKey],
  );
  const remove = useAction(
    (id: string) => api(`/admin/wa/load-sizes/${id}`, 'PATCH', { active: false }),
    [sizesKey],
  );
  const name = (id: string) => products.data?.items.find((item) => item.id === id)?.name ?? id;
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.sizes')}</h3>
      <p>{t('owner.wa.sizesHelp')}</p>
      {sizes.data?.items.map((size) => (
        <div className={css.row} key={size.id}>
          <span>{`${name(size.productId)}: ${size.label} = ${size.quantity}`}</span>
          <Button
            variant="secondary"
            disabled={remove.isPending}
            onClick={() => remove.mutate(size.id)}
          >
            {t('owner.wa.remove')}
          </Button>
        </div>
      ))}
      <Field label={t('owner.wa.product')}>
        <select value={productId} onChange={(event) => setProductId(event.target.value)}>
          <option value="">{t('owner.wa.productPick')}</option>
          {products.data?.items.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('owner.wa.sizeName')}>
        <input value={label} maxLength={40} onChange={(event) => setLabel(event.target.value)} />
      </Field>
      <Field label={t('owner.wa.sizeHolds')}>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>
      <div className={css.actions}>
        <Button
          variant="secondary"
          disabled={!productId || !label.trim() || !(Number(quantity) > 0) || add.isPending}
          onClick={() =>
            add.mutate(undefined, {
              onSuccess: () => {
                setLabel('');
                setQuantity('');
              },
            })
          }
        >
          {t('owner.wa.add')}
        </Button>
      </div>
      <Problem error={add.error ?? remove.error} />
    </section>
  );
}

/** Confirmation calls, from the paper tally: the plan is judged on this falling. */
function Tally() {
  const t = useT();
  const tally = useQuery({
    queryKey: tallyKey,
    queryFn: () => api<{ items: TallyRow[] }>('/admin/wa/tally'),
  });
  return (
    <section className={css.card}>
      <h3>{t('owner.wa.tally')}</h3>
      <p>{t('owner.wa.tallyHelp')}</p>
      <QueryStatus query={tally} />
      {tally.data?.items.map((row) => (
        <TallyRowForm key={`${row.period}:${row.calls}:${row.orders}`} row={row} />
      ))}
    </section>
  );
}
function TallyRowForm({ row }: { row: TallyRow }) {
  const t = useT();
  const [calls, setCalls] = useState(row.calls === null ? '' : String(row.calls));
  const [orders, setOrders] = useState(row.orders === null ? '' : String(row.orders));
  const save = useAction(
    () =>
      api(`/admin/wa/tally/${row.period}`, 'PUT', {
        days: row.days,
        calls: Number(calls),
        orders: Number(orders),
      }),
    [tallyKey],
  );
  return (
    <div className={css.stack}>
      <h4>{t(`owner.wa.tallyPeriod.${row.period}` as MessageKey)}</h4>
      <div className={css.grid}>
        <Field label={t('owner.wa.tallyCalls')}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={calls}
            onChange={(event) => setCalls(event.target.value)}
          />
        </Field>
        <Field label={t('owner.wa.tallyOrders')}>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={orders}
            onChange={(event) => setOrders(event.target.value)}
          />
        </Field>
      </div>
      {row.perTen !== null && <p>{t('owner.wa.tallyPerTen', { count: row.perTen })}</p>}
      <div className={css.actions}>
        <Button
          variant="secondary"
          disabled={calls === '' || orders === '' || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {t('owner.wa.tallySave')}
        </Button>
      </div>
      <Problem error={save.error} />
    </div>
  );
}

/** Cards, the paste box and the AI's reading, with who it may speak to kept behind an owner's tap. */
export function WhatsAppReading() {
  const t = useT();
  const { can } = useOwner();
  return (
    <div className={css.stack}>
      <section className={css.card}>
        <p>{t('owner.wa.intro')}</p>
      </section>
      {can('wa.cards') && <PasteBox />}
      {can('wa.cards') && <Cards />}
      {can('wa.admin') && <HealthCard />}
      {can('wa.stage') && <ReplyStageCard />}
      {can('wa.read') && <GateCard />}
      {can('wa.ai.control') && <Numbers />}
      {can('wa.learn') && <LoadSizes />}
      {can('wa.read') && <Tally />}
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
