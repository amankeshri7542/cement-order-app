'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Sheet } from '@shiv/design';
import { api } from '../../lib/api';
import { useT } from '../../lib/i18n';
import { useAction, useOwner, useUnsavedGuard } from '../../lib/owner';
import { Problem, QueryStatus } from './common';
import { AskAdvance } from './salary/ask';
import css from './owner.module.css';
import own from './settings.module.css';

type Staff = {
  id: string;
  name: string | null;
  phone: string;
  staffTitle: string;
  whatsappAlerts: boolean;
  _count: { pushSubscriptions: number };
};
const staffKey = ['owner-staff-list'];

function EditStaff({ person, close }: { person: Staff; close: () => void }) {
  const t = useT();
  const [name, setName] = useState(person.name ?? '');
  const [job, setJob] = useState(person.staffTitle);
  const [whatsapp, setWhatsapp] = useState(person.whatsappAlerts);
  const [dirty, setDirty] = useState(false);
  const { clearDirty, requestClose } = useUnsavedGuard(dirty);
  const save = useAction(
    async () => {
      await api(`/admin/staff/${person.id}`, 'PATCH', {
        name: name.trim(),
        staffTitle: job.trim(),
        whatsappAlerts: whatsapp,
      });
      clearDirty();
      close();
    },
    [staffKey],
    'owner.saved',
  );
  return (
    <Sheet
      title={t('owner.staffList.editTitle')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!save.isPending) void requestClose(close);
      }}
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label={t('owner.staffList.name')}>
          <input
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t('owner.staffList.job')}>
          <input
            maxLength={60}
            placeholder={t('owner.staffList.jobHint')}
            value={job}
            onChange={(event) => setJob(event.target.value)}
          />
        </Field>
        <label className={css.check}>
          <input
            type="checkbox"
            checked={whatsapp}
            onChange={(event) => setWhatsapp(event.target.checked)}
          />
          {t('owner.staffList.whatsappLabel', { phone: person.phone })}
        </label>
        <Problem error={save.error} />
        <Button className={css.wide} disabled={save.isPending}>
          {t('owner.save')}
        </Button>
      </form>
    </Sheet>
  );
}

/** Staff names and work, and how each person hears about new orders. A shop's people see theirs. */
export function StaffList() {
  const t = useT();
  const { can, me } = useOwner();
  const allowed = can('staff.read');
  const staff = useQuery({
    enabled: allowed,
    queryKey: staffKey,
    queryFn: () => api<Staff[]>('/admin/staff'),
  });
  const [editing, setEditing] = useState<Staff | null>(null);
  if (!allowed) return null;
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.staffList.title')}</h2>
      <AskAdvance />
      <QueryStatus query={staff} />
      {staff.data && !staff.data.length && <EmptyState title={t('owner.staffList.empty')} />}
      {!!staff.data?.length && (
        <ul className={own.rows}>
          {staff.data.map((person) => {
            const name = person.name || t('owner.staffList.unnamed');
            return (
              <li key={person.id}>
                <div className={own.rowHead}>
                  <strong>
                    {name}
                    {person.id === me.id && ` (${t('owner.you')})`}
                  </strong>
                  {can('staff.manage') && (
                    <Button
                      variant="secondary"
                      aria-label={t('owner.staffList.changePerson', { name })}
                      onClick={() => setEditing(person)}
                    >
                      {t('owner.staffList.change')}
                    </Button>
                  )}
                </div>
                <p className={css.hint}>
                  {[
                    person.staffTitle,
                    person.phone,
                    person.whatsappAlerts ? t('owner.staffList.whatsappOn') : '',
                    t('owner.staffList.alertPhones', { count: person._count.pushSubscriptions }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <EditStaff person={editing} close={() => setEditing(null)} />}
    </section>
  );
}
