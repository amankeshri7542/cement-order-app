'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, PhoneField, Sheet, StatusPill } from '@shiv/design';
import {
  needsShop,
  phoneDigits,
  rolePermissions,
  staffRoles,
  type Permission,
  type StaffRole,
} from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../lib/api';
import { useT, useWords } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { PageHeader, Problem, QueryStatus } from './common';
import { StaffHours } from './staff-hours';
import css from './owner.module.css';

type Person = {
  id: string;
  name: string;
  phone: string;
  role: StaffRole | null;
  locationIds: string[];
  staffPausedAt: string | null;
  lastActiveAt: string | null;
};
type ShopRow = {
  id: string;
  name: string;
  active: boolean;
  stockStartedAt: string | null;
  managerRateCapPercent?: number;
  _count?: { memberships: number };
};
/** A write that may be asked again with the passphrase. */
type Send = (passphrase?: string) => Promise<unknown>;

const roleName = (role: StaffRole) => `owner.role.${role}` as MessageKey;

/** Plain words for what each permission lets someone do, read from the same table the API uses. */
const preview: [MessageKey, Permission][] = [
  ['owner.can.dashboard', 'dashboard.read'],
  ['owner.can.orders', 'orders.read'],
  ['owner.can.orderMoney', 'orders.read.money'],
  ['owner.can.createOrder', 'orders.create'],
  ['owner.can.confirmOrder', 'orders.confirm'],
  ['owner.can.confirmCredit', 'orders.confirm.credit'],
  ['owner.can.orderChange', 'orders.change'],
  ['owner.can.rateChange', 'orders.rate.change'],
  ['owner.can.creditOverride', 'orders.credit.override'],
  ['owner.can.orderStatus', 'orders.status'],
  ['owner.can.takeMoney', 'money.receive'],
  ['owner.can.refund', 'money.refund'],
  ['owner.can.quotes', 'quotes.read'],
  ['owner.can.priceQuotes', 'quotes.price'],
  ['owner.can.customers', 'customers.read'],
  ['owner.can.udhaarOne', 'khata.read.one'],
  ['owner.can.udhaarAll', 'khata.read.list'],
  ['owner.can.udhaarPayment', 'khata.payment'],
  ['owner.can.udhaarChange', 'khata.adjust'],
  ['owner.can.creditLimit', 'khata.credit.set'],
  ['owner.can.stock', 'stock.read'],
  ['owner.can.stockIn', 'stock.receive'],
  ['owner.can.stockChange', 'stock.adjust'],
  ['owner.can.rates', 'rates.publish'],
  ['owner.can.reports', 'reports.read'],
  ['owner.can.activity', 'audit.read'],
  ['owner.can.people', 'staff.manage'],
  ['owner.can.whatsapp', 'wa.read'],
  ['owner.can.system', 'system.ops'],
];

function RolePreview({ role }: { role: StaffRole }) {
  const t = useT();
  const held = rolePermissions[role];
  const can = preview.filter(([, name]) => held[name]);
  const cannot = preview.filter(([, name]) => !held[name]);
  return (
    <details className={css.details}>
      <summary>{t('owner.rolePreview')}</summary>
      <div className={css.stack}>
        <p>{t(needsShop(role) ? 'owner.roleOwnShops' : 'owner.roleAllShops')}</p>
        {!held['desk.use'] && <p>{t('owner.roleStaffApp')}</p>}
        {!!can.length && (
          <>
            <strong>{t('owner.roleCan')}</strong>
            <ul>
              {can.map(([key]) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </>
        )}
        <strong>{t('owner.roleCannot')}</strong>
        <ul>
          {cannot.map(([key]) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/** Runs a write, and when the API asks for the passphrase, asks once and sends it again. */
function usePeopleWrite() {
  const t = useT();
  const { notice } = useOwner();
  const [waiting, setWaiting] = useState<Send | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const write = useAction(
    async ({ send, phrase }: { send: Send; phrase?: string }) => {
      try {
        await send(phrase);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'STEP_UP_REQUIRED' && !phrase) {
          setWaiting(() => send);
          return;
        }
        throw error;
      }
      setWaiting(null);
      setPassphrase('');
      notice(t('owner.saved'));
    },
    [['people'], ['shops']],
  );
  const askAgain = waiting && (
    <Sheet
      title={t('owner.stepUpTitle')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (write.isPending) return;
        setWaiting(null);
        setPassphrase('');
        write.reset();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          write.mutate({ send: waiting, phrase: passphrase });
        }}
      >
        <p>{t('owner.stepUpBody')}</p>
        <Field label={t('owner.passphrase')}>
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </Field>
        <Problem error={write.error} />
        <Button className={css.wide} disabled={write.isPending}>
          {t('owner.confirm')}
        </Button>
      </form>
    </Sheet>
  );
  const run = (send: Send) => write.mutate({ send });
  return { run, askAgain, busy: write.isPending, error: waiting ? null : write.error };
}

function PersonForm({
  person,
  shops,
  close,
  onAdded,
}: {
  person: Person | null;
  shops: ShopRow[];
  close: () => void;
  onAdded: (person: Person) => void;
}) {
  const t = useT();
  const { confirm } = useOwner();
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>(person?.role ?? 'CASHIER');
  const open = shops.filter((shop) => shop.active);
  // With one shop there is nothing to choose.
  const [chosen, setChosen] = useState<string[]>(
    person?.locationIds.length
      ? person.locationIds
      : open.length === 1 && open[0]
        ? [open[0].id]
        : [],
  );
  const [nothing, setNothing] = useState(false);
  const write = usePeopleWrite();
  const leave = async (what: 'sign-out' | 'remove', title: MessageKey, body: MessageKey) => {
    if (!person) return;
    if (
      !(await confirm({
        title: t(title),
        body: t(body, { name: person.name }),
        confirmLabel: t(title),
      }))
    )
      return;
    write.run(async (passphrase) => {
      await api(`/admin/users/${person.id}/${what}`, 'POST', passphrase ? { passphrase } : {});
      close();
    });
  };
  const toggle = (id: string) =>
    setChosen(chosen.includes(id) ? chosen.filter((shop) => shop !== id) : [...chosen, id]);
  const locationIds = needsShop(role) ? chosen : [];
  const submit = () => {
    if (person) {
      const sameRole = person.role === role;
      const sameShops = [...person.locationIds].sort().join() === [...locationIds].sort().join();
      const renamed = name.trim() !== person.name;
      if (sameRole && sameShops && !renamed) {
        setNothing(true);
        return;
      }
      setNothing(false);
      write.run(async (passphrase) => {
        await api(`/admin/users/${person.id}`, 'PATCH', {
          ...(renamed ? { name: name.trim() } : {}),
          ...(sameRole ? {} : { role }),
          // The role decides whether shops apply, so a role change always sends them.
          ...(sameRole && sameShops ? {} : { locationIds }),
          ...(passphrase ? { passphrase } : {}),
        });
        close();
      });
      return;
    }
    write.run(async (passphrase) => {
      const added = await api<Person>('/admin/users', 'POST', {
        name: name.trim(),
        phone: `+91${phoneDigits(phone)}`,
        role,
        locationIds,
        ...(passphrase ? { passphrase } : {}),
      });
      close();
      onAdded(added);
    });
  };
  return (
    <Sheet
      title={t(person ? 'owner.editPerson' : 'owner.addPerson')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!write.busy) close();
      }}
    >
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t('owner.personName')}>
          <input
            required
            minLength={2}
            maxLength={80}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        {!person && (
          <PhoneField
            label={t('owner.personPhone')}
            required
            pattern="[6-9][0-9]{9}"
            value={phone}
            onChange={setPhone}
          />
        )}
        <Field label={t('owner.personRole')}>
          <select value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
            {staffRoles.map((value) => (
              <option key={value} value={value}>
                {t(roleName(value))}
              </option>
            ))}
          </select>
        </Field>
        {needsShop(role) && open.length > 1 && (
          <fieldset className={css.formFieldset}>
            <legend>{t('owner.personShops')}</legend>
            {open.map((shop) => (
              <label className={css.check} key={shop.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(shop.id)}
                  onChange={() => toggle(shop.id)}
                />
                {shop.name}
              </label>
            ))}
          </fieldset>
        )}
        <RolePreview role={role} />
        {nothing && <p className={css.hint}>{t('owner.nothingChanged')}</p>}
        <Problem error={write.error} />
        <Button className={css.wide} disabled={write.busy}>
          {t('owner.save')}
        </Button>
      </form>
      {person && (
        <div className={css.stack}>
          <Button
            variant="secondary"
            className={css.wide}
            disabled={write.busy}
            onClick={() => void leave('sign-out', 'owner.signOutPerson', 'owner.signOutPersonBody')}
          >
            {t('owner.signOutPerson')}
          </Button>
          <Button
            variant="danger"
            className={css.wide}
            disabled={write.busy}
            onClick={() => void leave('remove', 'owner.removePerson', 'owner.removePersonBody')}
          >
            {t('owner.removePerson')}
          </Button>
        </div>
      )}
      {write.askAgain}
    </Sheet>
  );
}

/** Tells the new person how to sign in. Nothing is sent until the owner taps it. */
function Invite({ person, close }: { person: Person; close: () => void }) {
  const t = useT();
  const onDesk = !!person.role && !!rolePermissions[person.role]['desk.use'];
  const text = t('owner.inviteText', {
    name: person.name,
    phone: person.phone.replace(/^\+91/, ''),
    link: window.location.origin,
  });
  return (
    <Sheet title={t('owner.inviteTitle')} closeLabel={t('owner.close')} onClose={close}>
      <div className={css.stack}>
        {onDesk ? (
          <>
            <p>{text}</p>
            <a
              className={css.inlineLink}
              href={`https://wa.me/${person.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
            >
              {t('owner.inviteSend')} <span aria-hidden="true">→</span>
            </a>
          </>
        ) : (
          <p>{t('owner.roleStaffApp')}</p>
        )}
        <Button className={css.wide} onClick={close}>
          {t('owner.close')}
        </Button>
      </div>
    </Sheet>
  );
}

function PersonCard({
  person,
  shopName,
  onEdit,
  write,
}: {
  person: Person;
  shopName: (id: string) => string;
  onEdit: () => void;
  write: ReturnType<typeof usePeopleWrite>;
}) {
  const t = useT();
  const words = useWords();
  const { me, confirm } = useOwner();
  const mine = person.id === me.id;
  const paused = !!person.staffPausedAt;
  const [hours, setHours] = useState(false);
  const act = async (
    what: 'pause' | 'resume',
    title: MessageKey,
    body: MessageKey,
    label: MessageKey,
  ) => {
    if (
      !(await confirm({
        title: t(title),
        body: t(body, { name: person.name }),
        confirmLabel: t(label),
      }))
    )
      return;
    write.run((passphrase) =>
      api(`/admin/users/${person.id}/${what}`, 'POST', passphrase ? { passphrase } : {}),
    );
  };
  return (
    <article className={css.card}>
      <div className={css.row}>
        <h3>
          {person.name}
          {mine && ` (${t('owner.you')})`}
        </h3>
        {paused && <StatusPill label={t('owner.paused')} tone="red" />}
      </div>
      <p>
        {person.role ? t(roleName(person.role)) : ''}
        {person.locationIds.length > 0 && ` · ${person.locationIds.map(shopName).join(', ')}`}
      </p>
      <p>{person.phone}</p>
      <p className={css.date}>
        {person.lastActiveAt
          ? t('owner.lastActive', { when: words.moment(person.lastActiveAt) })
          : t('owner.neverActive')}
      </p>
      {mine ? (
        <p className={css.hint}>{t('owner.ownAccessHint')}</p>
      ) : (
        <div className={css.actions}>
          <Button variant="secondary" onClick={onEdit}>
            {t('owner.change')}
          </Button>
          {/* Only someone tied to a shop has a shift and hazri there. */}
          {person.role && needsShop(person.role) && (
            <Button
              variant="secondary"
              aria-label={t('owner.shift.openFor', { name: person.name })}
              onClick={() => setHours(true)}
            >
              {t('owner.shift.open')}
            </Button>
          )}
          {paused ? (
            <Button
              variant="secondary"
              disabled={write.busy}
              onClick={() =>
                void act(
                  'resume',
                  'owner.resumePerson',
                  'owner.resumePersonBody',
                  'owner.resumePerson',
                )
              }
            >
              {t('owner.resumePerson')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={write.busy}
              onClick={() =>
                void act('pause', 'owner.pausePerson', 'owner.pausePersonBody', 'owner.pausePerson')
              }
            >
              {t('owner.pausePerson')}
            </Button>
          )}
        </div>
      )}
      {hours && <StaffHours person={person} close={() => setHours(false)} />}
    </article>
  );
}

/** How far below the list rate a manager at this shop may go when confirming an order. */
function RateCap({ shop }: { shop: ShopRow }) {
  const t = useT();
  const [value, setValue] = useState(String(shop.managerRateCapPercent ?? 0));
  const save = useAction(
    () => api(`/admin/locations/${shop.id}`, 'PATCH', { managerRateCapPercent: Number(value) }),
    [['shops']],
    'owner.saved',
  );
  return (
    <form
      className={css.stack}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Field label={t('owner.shopRateCap')}>
        <input
          inputMode="numeric"
          pattern="[0-9]{1,2}"
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Field>
      <p className={css.hint}>{t('owner.shopRateCapHelp')}</p>
      <Problem error={save.error} />
      <Button variant="secondary" disabled={save.isPending}>
        {t('owner.shopRateCapSave')}
      </Button>
    </form>
  );
}

function ShopRows({ shops }: { shops: ShopRow[] }) {
  const t = useT();
  const { can, confirm } = useOwner();
  const [name, setName] = useState('');
  // 'new' adds a shop; a shop's id renames that one.
  const [naming, setNaming] = useState<string | null>(null);
  const write = useAction(
    (run: () => Promise<unknown>) => run(),
    [['shops'], ['owner-session']],
    'owner.saved',
  );
  if (!can('location.manage')) return null;
  return (
    <section className={css.stack} aria-label={t('owner.shops')}>
      <h2>{t('owner.shops')}</h2>
      {shops.map((shop) => (
        <article className={css.card} key={shop.id}>
          <div className={css.row}>
            <h3>{shop.name}</h3>
            {!shop.active && <StatusPill label={t('owner.shopClosed')} tone="neutral" />}
          </div>
          <p>{t('owner.shopPeople', { count: shop._count?.memberships ?? 0 })}</p>
          <RateCap shop={shop} />
          <div className={css.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setName(shop.name);
                setNaming(shop.id);
              }}
            >
              {t('owner.renameShop')}
            </Button>
            {shop.id !== 'loc_main' && (
              <Button
                variant="secondary"
                disabled={write.isPending}
                onClick={async () => {
                  if (
                    shop.active &&
                    !(await confirm({
                      title: t('owner.closeShop'),
                      body: t('owner.closeShopBody', { name: shop.name }),
                      confirmLabel: t('owner.closeShop'),
                    }))
                  )
                    return;
                  write.mutate(() =>
                    api(`/admin/locations/${shop.id}`, 'PATCH', { active: !shop.active }),
                  );
                }}
              >
                {t(shop.active ? 'owner.closeShop' : 'owner.reopenShop')}
              </Button>
            )}
          </div>
        </article>
      ))}
      <Problem error={write.error} />
      <Button
        variant="secondary"
        onClick={() => {
          setName('');
          setNaming('new');
        }}
      >
        {t('owner.addShop')}
      </Button>
      {naming && (
        <Sheet
          title={t(naming === 'new' ? 'owner.addShop' : 'owner.renameShop')}
          closeLabel={t('owner.close')}
          onClose={() => {
            if (!write.isPending) setNaming(null);
          }}
        >
          <form
            className={css.stack}
            onSubmit={(event) => {
              event.preventDefault();
              write.mutate(
                () =>
                  naming === 'new'
                    ? api('/admin/locations', 'POST', { name: name.trim() })
                    : api(`/admin/locations/${naming}`, 'PATCH', { name: name.trim() }),
                { onSuccess: () => setNaming(null) },
              );
            }}
          >
            <Field label={t('owner.shopName')}>
              <input
                required
                minLength={2}
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
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

/** Your own passphrase. It is asked for whenever someone's access changes. */
function PassphraseCard() {
  const t = useT();
  const { hasPassphrase } = useOwner();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const save = useAction(
    () =>
      api('/auth/passphrase', 'POST', {
        next,
        ...(hasPassphrase ? { current } : {}),
      }),
    [['owner-session']],
    'owner.saved',
  );
  const close = () => {
    if (save.isPending) return;
    setOpen(false);
    setCurrent('');
    setNext('');
    setAgain('');
    save.reset();
  };
  const differ = !!again && next !== again;
  return (
    <section className={css.card}>
      {!hasPassphrase && <h3>{t('owner.passphraseNeeded')}</h3>}
      <p>{t(hasPassphrase ? 'owner.passphraseIsSet' : 'owner.passphraseNeededBody')}</p>
      <Button variant={hasPassphrase ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>
        {t(hasPassphrase ? 'owner.passphraseChange' : 'owner.passphraseSet')}
      </Button>
      {open && (
        <Sheet
          title={t(hasPassphrase ? 'owner.passphraseChange' : 'owner.passphraseSet')}
          closeLabel={t('owner.close')}
          onClose={close}
        >
          <form
            className={css.stack}
            onSubmit={(event) => {
              event.preventDefault();
              if (!differ) save.mutate(undefined, { onSuccess: close });
            }}
          >
            {hasPassphrase && (
              <Field label={t('owner.passphraseCurrent')}>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={200}
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              </Field>
            )}
            <Field label={t('owner.passphraseNew')}>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={200}
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </Field>
            <Field label={t('owner.passphraseAgain')}>
              <input
                type="password"
                autoComplete="new-password"
                required
                maxLength={200}
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            </Field>
            {differ && <p className={css.error}>{t('owner.passphraseDiffer')}</p>}
            <Problem error={save.error} />
            <Button className={css.wide} disabled={save.isPending || differ}>
              {t('owner.save')}
            </Button>
          </form>
        </Sheet>
      )}
    </section>
  );
}

/** Who can use the desk and what each of them can do. Only owners reach this page. */
export function People() {
  const t = useT();
  const { can, shops: sessionShops } = useOwner();
  const people = useQuery({ queryKey: ['people'], queryFn: () => api<Person[]>('/admin/users') });
  const managed = useQuery({
    enabled: can('location.manage'),
    queryKey: ['shops'],
    queryFn: () => api<ShopRow[]>('/admin/locations'),
  });
  const shops: ShopRow[] =
    managed.data ?? sessionShops.map((shop) => ({ ...shop, active: true, stockStartedAt: null }));
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [invited, setInvited] = useState<Person | null>(null);
  const write = usePeopleWrite();
  const shopName = (id: string) => shops.find((shop) => shop.id === id)?.name ?? id;
  return (
    <div className={css.stack}>
      <PassphraseCard />
      <Button className={css.wide} onClick={() => setEditing('new')}>
        {t('owner.addPerson')}
      </Button>
      <QueryStatus query={people} />
      <Problem error={write.error} />
      {people.data?.map((person) => (
        <PersonCard
          key={person.id}
          person={person}
          shopName={shopName}
          onEdit={() => setEditing(person)}
          write={write}
        />
      ))}
      {people.data?.length === 0 && <EmptyState title={t('owner.emptyPeople')} />}
      <ShopRows shops={shops} />
      {editing && (
        <PersonForm
          person={editing === 'new' ? null : editing}
          shops={shops}
          close={() => setEditing(null)}
          onAdded={setInvited}
        />
      )}
      {invited && <Invite person={invited} close={() => setInvited(null)} />}
      {write.askAgain}
    </div>
  );
}

export function PeoplePage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('owner.people')} />
      <People />
    </>
  );
}
