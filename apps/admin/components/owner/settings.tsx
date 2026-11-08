'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, MoneyText, Sheet } from '@shiv/design';
import { momentLabel, type DeliveryZone, type SessionInfo, type StoreSettings } from '@shiv/shared';
import { api } from '../../lib/api';
import { useLanguage, useT, useWords } from '../../lib/i18n';
import { useAction, useOwner, useUnsavedGuard } from '../../lib/owner';
import { chime, disablePush, enablePush, pushEnabled, pushSupported } from '../../lib/push';
import { PageHeader, Problem, QueryStatus, moneyInput, rupeesToPaise } from './common';
import { soundOn } from '../../lib/bell';
import {
  chooseAppearance,
  currentAppearance,
  type TextSize,
  type ThemeChoice,
} from '../../lib/appearance';
import css from './owner.module.css';
import own from './settings.module.css';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
const soundKey = 'shiv-owner-sound';
export { soundOn };

function LanguageSection() {
  const t = useT();
  const { language, setLanguage } = useLanguage();
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.settings.language')}</h2>
      <Field label={t('owner.settings.language')}>
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

/**
 * Theme and "Bada akshar" (DESIGN.md): Auto follows the phone or computer; the choice is saved for
 * this person, so it follows them to another device.
 */
function AppearanceSection() {
  const t = useT();
  const { notice } = useOwner();
  const [look, setLook] = useState(currentAppearance);
  const pick = (next: { theme?: ThemeChoice; textSize?: TextSize }) => {
    setLook((was) => ({ ...was, ...next }));
    chooseAppearance(next).catch(() => notice(t('owner.appearance.notSaved'), true));
  };
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.appearance.title')}</h2>
      <fieldset className={own.choices}>
        <legend>{t('owner.appearance.theme')}</legend>
        {(['auto', 'light', 'dark'] as const).map((value) => (
          <label key={value} className={own.choice}>
            <input
              type="radio"
              name="theme"
              checked={look.theme === value}
              onChange={() => pick({ theme: value })}
            />
            {t(`owner.appearance.theme.${value}`)}
          </label>
        ))}
      </fieldset>
      <fieldset className={own.choices}>
        <legend>{t('owner.appearance.textSize')}</legend>
        {(['normal', 'large', 'larger'] as const).map((value) => (
          <label key={value} className={own.choice}>
            <input
              type="radio"
              name="textSize"
              checked={look.textSize === value}
              onChange={() => pick({ textSize: value })}
            />
            {t(`owner.appearance.textSize.${value}`)}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

/** Install, alerts, the test alert and the bell: all about this one phone or computer. */
function ThisPhone() {
  const t = useT();
  const words = useWords();
  const { can, notice } = useOwner();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [help, setHelp] = useState(false);
  const [alertsOn, setAlertsOn] = useState(false);
  const [sound, setSound] = useState(true);
  useEffect(() => {
    const before = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', before);
    setSound(soundOn());
    void pushEnabled()
      .then(setAlertsOn)
      .catch(() => {});
    return () => window.removeEventListener('beforeinstallprompt', before);
  }, []);
  const alerts = useAction(
    async (on: boolean) => {
      await (on ? enablePush() : disablePush());
      setAlertsOn(on);
    },
    [],
    'owner.saved',
  );
  const test = useAction(() =>
    api<{ whatsapp: boolean; push: boolean }>('/admin/alerts/test', 'POST', {}),
  );
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.settings.thisPhone')}</h2>
      {pushSupported() ? (
        <>
          <p>{t('owner.settings.alertsHelp')}</p>
          <Button
            variant={alertsOn ? 'secondary' : 'primary'}
            disabled={alerts.isPending}
            onClick={() => alerts.mutate(!alertsOn)}
          >
            {t(alertsOn ? 'owner.settings.alertsOff' : 'owner.settings.alertsOn')}
          </Button>
        </>
      ) : (
        <p className={css.warnText}>{t('owner.settings.noPush')}</p>
      )}
      {/* A test also goes to WhatsApp, so it stays useful on a browser that cannot show alerts. */}
      {can('alerts.manage') && (
        <Button
          variant="secondary"
          disabled={test.isPending}
          onClick={() =>
            test.mutate(undefined, {
              onSuccess: ({ whatsapp, push }) =>
                notice(
                  t(whatsapp || push ? 'owner.settings.testSent' : 'owner.settings.testNowhere'),
                ),
            })
          }
        >
          {t('owner.settings.testAlert')}
        </Button>
      )}
      <Problem error={alerts.error ?? test.error} />
      <label className={css.check}>
        <input
          type="checkbox"
          checked={sound}
          onChange={(event) => {
            setSound(event.target.checked);
            try {
              localStorage.setItem(soundKey, event.target.checked ? 'on' : 'off');
            } catch {
              /* Keep this visit usable when browser storage is disabled. */
            }
            if (event.target.checked) chime();
          }}
        />
        {t('owner.settings.bell')}
      </label>
      <Button
        variant="secondary"
        onClick={async () => {
          if (!install) {
            setHelp(true);
            return;
          }
          try {
            await install.prompt();
            await install.userChoice;
            setInstall(null);
          } catch (error) {
            notice(words.error(error), true);
          }
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
  const t = useT();
  const query = useQuery({ queryKey: ['store'], queryFn: () => api<StoreSettings>('/store') });
  return (
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.settings.shop')}</h2>
      <QueryStatus query={query} />
      {query.data && <StoreForm settings={query.data} />}
    </section>
  );
}
function StoreForm({ settings }: { settings: StoreSettings }) {
  const t = useT();
  const [base, setBase] = useState(settings);
  const [phone, setPhone] = useState(settings.phone.replace(/^\+91/, ''));
  const [message, setMessage] = useState(settings.deliveryMessage);
  const [dirty, setDirty] = useState(false);
  const { clearDirty } = useUnsavedGuard(dirty);
  // Someone else's newer words come in only when nothing here is being typed. A refused save keeps
  // the draft on screen with the refusal, so nobody loses what they wrote; reloading takes theirs.
  useEffect(() => {
    if (dirty || settings.version <= base.version) return;
    setBase(settings);
    setPhone(settings.phone.replace(/^\+91/, ''));
    setMessage(settings.deliveryMessage);
    setDirty(false);
    clearDirty();
  }, [settings, base.version, dirty, clearDirty]);
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
      onChange={() => setDirty(true)}
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate(undefined);
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
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.settings.zones')}</h2>
      <QueryStatus query={query} />
      {query.data && !query.data.length && <EmptyState title={t('owner.settings.noZones')} />}
      {!!query.data?.length && (
        <ul className={own.rows}>
          {query.data.map((zone) => (
            <li key={zone.id}>
              <div className={own.rowHead}>
                <strong>{zone.name}</strong>
                <Button variant="secondary" onClick={() => setEditing(zone)}>
                  {t('owner.edit')}
                </Button>
              </div>
              <p className={css.hint}>{zone.pincodes.map((pin) => pin.pincode).join(', ')}</p>
              <MoneyText value={zone.deliveryFeePaise} />
              <p className={css.hint}>{zone.estimate}</p>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" onClick={() => setEditing('new')}>
        {t('owner.addZone')}
      </Button>
      {editing && (
        <ZoneForm zone={editing === 'new' ? undefined : editing} close={() => setEditing(null)} />
      )}
    </section>
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
          action.mutate(undefined);
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
        ).map(([key, label]) => {
          const rupees = key === 'fee' || key === 'minimum' || key === 'free';
          return (
            <Field key={key} label={t(label)}>
              <input
                value={form[key]}
                inputMode={rupees ? 'decimal' : 'text'}
                // The browser stops a bad amount here, in words, before it reaches the server.
                {...(rupees
                  ? { pattern: '[0-9]+([.][0-9]{1,2})?', title: t('owner.settings.moneyHelp') }
                  : {})}
                required={!['free', 'terms'].includes(key)}
                maxLength={key === 'pincodes' ? 4000 : 500}
                onChange={(event) => field(key, event.target.value)}
              />
            </Field>
          );
        })}
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

function Logins() {
  const t = useT();
  const { language } = useLanguage();
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
    <section className={`${css.card} ${own.section}`}>
      <h2>{t('owner.settings.logins')}</h2>
      <QueryStatus query={sessions} />
      {!!sessions.data?.length && (
        <ul className={own.rows}>
          {sessions.data.map((session) => (
            <li key={session.id}>
              <strong>{session.label || t('owner.settings.deviceFallback')}</strong>
              {session.current && <p className={css.hint}>{t('owner.thisDevice')}</p>}
              <p className={css.date}>{momentLabel(session.lastSeenAt, language)}</p>
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
            </li>
          ))}
        </ul>
      )}
      <Problem error={revoke.error || logout.error} />
      <Button variant="danger" onClick={() => logout.mutate(undefined)} disabled={logout.isPending}>
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
              rename.mutate(undefined);
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
    </section>
  );
}

/** Owners set the shop here. Everyone sets their own language, phone and logins. */
export function Settings() {
  const t = useT();
  const { can } = useOwner();
  const shopSide = can('store.edit') || can('delivery.edit');
  return (
    <div className={css.stack}>
      <PageHeader title={t('owner.settings.title')} />
      <div className={own.board}>
        {shopSide && (
          <div className={own.column}>
            {can('store.edit') && <StoreInfo />}
            {can('delivery.edit') && <Zones />}
          </div>
        )}
        <div className={`${own.column} ${shopSide ? '' : own.single}`}>
          <Logins />
          <LanguageSection />
          <AppearanceSection />
          <ThisPhone />
        </div>
      </div>
    </div>
  );
}
