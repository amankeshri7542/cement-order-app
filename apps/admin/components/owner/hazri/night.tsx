'use client';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Field } from '@shiv/design';
import { istToday, money, timeLabel } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api } from '../../../lib/api';
import { useT } from '../../../lib/i18n';
import { useOwner } from '../../../lib/owner';
import { QueryStatus } from '../common';
import css from '../owner.module.css';
import own from './hazri.module.css';
import { hazriKey } from './today';
import type { NightSummary } from './types';

function Names({ title, lines }: { title: string; lines: ReactNode[] }) {
  if (!lines.length) return null;
  return (
    <section className={css.card} aria-label={title}>
      <h3>{title}</h3>
      <ul className={own.nightList}>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

/** Short, because if it is long nobody reads it, and the check on a manager depends on reading. */
export function HazriNight() {
  const t = useT();
  const { shopId } = useOwner();
  const today = istToday();
  const [day, setDay] = useState(today);
  const night = useQuery({
    queryKey: [...hazriKey, 'night', day],
    queryFn: () => api<NightSummary>(`/admin/attendance/summary?day=${encodeURIComponent(day)}`),
  });
  const data = night.data;
  // The names below are not sorted by shop, so narrowing to one only narrows the figures.
  const shops = data?.shops.filter((shop) => !shopId || shop.id === shopId) ?? [];
  const setupWords = (row: NightSummary['setupChanges'][number]): MessageKey =>
    row.event === 'SHOP_SCREEN_ADDED'
      ? 'owner.hazri.night.setup.added'
      : row.event === 'SHOP_SCREEN_REVOKED'
        ? 'owner.hazri.night.setup.removed'
        : row.positionChanged
          ? 'owner.hazri.night.setup.position'
          : 'owner.hazri.night.setup.changed';
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
      <QueryStatus query={night} />
      {data && !shops.length && <EmptyState title={t('owner.hazri.night.empty')} />}
      {!!shops.length && (
        <section className={css.card} aria-label={t('owner.hazri.night.byShop')}>
          <h3>{t('owner.hazri.night.byShop')}</h3>
          <table className={css.table}>
            <thead>
              <tr>
                <th>{t('owner.hazri.night.shop')}</th>
                <th>{t('owner.hazri.today.came')}</th>
                <th>{t('owner.hazri.night.lateCount')}</th>
                <th>{t('owner.hazri.night.noOut')}</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => (
                <tr key={shop.id}>
                  <td>{shop.name}</td>
                  <td>{shop.present}</td>
                  <td>{shop.late}</td>
                  <td>{shop.noOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={css.hint}>
            {t('owner.hazri.night.openAndPhones', {
              open: data?.reviewsOpen ?? 0,
              phones: data?.phonesAsked ?? 0,
            })}
          </p>
        </section>
      )}
      {data && (
        <>
          <Names
            title={t('owner.hazri.night.byHand')}
            lines={data.byHand.map((row) =>
              t(
                row.kind === 'MANUAL_OUT'
                  ? 'owner.hazri.night.byHandOut'
                  : 'owner.hazri.night.byHandIn',
                { name: row.name, by: row.by, time: timeLabel(row.at) },
              ),
            )}
          />
          <Names
            title={t('owner.hazri.night.accepted')}
            lines={data.accepted.map((row) =>
              [t('owner.hazri.night.acceptedRow', { name: row.name, by: row.by }), row.note]
                .filter(Boolean)
                .join(' · '),
            )}
          />
          <Names
            title={t('owner.hazri.night.corrections')}
            lines={data.corrections.map((row) =>
              [
                t(
                  row.corrects === 'OUT'
                    ? 'owner.hazri.night.correctedOut'
                    : 'owner.hazri.night.correctedIn',
                  {
                    name: row.name,
                    by: row.by,
                    time: row.to ? timeLabel(row.to) : '-',
                  },
                ),
                row.reason,
              ]
                .filter(Boolean)
                .join(' · '),
            )}
          />
          <Names
            title={t('owner.hazri.night.managerCode')}
            lines={data.scansOnManagerCode.map((row) =>
              t('owner.hazri.night.managerCodeRow', { name: row.name, codeOf: row.codeOf }),
            )}
          />
          <Names
            title={t('owner.hazri.night.setupTitle')}
            lines={data.setupChanges.map((row) =>
              t(setupWords(row), { by: row.by, shop: row.shopName }),
            )}
          />
          <Names
            title={t('owner.hazri.night.trucks')}
            lines={data.receipts.map((row) =>
              t('owner.hazri.night.truckRow', {
                quantity: row.quantity,
                name: row.name,
                supplier: row.supplierName,
                by: row.by,
              }),
            )}
          />
          <Names
            title={t('owner.hazri.night.collections')}
            lines={data.collectionDifferences.map((row) =>
              t('owner.hazri.night.collectionRow', {
                driver: row.driver,
                due: money(row.duePaise),
                amount: money(row.amountPaise),
              }),
            )}
          />
          <Names
            title={t('owner.hazri.night.cash')}
            lines={data.cashDifferences.map((row) =>
              t('owner.hazri.night.cashRow', {
                driver: row.driver,
                collected: money(row.collectedPaise),
                offered: money(row.offeredPaise),
                counted: money(row.countedPaise),
              }),
            )}
          />
          <section className={own.proof} aria-label={t('owner.hazri.night.codeTitle')}>
            <h3>{t('owner.hazri.night.codeTitle')}</h3>
            <p className={own.nightCode}>{data.nightCode ?? t('owner.hazri.night.noCode')}</p>
            <p className={css.hint}>{t('owner.hazri.proof.means')}</p>
          </section>
        </>
      )}
    </div>
  );
}
