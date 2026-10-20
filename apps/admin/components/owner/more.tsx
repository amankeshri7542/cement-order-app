'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button, Field, MoneyText, Sheet } from '@shiv/design';
import {
  istToday,
  money,
  type Category,
  type DeliveryZone,
  type MoneyReport,
  type Product,
  type Quote,
  type SessionInfo,
  type StoreSettings,
} from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { api, download } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useAction, useOwner, useUnsavedGuard } from '../../lib/owner';
import { enablePush, pushEnabled } from '../../lib/push';
import { Quotes } from '../quotes';
import { RateStudio } from '../rate-studio/studio';
import { Products } from '../products';
import { StaffAlerts } from '../staff';
import {
  MoreRows,
  PageHeader,
  Problem,
  QueryStatus,
  moneyInput,
  rupeesToPaise,
  usePaged,
} from './common';
import css from './owner.module.css';

const rateStudioEnabled = process.env.NEXT_PUBLIC_FEATURE_RATE_STUDIO === 'true';
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export function More() {
  const t = useT();
  const { me } = useOwner();
  const params = useSearchParams();
  const view = params.get('view');
  const titles: Record<string, MessageKey> = {
    store: 'owner.storeDetails',
    zones: 'owner.zones',
    devices: 'owner.devices',
    activity: 'owner.activity',
    reports: 'owner.reports',
    language: 'owner.language',
    quotes: 'owner.quotes',
    rates: 'owner.rateStudio',
    products: 'owner.materials',
    staff: 'owner.staff',
  };
  return (
    <>
      <PageHeader
        title={view && titles[view] ? t(titles[view]) : t('owner.more')}
        back={view ? '/more' : undefined}
      />
      {!view && (
        <>
          <nav className={`${css.card} ${css.menu}`} aria-label={t('owner.more')}>
            {Object.entries(titles)
              .filter(([key]) => key !== 'rates' || rateStudioEnabled)
              .map(([key, title]) => (
                <Link href={`/more?view=${key}`} key={key}>
                  {t(title)}
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
          </nav>
          <DeviceTools />
        </>
      )}
      {view === 'store' && <StoreInfo />}
      {view === 'zones' && <Zones />}
      {view === 'devices' && <Devices />}
      {view === 'activity' && <Activity />}
      {view === 'reports' && <Reports />}
      {view === 'language' && <LanguageSettings />}
      {view === 'quotes' && <AdvancedQuotes />}
      {view === 'rates' && rateStudioEnabled && <AdvancedRates />}
      {view === 'products' && <AdvancedProducts />}
      {view === 'staff' && (
        <div className={css.legacy}>
          <StaffAlerts me={me.id} />
        </div>
      )}
    </>
  );
}
function LanguageSettings() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <section className={css.card}>
      <Field label={t('owner.language')}>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value === 'en' ? 'en' : 'hi')}
        >
          <option value="hi">{t('owner.hindi')}</option>
          <option value="en">{t('owner.english')}</option>
        </select>
      </Field>
    </section>
  );
}
function DeviceTools() {
  const t = useT();
  const { notice } = useOwner();
  const words = useWords();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [help, setHelp] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const before = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', before);
    void pushEnabled()
      .then(setEnabled)
      .catch(() => {});
    return () => window.removeEventListener('beforeinstallprompt', before);
  }, []);
  const alerts = useAction(
    async () => {
      await enablePush();
      setEnabled(true);
    },
    [],
    'owner.saved',
  );
  return (
    <section className={`${css.card} ${css.stack}`}>
      <h2>{t('owner.notifications')}</h2>
      <Button
        variant="secondary"
        disabled={alerts.isPending || enabled}
        onClick={() => alerts.mutate()}
      >
        {t('owner.enableAlerts')}
      </Button>
      <Problem error={alerts.error} />
      <Button
        variant="secondary"
        onClick={async () => {
          if (install) {
            try {
              await install.prompt();
              await install.userChoice;
              setInstall(null);
            } catch (error) {
              notice(words.error(error));
            }
          } else setHelp(true);
        }}
      >
        {t('owner.install')}
      </Button>
      {help && (
        <Sheet
          title={t('owner.install')}
          closeLabel={t('owner.close')}
          onClose={() => setHelp(false)}
        >
          <p>{t('owner.installHelp')}</p>
        </Sheet>
      )}
    </section>
  );
}
function StoreInfo() {
  const query = useQuery({ queryKey: ['store'], queryFn: () => api<StoreSettings>('/store') });
  return (
    <>
      <QueryStatus query={query} />
      {query.data && <StoreForm settings={query.data} />}
    </>
  );
}
function StoreForm({ settings }: { settings: StoreSettings }) {
  const t = useT();
  const [base, setBase] = useState(settings);
  const [phone, setPhone] = useState(settings.phone.replace(/^\+91/, ''));
  const [message, setMessage] = useState(settings.deliveryMessage);
  const [dirty, setDirty] = useState(false);
  const { clearDirty } = useUnsavedGuard(dirty);
  const action = useAction(
    async () => {
      const updated = await api<StoreSettings>('/admin/store', 'PATCH', {
        phone: '+91' + phone,
        deliveryMessage: message,
        deliveryFeePaise: base.deliveryFeePaise,
        freeDeliveryAbovePaise: base.freeDeliveryAbovePaise,
        onlinePaymentsEnabled: base.onlinePaymentsEnabled,
        expectedVersion: base.version,
      });
      setBase(updated);
      setDirty(false);
      clearDirty();
    },
    [['store']],
    'owner.saved',
  );
  return (
    <form
      className={css.card}
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate();
      }}
    >
      <Field label={t('owner.storePhone')}>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          pattern="[6-9][0-9]{9}"
          maxLength={10}
          required
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
        />
      </Field>
      <Field label={t('owner.deliveryMessage')}>
        <textarea
          required
          maxLength={250}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
      </Field>
      <Link href="/more?view=zones" className={css.inlineLink}>
        {t('owner.zones')}
      </Link>
      <Problem error={action.error} />
      <Button className={css.wide} disabled={action.isPending}>
        {t('owner.save')}
      </Button>
    </form>
  );
}
type Zone = Omit<DeliveryZone, 'pincodes'> & { pincodes: { pincode: string }[] };
function Zones() {
  const t = useT();
  const query = useQuery({
    queryKey: ['zones'],
    queryFn: () => api<Zone[]>('/admin/delivery-zones'),
  });
  const [editing, setEditing] = useState<Zone | 'new' | null>(null);
  return (
    <div className={css.stack}>
      <Button onClick={() => setEditing('new')}>{t('owner.addZone')}</Button>
      <QueryStatus query={query} />
      {query.data?.map((zone) => (
        <article className={css.card} key={zone.id}>
          <h2>{zone.name}</h2>
          <p>{zone.pincodes.map((pin) => pin.pincode).join(', ')}</p>
          <div className={css.row}>
            <MoneyText value={zone.deliveryFeePaise} />
            <Button variant="secondary" onClick={() => setEditing(zone)}>
              {t('owner.edit')}
            </Button>
          </div>
          <p>{zone.estimate}</p>
        </article>
      ))}
      {editing && (
        <ZoneForm zone={editing === 'new' ? undefined : editing} close={() => setEditing(null)} />
      )}
    </div>
  );
}
function ZoneForm({ zone, close }: { zone?: Zone; close: () => void }) {
  const t = useT();
  const [dirty, setDirty] = useState(false);
  const { clearDirty, requestClose } = useUnsavedGuard(dirty);
  const [form, setForm] = useState({
    name: zone?.name ?? '',
    fee: moneyInput(zone?.deliveryFeePaise ?? 0),
    minimum: moneyInput(zone?.minimumOrderPaise ?? 0),
    free: moneyInput(zone?.freeDeliveryAbovePaise),
    estimate: zone?.estimate ?? '',
    terms: zone?.terms ?? '',
    pincodes: zone?.pincodes.map((pin) => pin.pincode).join(', ') ?? '',
    active: zone?.active ?? true,
  });
  const field = (key: keyof typeof form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  const action = useAction(
    async () => {
      await api(`/admin/delivery-zones${zone ? '/' + zone.id : ''}`, zone ? 'PATCH' : 'POST', {
        name: form.name,
        active: form.active,
        deliveryFeePaise: rupeesToPaise(form.fee),
        minimumOrderPaise: rupeesToPaise(form.minimum),
        freeDeliveryAbovePaise: form.free ? rupeesToPaise(form.free) : null,
        estimate: form.estimate,
        terms: form.terms,
        pincodes: form.pincodes
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        ...(zone ? { expectedVersion: zone.version } : {}),
      });
      clearDirty();
      close();
    },
    [['zones']],
    'owner.saved',
  );
  return (
    <Sheet
      title={t(zone ? 'owner.edit' : 'owner.addZone')}
      closeLabel={t('owner.close')}
      onClose={() => {
        if (!action.isPending) void requestClose(close);
      }}
    >
      <form
        onChange={() => setDirty(true)}
        onSubmit={(event) => {
          event.preventDefault();
          action.mutate();
        }}
      >
        {(
          [
            ['name', 'owner.zoneName'],
            ['pincodes', 'owner.zonePincodes'],
            ['fee', 'owner.deliveryFee'],
            ['minimum', 'owner.zoneMinimum'],
            ['free', 'owner.zoneFree'],
            ['estimate', 'owner.zoneEstimate'],
            ['terms', 'owner.zoneTerms'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={t(label)}>
            <input
              value={form[key]}
              inputMode={['fee', 'minimum', 'free'].includes(key) ? 'decimal' : 'text'}
              required={!['free', 'terms'].includes(key)}
              maxLength={key === 'pincodes' ? 4000 : 500}
              onChange={(event) => field(key, event.target.value)}
            />
          </Field>
        ))}
        <label className={css.check}>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => field('active', event.target.checked)}
          />
          {t('owner.active')}
        </label>
        <Problem error={action.error} />
        <Button className={css.wide} disabled={action.isPending}>
          {t('owner.save')}
        </Button>
      </form>
    </Sheet>
  );
}
function Devices() {
  const t = useT();
  const words = useWords();
  const { confirm, endSession } = useOwner();
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<SessionInfo[]>('/auth/sessions'),
  });
  const [renaming, setRenaming] = useState<SessionInfo | null>(null);
  const [label, setLabel] = useState('');
  const rename = useAction(
    async () => {
      await api(`/auth/sessions/${renaming!.id}`, 'PATCH', { label });
      setRenaming(null);
    },
    [['sessions']],
    'owner.saved',
  );
  const revoke = useAction(
    async (session: SessionInfo) => {
      if (
        !(await confirm({
          title: t('owner.revoke'),
          body: t('owner.revokeQuestion'),
          confirmLabel: t('owner.revoke'),
        }))
      )
        return;
      await api(`/auth/sessions/${session.id}`, 'DELETE');
      if (session.current) endSession();
    },
    [['sessions']],
  );
  const logout = useAction(async () => {
    if (
      !(await confirm({
        title: t('owner.logout'),
        body: t('owner.logoutQuestion'),
        confirmLabel: t('owner.logout'),
      }))
    )
      return;
    await api('/auth/logout', 'POST');
    endSession();
  }, []);
  return (
    <div className={css.stack}>
      <QueryStatus query={sessions} />
      {sessions.data?.map((session) => (
        <article key={session.id} className={css.card}>
          <h2>{session.label || t('owner.deviceFallback')}</h2>
          {session.current && <p>{t('owner.thisDevice')}</p>}
          <p className={css.date}>{words.moment(session.lastSeenAt)}</p>
          <div className={css.actions}>
            <Button
              variant="secondary"
              onClick={() => {
                setRenaming(session);
                setLabel(session.label);
              }}
            >
              {t('owner.rename')}
            </Button>
            <Button
              variant="danger"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(session)}
            >
              {t('owner.revoke')}
            </Button>
          </div>
        </article>
      ))}
      <Problem error={revoke.error || logout.error} />
      <Button variant="danger" onClick={() => logout.mutate()} disabled={logout.isPending}>
        {t('owner.logout')}
      </Button>
      {renaming && (
        <Sheet
          title={t('owner.rename')}
          closeLabel={t('owner.close')}
          onClose={() => setRenaming(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate();
            }}
          >
            <Field label={t('owner.deviceName')}>
              <input
                required
                maxLength={100}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Problem error={rename.error} />
            <Button disabled={rename.isPending}>{t('owner.save')}</Button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
function Reports() {
  const t = useT();
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const today = istToday();
  const date = new Date(`${today}T00:00:00Z`);
  const offset =
    range === 'week' ? (date.getUTCDay() + 6) % 7 : range === 'month' ? date.getUTCDate() - 1 : 0;
  const from = new Date(date.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const query = useQuery({
    queryKey: ['reports', from, today],
    queryFn: () => api<MoneyReport>(`/admin/reports/money?from=${from}&to=${today}`),
  });
  const exportFile = useAction(() =>
    download(`/admin/reports/export?from=${from}&to=${today}`, `shiv-${from}-${today}.csv`),
  );
  return (
    <div className={css.stack}>
      <div className={css.chips}>
        {(['today', 'week', 'month'] as const).map((value) => (
          <Button
            key={value}
            variant={value === range ? 'primary' : 'secondary'}
            aria-pressed={value === range}
            onClick={() => setRange(value)}
          >
            {t(value === 'today' ? 'owner.today' : value === 'week' ? 'owner.week' : 'owner.month')}
          </Button>
        ))}
      </div>
      <QueryStatus query={query} />
      {query.data && (
        <>
          <div className={css.columns}>
            {(
              [
                ['owner.sales', query.data.orders.valuePaise],
                ['owner.collections', query.data.netPaise],
                ['owner.creditGiven', query.data.creditSalesPaise],
                ['owner.creditRepaid', query.data.creditPaymentsPaise],
              ] as const
            ).map(([label, value]) => (
              <section className={css.card} key={label}>
                <h2>{t(label)}</h2>
                <p className={css.moneyHero}>{money(value)}</p>
              </section>
            ))}
          </div>
          <Button disabled={exportFile.isPending} onClick={() => exportFile.mutate()}>
            {t('owner.export')}
          </Button>
          <Problem error={exportFile.error} />
          <h2>{t('owner.topCustomers')}</h2>
          {query.data.topCustomers.map((customer) => (
            <Link
              key={customer.id}
              className={`${css.card} ${css.cardLink}`}
              href={`/customers/${customer.id}`}
            >
              <div className={css.row}>
                <strong>{customer.name || customer.phone}</strong>
                <MoneyText value={customer.totalPaise} />
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
function Activity() {
  const t = useT();
  const words = useWords();
  const query = usePaged<{
    id: string;
    event: string;
    actorName: string;
    entityLabel: string;
    createdAt: string;
  }>(['activity'], '/admin/audit?limit=24');
  const names: Record<string, MessageKey> = {
    PHONE_ORDER_CREATED: 'owner.orderCreated',
    ORDER_CREATED: 'owner.orderCreated',
    ORDER_PREPARING: 'owner.startPreparing',
    ORDER_OUT_FOR_DELIVERY: 'owner.dispatch',
    ORDER_DELIVERED: 'owner.deliver',
    COD_RECEIVED: 'owner.receiveMoney',
    KHATA_PAYMENT_RECEIVED: 'owner.receiveMoney',
    KHATA_REVERSAL: 'owner.reverse',
    CUSTOMER_UPDATED: 'owner.customerSettings',
    CUSTOMER_NOTE_ADDED: 'owner.addNote',
    SESSION_RENAMED: 'owner.rename',
    STAFF_UPDATED: 'owner.staffChanged',
    CURRENT_RATES_SHARED: 'owner.shareRates',
  };
  return (
    <div className={css.stack}>
      <QueryStatus query={query} />
      {query.data?.pages
        .flatMap((page) => page.items)
        .map((entry) => (
          <article key={entry.id} className={css.card}>
            <h2>{t(names[entry.event] ?? 'owner.activity')}</h2>
            <p>{entry.entityLabel}</p>
            <p>{entry.actorName}</p>
            <span className={css.date}>{words.moment(entry.createdAt)}</span>
          </article>
        ))}
      <MoreRows query={query} />
    </div>
  );
}
function AdvancedQuotes() {
  const { notice, setDirty } = useOwner();
  const query = usePaged<Quote>(['quotes', 'list'], '/admin/quotes?limit=24');
  return (
    <div className={css.legacy}>
      <QueryStatus query={query} />
      {query.data && (
        <Quotes
          quotes={query.data.pages.flatMap((page) => page.items)}
          refresh={async () => {
            await query.refetch();
          }}
          notice={notice}
          onDirtyChange={setDirty}
        />
      )}
      <MoreRows query={query} />
    </div>
  );
}
function AdvancedRates() {
  const { notice, setDirty } = useOwner();
  const query = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  return (
    <div className={css.legacy}>
      <QueryStatus query={query} />
      {query.data && (
        <RateStudio
          categories={query.data}
          refresh={async () => {
            await query.refetch();
          }}
          notice={notice}
          onDirtyChange={setDirty}
        />
      )}
    </div>
  );
}
function AdvancedProducts() {
  const { notice } = useOwner();
  const [filter, setFilter] = useState('');
  const query = usePaged<Product>(
    ['products', 'manage', filter],
    '/admin/products?limit=100&' + filter,
  );
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  return (
    <div className={css.legacy}>
      <QueryStatus query={query} />
      <QueryStatus query={categories} />
      {query.data && categories.data && (
        <Products
          onFilter={setFilter}
          products={query.data.pages.flatMap((page) => page.items)}
          categories={categories.data}
          refresh={async () => {
            await query.refetch();
          }}
          notice={notice}
        />
      )}
      <MoreRows query={query} />
    </div>
  );
}
