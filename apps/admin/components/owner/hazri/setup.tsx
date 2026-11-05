'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, EmptyState, Field, Sheet, StatusPill } from '@shiv/design';
import { momentLabel, radiusLimits } from '@shiv/shared';
import { api } from '../../../lib/api';
import { useLanguage, useT } from '../../../lib/i18n';
import { useAction, useOwner } from '../../../lib/owner';
import { Problem, QueryStatus } from '../common';
import css from '../owner.module.css';
import { ShowHere } from './common';
import {
  averageFixes,
  browserFix,
  collectFixes,
  fixesWanted,
  LocationRefused,
  mapLink,
  typedPin,
  type Pin,
} from './fixes';
import own from './hazri.module.css';
import { hazriKey } from './today';
import type { ShopScreenRow, ShopSetup } from './types';

const patchShop = (id: string, body: object) =>
  api<ShopSetup>(`/admin/locations/${encodeURIComponent(id)}/hazri`, 'PATCH', body);
/** Beyond this the fixes disagree too much to trust, and it is worth standing somewhere clearer. */
const wideSpreadM = 50;

/** "Yahan dukaan hai": stand inside the shop, take ten fixes, look at the result, then save it. */
function TakePosition({ shop }: { shop: ShopSetup }) {
  const t = useT();
  const { notice } = useOwner();
  const [taken, setTaken] = useState(0);
  const [taking, setTaking] = useState(false);
  const [problem, setProblem] = useState<'refused' | 'none' | 'unsupported' | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const gone = useRef(false);
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
    };
  }, []);
  const take = async () => {
    if (!navigator.geolocation) {
      setProblem('unsupported');
      return;
    }
    setProblem(null);
    setPin(null);
    setTaken(0);
    setTaking(true);
    try {
      const fixes = await collectFixes(() => browserFix(navigator.geolocation), {
        onFix: setTaken,
        stopped: () => gone.current,
      });
      const average = averageFixes(fixes);
      if (average) setPin(average);
      else setProblem('none');
    } catch (error) {
      setProblem(error instanceof LocationRefused ? 'refused' : 'none');
    } finally {
      setTaking(false);
    }
  };
  const typed = typedPin(latText, lngText);
  const save = useAction(
    async (position: { lat: number; lng: number }) => {
      await patchShop(shop.id, position);
      setPin(null);
      setLatText('');
      setLngText('');
      notice(t('owner.hazri.setup.positionSaved', { shop: shop.name }));
    },
    [hazriKey],
  );
  return (
    <div className={css.stack}>
      <p>
        {shop.lat !== null && shop.lng !== null ? (
          <>
            {t('owner.hazri.setup.positionIs', { lat: shop.lat, lng: shop.lng })}{' '}
            <a
              className={css.inlineLink}
              href={mapLink(shop.lat, shop.lng)}
              target="_blank"
              rel="noreferrer"
            >
              {t('owner.hazri.review.map')}
            </a>
          </>
        ) : (
          t('owner.hazri.setup.noPosition')
        )}
      </p>
      <p className={css.hint}>{t('owner.hazri.setup.standInside')}</p>
      <Button
        variant={shop.lat === null ? 'primary' : 'secondary'}
        disabled={taking}
        onClick={() => void take()}
      >
        {taking
          ? t('owner.hazri.setup.taking', { count: taken, wanted: fixesWanted })
          : t('owner.hazri.setup.takeHere')}
      </Button>
      {problem && (
        <p className={own.lookBlock} role="alert">
          {t(
            problem === 'refused'
              ? 'owner.hazri.setup.refused'
              : problem === 'unsupported'
                ? 'owner.hazri.setup.unsupported'
                : 'owner.hazri.setup.noFix',
          )}
        </p>
      )}
      {pin && (
        <div className={own.pinResult} role="status">
          <strong>{t('owner.hazri.setup.result', { count: pin.count })}</strong>
          <p>{t('owner.hazri.setup.resultAt', { lat: pin.lat, lng: pin.lng })}</p>
          <p>
            {t('owner.hazri.setup.resultMargin', {
              accuracy: pin.worstAccuracyM,
              spread: pin.spreadM,
            })}
          </p>
          {pin.spreadM > wideSpreadM && <p>{t('owner.hazri.setup.wideSpread')}</p>}
          <a
            className={css.inlineLink}
            href={mapLink(pin.lat, pin.lng)}
            target="_blank"
            rel="noreferrer"
          >
            {t('owner.hazri.review.map')}
          </a>
          <Button
            className={css.wide}
            disabled={save.isPending}
            onClick={() => save.mutate({ lat: pin.lat, lng: pin.lng })}
          >
            {t('owner.hazri.setup.savePin')}
          </Button>
        </div>
      )}
      <details className={css.details}>
        <summary>{t('owner.hazri.setup.typeIt')}</summary>
        <form
          className={css.stack}
          onSubmit={(event) => {
            event.preventDefault();
            if (typed) save.mutate(typed);
          }}
        >
          <Field label={t('owner.hazri.setup.lat')}>
            <input
              inputMode="decimal"
              required
              value={latText}
              onChange={(event) => setLatText(event.target.value)}
            />
          </Field>
          <Field label={t('owner.hazri.setup.lng')}>
            <input
              inputMode="decimal"
              required
              value={lngText}
              onChange={(event) => setLngText(event.target.value)}
            />
          </Field>
          {latText && lngText && !typed && (
            <p className={own.lookBlock} role="status">
              {t('owner.hazri.setup.badFigures')}
            </p>
          )}
          <Button variant="secondary" disabled={save.isPending || !typed}>
            {t('owner.hazri.setup.savePin')}
          </Button>
        </form>
      </details>
      <Problem error={save.error} />
    </div>
  );
}

function Limits({ shop }: { shop: ShopSetup }) {
  const t = useT();
  const { notice } = useOwner();
  const [radius, setRadius] = useState(String(shop.radiusM));
  const [grace, setGrace] = useState(String(shop.graceMinutes));
  const radiusM = Number(radius);
  const graceMinutes = Number(grace);
  const fine =
    Number.isInteger(radiusM) &&
    radiusM >= radiusLimits.min &&
    radiusM <= radiusLimits.max &&
    Number.isInteger(graceMinutes) &&
    graceMinutes >= 0 &&
    graceMinutes <= 120;
  const save = useAction(async () => {
    await patchShop(shop.id, { radiusM, graceMinutes });
    notice(t('owner.saved'));
  }, [hazriKey]);
  return (
    <form
      className={css.stack}
      onSubmit={(event) => {
        event.preventDefault();
        if (fine) save.mutate(undefined);
      }}
    >
      <Field
        label={t('owner.hazri.setup.radius', {
          min: radiusLimits.min,
          max: radiusLimits.max,
        })}
      >
        <input
          type="number"
          inputMode="numeric"
          min={radiusLimits.min}
          max={radiusLimits.max}
          step={1}
          required
          value={radius}
          onChange={(event) => setRadius(event.target.value)}
        />
      </Field>
      <Field label={t('owner.hazri.setup.grace')}>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          step={1}
          required
          value={grace}
          onChange={(event) => setGrace(event.target.value)}
        />
      </Field>
      <p className={css.hint}>{t('owner.hazri.setup.graceHelp')}</p>
      <Problem error={save.error} />
      <Button variant="secondary" disabled={save.isPending || !fine}>
        {t('owner.save')}
      </Button>
    </form>
  );
}

function HazriSwitch({ shop }: { shop: ShopSetup }) {
  const t = useT();
  const { confirm, notice } = useOwner();
  const set = useAction(
    async (attendanceOn: boolean) => {
      await patchShop(shop.id, { attendanceOn });
      notice(t(attendanceOn ? 'owner.hazri.setup.nowOn' : 'owner.hazri.setup.nowOff'));
    },
    [hazriKey],
  );
  return (
    <div>
      <label className={css.check}>
        <input
          type="checkbox"
          checked={shop.attendanceOn}
          disabled={set.isPending}
          onChange={async (event) => {
            const next = event.target.checked;
            if (
              !next &&
              !(await confirm({
                title: t('owner.hazri.setup.offTitle'),
                body: t('owner.hazri.setup.offBody', { shop: shop.name }),
                confirmLabel: t('owner.hazri.setup.offYes'),
              }))
            )
              return;
            set.mutate(next);
          }}
        />
        {t('owner.hazri.setup.on')}
      </label>
      {/* The one refusal here is that there is no position yet, and it says what to do next. */}
      <Problem error={set.error} />
    </div>
  );
}

function ScreenRow({ screen }: { screen: ShopScreenRow }) {
  const t = useT();
  const { language } = useLanguage();
  const { confirm, notice } = useOwner();
  const off = useAction(async () => {
    await api(`/admin/screens/${encodeURIComponent(screen.id)}/revoke`, 'POST', {});
    notice(t('owner.hazri.setup.screenOff'));
  }, [hazriKey]);
  const expired =
    screen.status !== 'ACTIVE' &&
    !!screen.pairingExpiresAt &&
    new Date(screen.pairingExpiresAt).getTime() < Date.now();
  const name = screen.label || t('owner.hazri.setup.screenName');
  return (
    <li className={own.phoneRow}>
      <div>
        <strong>{name}</strong>
        <p className={css.hint}>
          {screen.status === 'ACTIVE'
            ? screen.lastSeenAt
              ? t('owner.hazri.setup.lastSeen', { when: momentLabel(screen.lastSeenAt, language) })
              : t('owner.hazri.setup.neverSeen')
            : t(expired ? 'owner.hazri.setup.codeExpired' : 'owner.hazri.setup.notPaired')}
        </p>
      </div>
      <Button
        variant="secondary"
        disabled={off.isPending}
        aria-label={t('owner.hazri.setup.screenOffFor', { name })}
        onClick={async () => {
          if (
            await confirm({
              title: t('owner.hazri.setup.screenOffTitle'),
              body: t('owner.hazri.setup.screenOffBody'),
              confirmLabel: t('owner.hazri.setup.screenOffYes'),
            })
          )
            off.mutate(undefined);
        }}
      >
        {t('owner.hazri.setup.screenOffButton')}
      </Button>
      <Problem error={off.error} />
    </li>
  );
}

/** A new screen. The six digits are shown once, and only here. */
function AddScreen({ shop }: { shop: ShopSetup }) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [made, setMade] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const add = useAction(async () => {
    const screen = await api<{ pairingCode: string; expiresAt: string }>('/admin/screens', 'POST', {
      locationId: shop.id,
      ...(label.trim() ? { label: label.trim() } : {}),
    });
    setMade(screen);
    setLabel('');
    setAsking(false);
  }, [hazriKey]);
  return (
    <>
      <Button variant="secondary" onClick={() => setAsking(true)}>
        {t('owner.hazri.setup.addScreen')}
      </Button>
      {asking && (
        <Sheet
          title={t('owner.hazri.setup.addScreen')}
          closeLabel={t('owner.close')}
          onClose={() => {
            if (!add.isPending) setAsking(false);
          }}
        >
          <form
            className={css.stack}
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate(undefined);
            }}
          >
            <Field label={t('owner.hazri.setup.screenLabel')}>
              <input
                maxLength={40}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Problem error={add.error} />
            <Button className={css.wide} disabled={add.isPending}>
              {t('owner.hazri.setup.makeCode')}
            </Button>
          </form>
        </Sheet>
      )}
      {made && (
        <Sheet
          title={t('owner.hazri.setup.codeTitle')}
          closeLabel={t('owner.close')}
          onClose={() => setMade(null)}
        >
          <div className={css.stack}>
            <p className={own.pairCode} aria-label={t('owner.hazri.setup.codeTitle')}>
              {made.pairingCode}
            </p>
            <p>{t('owner.hazri.setup.codeOnce')}</p>
            <p>
              {t('owner.hazri.setup.codeHow', {
                address: `${window.location.origin}/shop-screen`,
              })}
            </p>
            <Button className={css.wide} onClick={() => setMade(null)}>
              {t('owner.close')}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function ShopCard({ shop }: { shop: ShopSetup }) {
  const t = useT();
  const { can } = useOwner();
  const [showing, setShowing] = useState(false);
  return (
    <section className={own.setupCard} aria-label={shop.name}>
      <div className={css.row}>
        <h2>{shop.name}</h2>
        <StatusPill
          tone={shop.attendanceOn ? 'green' : 'neutral'}
          label={t(shop.attendanceOn ? 'owner.hazri.setup.stateOn' : 'owner.hazri.setup.stateOff')}
        />
      </div>
      <h3>{t('owner.hazri.setup.position')}</h3>
      <TakePosition shop={shop} />
      <h3>{t('owner.hazri.setup.rules')}</h3>
      <Limits key={`${shop.radiusM}-${shop.graceMinutes}`} shop={shop} />
      <HazriSwitch shop={shop} />
      <h3>{t('owner.hazri.setup.screens')}</h3>
      {!shop.screens.length && <p className={css.hint}>{t('owner.hazri.setup.noScreens')}</p>}
      {!!shop.screens.length && (
        <ul className={own.phoneList}>
          {shop.screens.map((screen) => (
            <ScreenRow key={screen.id} screen={screen} />
          ))}
        </ul>
      )}
      {!!shop.handCodes?.length && (
        <>
          <h3>{t('owner.hazri.setup.handCodes')}</h3>
          <ul className={own.phoneList}>
            {shop.handCodes.map((screen) => (
              <ScreenRow key={screen.id} screen={screen} />
            ))}
          </ul>
        </>
      )}
      <div className={css.actions}>
        <AddScreen shop={shop} />
        {can('attendance.mark', shop.id) && (
          <Button variant="secondary" onClick={() => setShowing(true)}>
            {t('owner.hazri.here.button')}
          </Button>
        )}
      </div>
      {showing && (
        <ShowHere locationId={shop.id} shopName={shop.name} close={() => setShowing(false)} />
      )}
    </section>
  );
}

/** Each shop's position, its limits, its screens, and whether hazri has started there. */
export function HazriSetup() {
  const t = useT();
  const { can, shopId, shops: sessionShops } = useOwner();
  const shops = useQuery({
    queryKey: [...hazriKey, 'shops'],
    queryFn: () => api<{ items: ShopSetup[] }>('/admin/attendance/shops'),
  });
  // In the order the rest of the desk lists them, with the main shop first.
  const place = (id: string) => sessionShops.findIndex((shop) => shop.id === id);
  const mine = (shops.data?.items ?? [])
    .filter((shop) => can('screen.manage', shop.id))
    .sort((a, b) => place(a.id) - place(b.id));
  const inView =
    shopId && mine.some((shop) => shop.id === shopId)
      ? mine.filter((shop) => shop.id === shopId)
      : mine;
  return (
    <div className={css.stack}>
      <QueryStatus query={shops} />
      {shops.data && !inView.length && <EmptyState title={t('owner.hazri.setup.noShops')} />}
      {inView.map((shop) => (
        <ShopCard key={shop.id} shop={shop} />
      ))}
    </div>
  );
}
