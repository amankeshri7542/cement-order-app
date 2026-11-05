'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet, StatusPill } from '@shiv/design';
import { momentLabel, money } from '@shiv/shared';
import type { QueryKey } from '@tanstack/react-query';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { rupeesToPaise } from '../../lib/money';
import { useAction, useOwner } from '../../lib/owner';
import { Problem, QueryStatus } from './common';
import own from './hazri/hazri.module.css';
import css from './owner.module.css';

type Handover = {
  key: string;
  locationId: string;
  driverId: string;
  driverName: string;
  offeredPaise: number;
  collectedPaise: number;
  offeredAt: string | null;
  countedPaise: number | null;
  countedByName: string | null;
  countNote: string;
  settledNote: string | null;
  settledByName: string | null;
  status: 'WAITING' | 'DIFFERENT' | 'DONE';
};
type Handovers = {
  withDrivers: { driverName: string; amountPaise: number }[];
  items: Handover[];
};
const enc = encodeURIComponent;
const paiseOf = (rupees: string) => {
  try {
    return rupeesToPaise(rupees);
  } catch {
    return null;
  }
};

/** The three figures, side by side. Which is right is for a person to work out. */
function Figures({ row, counted }: { row: Handover; counted?: number | null }) {
  const t = useT();
  const count = counted === undefined ? row.countedPaise : counted;
  return (
    <dl className={own.figures}>
      <div>
        <dt>{t('owner.cash.collected')}</dt>
        <dd>{money(row.collectedPaise)}</dd>
      </div>
      <div>
        <dt>{t('owner.cash.offered')}</dt>
        <dd>{money(row.offeredPaise)}</dd>
      </div>
      {count !== null && (
        <div>
          <dt>{t('owner.cash.counted')}</dt>
          <dd>{money(count)}</dd>
        </div>
      )}
    </dl>
  );
}

function CountSheet({ row, keys, close }: { row: Handover; keys: QueryKey[]; close: () => void }) {
  const t = useT();
  const { notice } = useOwner();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const typed = amount.trim() ? paiseOf(amount) : null;
  const count = useAction(async () => {
    try {
      await api(`/admin/galla/handovers/${enc(row.key)}/count`, 'POST', {
        countedPaise: typed,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      notice(
        t(typed === row.collectedPaise ? 'owner.cash.countedSame' : 'owner.cash.countedDiffers', {
          name: row.driverName,
        }),
      );
    } catch (error) {
      // Someone else counted it first, with another figure. The page will show both.
      if (error instanceof ApiError && error.code === 'HANDOVER_DONE')
        notice(t('owner.cash.alreadyCounted'));
      else throw error;
    }
    close();
  }, keys);
  return (
    <Sheet
      title={t('owner.cash.countTitle', { name: row.driverName })}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!count.isPending) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          if (typed !== null) count.mutate(undefined);
        }}
      >
        <Figures row={row} counted={null} />
        <Field label={t('owner.cash.howMuch')}>
          <input
            inputMode="decimal"
            required
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        {typed !== null && typed !== row.collectedPaise && (
          <p className={own.lookBlock} role="status">
            {t('owner.cash.differsNow', {
              counted: money(typed),
              collected: money(row.collectedPaise),
            })}
          </p>
        )}
        <Field label={t('owner.cash.note')}>
          <input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Problem error={count.error} />
        <Button className={css.wide} disabled={count.isPending || typed === null}>
          {t('owner.cash.take')}
        </Button>
      </form>
    </Sheet>
  );
}

function SettleSheet({ row, keys, close }: { row: Handover; keys: QueryKey[]; close: () => void }) {
  const t = useT();
  const { notice } = useOwner();
  const [note, setNote] = useState('');
  const settle = useAction(async () => {
    try {
      await api(`/admin/galla/handovers/${enc(row.key)}/settle`, 'POST', { note: note.trim() });
      notice(t('owner.cash.settled', { name: row.driverName }));
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ALREADY_DECIDED')
        notice(t('owner.hazri.alreadyDone'));
      else throw error;
    }
    close();
  }, keys);
  return (
    <Sheet
      title={t('owner.cash.settleTitle', { name: row.driverName })}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!settle.isPending) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          settle.mutate(undefined);
        }}
      >
        <Figures row={row} />
        <p>{t('owner.cash.settleBody')}</p>
        <Field label={t('owner.cash.settleNote')}>
          <input
            required
            minLength={2}
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Problem error={settle.error} />
        <Button className={css.wide} disabled={settle.isPending}>
          {t('owner.cash.settle')}
        </Button>
      </form>
    </Sheet>
  );
}

function HandoverCard({
  row,
  keys,
  mayCount,
  maySettle,
}: {
  row: Handover;
  keys: QueryKey[];
  mayCount: boolean;
  maySettle: boolean;
}) {
  const t = useT();
  const { language } = useLanguage();
  const { me } = useOwner();
  const [open, setOpen] = useState<'count' | 'settle' | null>(null);
  const settled = row.settledNote !== null;
  return (
    <article className={row.status === 'DIFFERENT' ? own.reviewCard : css.card}>
      <div className={css.row}>
        <h3>{row.driverName}</h3>
        <StatusPill
          tone={row.status === 'DONE' ? 'green' : 'neutral'}
          label={t(
            row.status === 'WAITING'
              ? 'owner.cash.waiting'
              : row.status === 'DIFFERENT'
                ? 'owner.cash.different'
                : settled
                  ? 'owner.cash.settledState'
                  : 'owner.cash.done',
          )}
        />
      </div>
      {row.offeredAt && <p className={css.sub}>{momentLabel(row.offeredAt, language)}</p>}
      <Figures row={row} />
      {row.countedByName && (
        <p className={css.hint}>{t('owner.cash.countedBy', { name: row.countedByName })}</p>
      )}
      {/* What someone typed stays plain text. */}
      {row.countNote && <p className={css.said}>{row.countNote}</p>}
      {settled && (
        <p className={css.hint}>
          {t('owner.cash.settledBy', { name: row.settledByName ?? '' })} · {row.settledNote}
        </p>
      )}
      {row.status === 'DIFFERENT' && <p>{t('owner.cash.differentBody')}</p>}
      {row.status === 'WAITING' && mayCount && row.driverId !== me.id && (
        <Button
          aria-label={t('owner.cash.countFor', { name: row.driverName })}
          onClick={() => setOpen('count')}
        >
          {t('owner.cash.count')}
        </Button>
      )}
      {row.status === 'DIFFERENT' && maySettle && (
        <Button variant="secondary" onClick={() => setOpen('settle')}>
          {t('owner.cash.settle')}
        </Button>
      )}
      {open === 'count' && <CountSheet row={row} keys={keys} close={() => setOpen(null)} />}
      {open === 'settle' && <SettleSheet row={row} keys={keys} close={() => setOpen(null)} />}
    </article>
  );
}

/**
 * Driver ka paisa: cash still on the road, and handovers to count. A difference is a fact on the
 * page with both figures beside it. It is never called anything about the person.
 */
export function DriverCash({ locationId, sheetKey }: { locationId: string; sheetKey: QueryKey }) {
  const t = useT();
  const { can } = useOwner();
  const key = ['handovers', locationId];
  const data = useQuery({
    queryKey: key,
    queryFn: () => api<Handovers>(`/admin/galla/handovers?locationId=${enc(locationId)}`),
    refetchInterval: 30000,
  });
  const items = data.data?.items ?? [];
  const open = items.filter((row) => row.status !== 'DONE');
  const done = items.filter((row) => row.status === 'DONE').slice(0, 5);
  const props = {
    // The counted cash has entered the drawer, so the day's sheet changes too.
    keys: [key, sheetKey],
    mayCount: can('cash.count', locationId),
    maySettle: can('approvals.decide', locationId),
  };
  return (
    <section className={css.stack} aria-label={t('owner.cash.title')}>
      <h2>{t('owner.cash.title')}</h2>
      <QueryStatus query={data} />
      {data.data && (
        <div className={css.card}>
          <h3>{t('owner.cash.withDrivers')}</h3>
          {!data.data.withDrivers.length && <p>{t('owner.cash.noneWithDrivers')}</p>}
          {data.data.withDrivers.map((row, index) => (
            <div className={css.row} key={`${row.driverName}-${index}`}>
              <span>{row.driverName}</span>
              <span className={css.amount}>{money(row.amountPaise)}</span>
            </div>
          ))}
        </div>
      )}
      {data.data && !open.length && <p className={css.hint}>{t('owner.cash.nothingOpen')}</p>}
      {open.map((row) => (
        <HandoverCard key={row.key} row={row} {...props} />
      ))}
      {done.length > 0 && <h3>{t('owner.cash.recent')}</h3>}
      {done.map((row) => (
        <HandoverCard key={row.key} row={row} {...props} />
      ))}
    </section>
  );
}
