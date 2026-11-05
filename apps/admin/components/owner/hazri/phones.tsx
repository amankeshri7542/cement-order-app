'use client';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, StatusPill } from '@shiv/design';
import { momentLabel } from '@shiv/shared';
import { ApiError, api } from '../../../lib/api';
import { useLanguage, useT } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import css from '../owner.module.css';
import own from './hazri.module.css';
import { hazriKey } from './today';
import type { DeviceRequest, StaffPhone } from './types';

function RequestCard({ row }: { row: DeviceRequest }) {
  const t = useT();
  const { language } = useLanguage();
  const { notice } = useOwner();
  const decide = useAction(
    async (decision: 'APPROVE' | 'REFUSE') => {
      try {
        await api(`/admin/device-requests/${row.id}/decide`, 'POST', { decision });
        notice(
          t(decision === 'APPROVE' ? 'owner.hazri.phone.approved' : 'owner.hazri.phone.refused', {
            name: row.name,
          }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ALREADY_DECIDED')
          notice(t('owner.hazri.alreadyDone'));
        else throw error;
      }
    },
    [hazriKey],
  );
  return (
    <article className={css.card}>
      <div className={css.row}>
        <h3>{row.name}</h3>
        <StatusPill
          tone="neutral"
          label={t(row.kind === 'CHANGE' ? 'owner.hazri.phone.change' : 'owner.hazri.phone.first')}
        />
      </div>
      <p className={css.sub}>{momentLabel(row.createdAt, language)}</p>
      <p>{t('owner.hazri.phone.new', { model: row.model || t('owner.hazri.phone.unknown') })}</p>
      {row.oldModel ? (
        <p>
          {t('owner.hazri.phone.old', { model: row.oldModel })}
          {row.oldLastSeenAt &&
            ` · ${t('owner.hazri.phone.lastSeen', { when: momentLabel(row.oldLastSeenAt, language) })}`}
        </p>
      ) : (
        row.kind === 'CHANGE' && <p>{t('owner.hazri.phone.noOld')}</p>
      )}
      <p className={row.qrScannedAt ? own.toneOk : undefined}>
        {t(row.qrScannedAt ? 'owner.hazri.phone.scanned' : 'owner.hazri.phone.notScanned')}
      </p>
      {/* What someone typed stays plain text. */}
      {row.reason && <p className={css.said}>{row.reason}</p>}
      <div className={css.actions}>
        <Button disabled={decide.isPending} onClick={() => decide.mutate('APPROVE')}>
          {t('owner.hazri.phone.approve')}
        </Button>
        <Button
          variant="secondary"
          disabled={decide.isPending}
          onClick={() => decide.mutate('REFUSE')}
        >
          {t('owner.hazri.phone.refuse')}
        </Button>
      </div>
      <Problem error={decide.error} />
    </article>
  );
}

function PhoneRow({ person }: { person: StaffPhone }) {
  const t = useT();
  const { language } = useLanguage();
  const { confirm, me, notice } = useOwner();
  const active = person.phones.find((phone) => phone.status === 'ACTIVE');
  const pending = person.phones.find((phone) => phone.status === 'PENDING');
  const cut = useAction(async () => {
    const { cutOff } = await api<{ cutOff: number }>(
      `/admin/staff/${encodeURIComponent(person.id)}/device/revoke`,
      'POST',
      {},
    );
    notice(
      t(cutOff ? 'owner.hazri.phone.cutDone' : 'owner.hazri.phone.cutNothing', {
        name: person.name,
      }),
    );
  }, [hazriKey]);
  return (
    <li className={own.phoneRow}>
      <div>
        <strong>{person.name}</strong>
        <p className={css.hint}>
          {active
            ? [
                t('owner.hazri.phone.linked', { model: active.model || '-' }),
                active.lastSeenAt &&
                  t('owner.hazri.phone.lastSeen', {
                    when: momentLabel(active.lastSeenAt, language),
                  }),
              ]
                .filter(Boolean)
                .join(' · ')
            : t(
                pending
                  ? 'owner.hazri.phone.waiting'
                  : person.noPhone
                    ? 'owner.hazri.today.noPhone'
                    : 'owner.hazri.today.notLinked',
              )}
        </p>
      </div>
      {(active || pending) && person.id !== me.id && (
        <Button
          variant="danger"
          disabled={cut.isPending}
          aria-label={t('owner.hazri.phone.cutFor', { name: person.name })}
          onClick={async () => {
            if (
              await confirm({
                title: t('owner.hazri.phone.cut'),
                body: t('owner.hazri.phone.cutBody', { name: person.name }),
                confirmLabel: t('owner.hazri.phone.cutYes'),
              })
            )
              cut.mutate(undefined);
          }}
        >
          {t('owner.hazri.phone.cut')}
        </Button>
      )}
      <Problem error={cut.error} />
    </li>
  );
}

/** Who wants to link a phone, and each person's phone at a glance. */
export function HazriPhones() {
  const t = useT();
  const requests = useQuery({
    queryKey: [...hazriKey, 'phone-requests'],
    queryFn: () => api<{ items: DeviceRequest[] }>('/admin/device-requests'),
    refetchInterval: 30000,
  });
  const phones = useQuery({
    queryKey: [...hazriKey, 'phones'],
    queryFn: () => api<{ items: StaffPhone[] }>('/admin/staff-phones'),
  });
  return (
    <div className={css.stack}>
      <h2>{t('owner.hazri.phone.asked')}</h2>
      <QueryStatus query={requests} />
      {requests.data && !requests.data.items.length && (
        <EmptyState title={t('owner.hazri.phone.askedEmpty')} />
      )}
      {requests.data?.items.map((row) => (
        <RequestCard key={row.id} row={row} />
      ))}
      <h2>{t('owner.hazri.phone.all')}</h2>
      <QueryStatus query={phones} />
      {phones.data && !phones.data.items.length && (
        <EmptyState title={t('owner.hazri.phone.allEmpty')} />
      )}
      {!!phones.data?.items.length && (
        <ul className={`${css.card} ${own.phoneList}`}>
          {phones.data.items.map((person) => (
            <PhoneRow key={person.id} person={person} />
          ))}
        </ul>
      )}
    </div>
  );
}
