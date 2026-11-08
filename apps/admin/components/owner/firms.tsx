'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, Sheet, StatusPill } from '@shiv/design';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { Problem } from './common';
import css from './owner.module.css';

/** One firm as Settings shows it (plan v4, two firms). */
export type FirmRow = {
  id: string;
  legalName: string;
  tradeName: string;
  gstin: string | null;
  address: string;
  billPrefix: string;
  upiId: string;
  active: boolean;
  locations: { id: string; name: string; kind: 'SHOP' | 'GODOWN'; active: boolean }[];
  billSeries: { financialYear: string; prefix: string; nextNumber: number }[];
};

const blank = { legalName: '', tradeName: '', gstin: '', address: '', billPrefix: '', upiId: '' };

/**
 * Settings → Dukaan aur firm: each firm, its shops and its bill series. A firm is never deleted,
 * only closed, and its bill prefix stays once bills carry it (the server refuses otherwise).
 */
export function FirmRows() {
  const t = useT();
  const { can } = useOwner();
  const firms = useQuery({
    enabled: can('location.manage'),
    queryKey: ['firms'],
    queryFn: () => api<FirmRow[]>('/admin/firms'),
  });
  const [editing, setEditing] = useState<FirmRow | 'new' | null>(null);
  const [form, setForm] = useState(blank);
  const write = useAction(
    (run: () => Promise<unknown>) => run(),
    [['firms'], ['shops'], ['owner-session']],
    'owner.saved',
  );
  if (!can('location.manage')) return null;
  const open = (firm: FirmRow | 'new') => {
    setForm(
      firm === 'new'
        ? blank
        : {
            legalName: firm.legalName,
            tradeName: firm.tradeName,
            gstin: firm.gstin ?? '',
            address: firm.address,
            billPrefix: firm.billPrefix,
            upiId: firm.upiId,
          },
    );
    setEditing(firm);
  };
  const set = (key: keyof typeof blank) => (event: { target: { value: string } }) =>
    setForm((was) => ({ ...was, [key]: event.target.value }));
  return (
    <section className={css.stack} aria-label={t('owner.firms')}>
      <h2>{t('owner.firms')}</h2>
      {firms.data?.map((firm) => (
        <article className={css.card} key={firm.id}>
          <div className={css.row}>
            <h3>{firm.tradeName || firm.legalName}</h3>
            {!firm.active && <StatusPill label={t('owner.firm.closed')} tone="neutral" />}
          </div>
          <p className={css.hint}>
            {[
              firm.legalName,
              firm.gstin,
              firm.billPrefix && `${t('owner.firm.billPrefix')} ${firm.billPrefix}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p>
            {t('owner.firm.shops')}:{' '}
            {firm.locations
              .filter((shop) => shop.active)
              .map((shop) => shop.name)
              .join(', ') || '—'}
          </p>
          <div className={css.actions}>
            <Button variant="secondary" onClick={() => open(firm)}>
              {t('owner.firm.edit')}
            </Button>
            <Button
              variant="secondary"
              disabled={write.isPending}
              onClick={() =>
                write.mutate(() =>
                  api(`/admin/firms/${firm.id}`, 'PATCH', { active: !firm.active }),
                )
              }
            >
              {t(firm.active ? 'owner.firm.close' : 'owner.firm.reopen')}
            </Button>
          </div>
        </article>
      ))}
      <Problem error={write.error ?? firms.error} />
      <Button variant="secondary" onClick={() => open('new')}>
        {t('owner.firm.add')}
      </Button>
      {editing && (
        <Sheet
          title={t(editing === 'new' ? 'owner.firm.add' : 'owner.firm.edit')}
          closeLabel={t('owner.close')}
          onClose={() => {
            if (!write.isPending) setEditing(null);
          }}
        >
          <form
            className={css.stack}
            onSubmit={(event) => {
              event.preventDefault();
              // Empty optional fields stay out, so the server keeps what it has.
              const body = {
                legalName: form.legalName.trim(),
                tradeName: form.tradeName.trim(),
                address: form.address.trim(),
                upiId: form.upiId.trim(),
                gstin: form.gstin.trim() ? form.gstin.trim().toUpperCase() : null,
                ...(form.billPrefix.trim()
                  ? { billPrefix: form.billPrefix.trim().toUpperCase() }
                  : {}),
              };
              write.mutate(
                () =>
                  editing === 'new'
                    ? api('/admin/firms', 'POST', body)
                    : api(`/admin/firms/${editing.id}`, 'PATCH', body),
                { onSuccess: () => setEditing(null) },
              );
            }}
          >
            <Field label={t('owner.firm.legalName')}>
              <input
                required
                minLength={2}
                maxLength={150}
                value={form.legalName}
                onChange={set('legalName')}
              />
            </Field>
            <Field label={t('owner.firm.tradeName')}>
              <input maxLength={100} value={form.tradeName} onChange={set('tradeName')} />
            </Field>
            <Field label={t('owner.firm.gstin')}>
              <input
                maxLength={15}
                value={form.gstin}
                onChange={set('gstin')}
                autoCapitalize="characters"
              />
            </Field>
            <Field label={t('owner.firm.address')}>
              <textarea maxLength={400} value={form.address} onChange={set('address')} />
            </Field>
            <Field label={t('owner.firm.billPrefix')}>
              <input
                maxLength={6}
                pattern="[A-Za-z]{2,6}"
                value={form.billPrefix}
                onChange={set('billPrefix')}
                autoCapitalize="characters"
              />
            </Field>
            <p className={css.hint}>{t('owner.firm.billPrefixHelp')}</p>
            <Field label={t('owner.firm.upiId')}>
              <input maxLength={320} value={form.upiId} onChange={set('upiId')} inputMode="email" />
            </Field>
            <Problem error={write.error} />
            <Button className={css.wide} disabled={write.isPending}>
              {t('owner.save')}
            </Button>
          </form>
        </Sheet>
      )}
    </section>
  );
}
