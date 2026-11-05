'use client';
import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button, EmptyState, Field, StatusPill } from '@shiv/design';
import { dayLabel, momentLabel } from '@shiv/shared';
import type { MessageKey } from '@shiv/i18n';
import { ApiError, api } from '../../lib/api';
import { useLanguage, useT } from '../../lib/i18n';
import { useAction, useOwner } from '../../lib/owner';
import { PageHeader, Problem, QueryStatus } from './common';
import own from './hazri/hazri.module.css';
import css from './owner.module.css';
import { moved } from './trip-order';

type ReadyOrder = {
  id: string;
  number: string;
  status: string;
  deliveryDate: string;
  area: string;
  name: string;
  items: { name: string; unit: string; quantity: number }[];
  loaded: boolean;
};
type Driver = { id: string; name: string; role: 'DRIVER' | 'HELPER' };
type TripRow = {
  id: string;
  status: 'PLANNED' | 'OUT' | 'DONE' | 'CANCELLED';
  vehicle: string;
  locationId: string;
  driverName: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  stops: {
    id: string;
    status: 'PENDING' | 'DELIVERED' | 'PROBLEM';
    number: string;
    orderStatus: string;
    area: string;
    problem: string | null;
  }[];
};
const tripsKey = ['trips'];
/** The most stops one trip may hold. The API refuses more. */
const maxStops = 20;
const enc = encodeURIComponent;

function NewTrip({ locationId }: { locationId: string }) {
  const t = useT();
  const { language } = useLanguage();
  const { notice } = useOwner();
  const ready = useQuery({
    queryKey: [...tripsKey, 'ready', locationId],
    queryFn: () => api<{ items: ReadyOrder[] }>(`/admin/trips/ready?locationId=${enc(locationId)}`),
    refetchInterval: 30000,
  });
  const drivers = useQuery({
    queryKey: [...tripsKey, 'drivers', locationId],
    queryFn: () => api<{ items: Driver[] }>(`/admin/trips/drivers?locationId=${enc(locationId)}`),
  });
  const [chosen, setChosen] = useState<string[]>([]);
  const [driverId, setDriverId] = useState('');
  const [helperId, setHelperId] = useState('');
  const [vehicle, setVehicle] = useState('');
  // A retry of the same trip keeps its key, so a lost answer never makes two. A changed trip gets a new one.
  const attempt = useRef({ sent: '', key: '' });
  const orders = ready.data?.items ?? [];
  // An order someone else just put on a trip drops off here, rather than failing the whole trip later.
  const stops = chosen
    .map((id) => orders.find((order) => order.id === id))
    .filter((order): order is ReadyOrder => !!order);
  const people = drivers.data?.items ?? [];
  const canDrive = people.filter((person) => person.role === 'DRIVER');
  const driver = canDrive.find((person) => person.id === driverId);
  const helpers = people.filter((person) => person.id !== driverId);
  const create = useAction(async () => {
    const body = {
      locationId,
      driverId,
      ...(helperId ? { helperId } : {}),
      ...(vehicle.trim() ? { vehicle: vehicle.trim() } : {}),
      orderIds: stops.map((stop) => stop.id),
    };
    const sent = JSON.stringify(body);
    if (attempt.current.sent !== sent) attempt.current = { sent, key: crypto.randomUUID() };
    await api('/admin/trips', 'POST', { ...body, idempotencyKey: attempt.current.key });
    attempt.current = { sent: '', key: '' };
    setChosen([]);
    setVehicle('');
    setHelperId('');
    notice(t('owner.trips.created', { name: driver?.name ?? '' }));
  }, [tripsKey]);
  const toggle = (id: string) => {
    if (create.error) create.reset();
    setChosen(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id]);
  };
  const move = (index: number, step: -1 | 1) =>
    setChosen(
      moved(
        stops.map((stop) => stop.id),
        index,
        step,
      ),
    );
  return (
    <section className={css.stack} aria-label={t('owner.trips.new')}>
      <h2>{t('owner.trips.new')}</h2>
      <QueryStatus query={ready} />
      {ready.data && !orders.length && <EmptyState title={t('owner.trips.noOrders')} />}
      {!!orders.length && (
        <fieldset className={`${css.formFieldset} ${own.orderPick}`}>
          <legend className={css.hint}>{t('owner.trips.pickOrders')}</legend>
          {orders.map((order) => (
            <label className={css.check} key={order.id}>
              <input
                type="checkbox"
                checked={chosen.includes(order.id)}
                disabled={!chosen.includes(order.id) && stops.length >= maxStops}
                onChange={() => toggle(order.id)}
              />
              <span>
                <strong>{order.number}</strong> ·{' '}
                {[order.name, order.area].filter(Boolean).join(', ')}
                <br />
                <span className={css.hint}>
                  {order.items
                    .map((item) => `${item.quantity} ${item.unit} ${item.name}`)
                    .join(', ')}
                  {' · '}
                  {dayLabel(order.deliveryDate, language)}
                  {' · '}
                  {t(order.loaded ? 'owner.trips.loaded' : 'owner.trips.notLoaded')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {stops.length > 0 && (
        <form
          className={css.card}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(undefined);
          }}
        >
          <h3>{t('owner.trips.stopOrder')}</h3>
          <ol className={own.events}>
            {stops.map((stop, index) => (
              <li key={stop.id} className={own.stopRow}>
                <span>
                  {index + 1}. {stop.number}
                  {stop.area && ` · ${stop.area}`}
                </span>
                <span className={own.stopMoves}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={index === 0}
                    aria-label={t('owner.trips.moveUp', { number: stop.number })}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={18} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={index === stops.length - 1}
                    aria-label={t('owner.trips.moveDown', { number: stop.number })}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={18} aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          {stops.some((stop) => !stop.loaded) && (
            <p className={own.lookBlock} role="status">
              {t('owner.trips.loadFirst')}
            </p>
          )}
          <QueryStatus query={drivers} />
          {drivers.data && !canDrive.length && <p>{t('owner.trips.noDrivers')}</p>}
          {!!canDrive.length && (
            <>
              <Field label={t('owner.trips.driver')}>
                <select
                  required
                  value={driverId}
                  onChange={(event) => {
                    setDriverId(event.target.value);
                    if (event.target.value === helperId) setHelperId('');
                  }}
                >
                  <option value="">{t('owner.trips.choose')}</option>
                  {canDrive.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Field>
              {helpers.length > 0 && (
                <Field label={t('owner.trips.helper')}>
                  <select value={helperId} onChange={(event) => setHelperId(event.target.value)}>
                    <option value="">{t('owner.trips.noHelper')}</option>
                    {helpers.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label={t('owner.trips.vehicle')}>
                <input
                  maxLength={30}
                  value={vehicle}
                  onChange={(event) => setVehicle(event.target.value)}
                />
              </Field>
              <Button className={css.wide} disabled={create.isPending || !driverId}>
                {t('owner.trips.create', { count: stops.length })}
              </Button>
            </>
          )}
        </form>
      )}
      {/* Outside the form: a refused order drops off the list, and takes the form with it if it was
          the only one, but the reason still has to be read. */}
      <Problem error={create.error} />
    </section>
  );
}

function TripCard({ trip }: { trip: TripRow }) {
  const t = useT();
  const { language } = useLanguage();
  const { confirm, notice } = useOwner();
  const cancel = useAction(async () => {
    try {
      await api(`/admin/trips/${enc(trip.id)}/cancel`, 'POST', {});
      notice(t('owner.trips.cancelled'));
    } catch (error) {
      // It left, or someone else cancelled it, while this card was on the screen.
      if (error instanceof ApiError && error.code === 'TRIP_DONE')
        notice(t('owner.trips.cantCancel'));
      else throw error;
    }
  }, [tripsKey]);
  return (
    <article className={css.card}>
      <div className={css.row}>
        <h3>
          {trip.driverName}
          {trip.vehicle && ` · ${trip.vehicle}`}
        </h3>
        <StatusPill
          tone={trip.status === 'DONE' ? 'green' : trip.status === 'OUT' ? 'blue' : 'neutral'}
          label={t(`owner.trips.status.${trip.status}` as MessageKey)}
        />
      </div>
      <p className={css.sub}>{momentLabel(trip.startedAt ?? trip.createdAt, language)}</p>
      <ol className={own.tripStops}>
        {trip.stops.map((stop) => (
          <li key={stop.id}>
            <span>
              {stop.number}
              {stop.area && ` · ${stop.area}`}
            </span>
            <span className={own.stopState}>
              {t(`owner.trips.stop.${stop.status}` as MessageKey)}
              {stop.problem && `: ${t(`owner.trips.problem.${stop.problem}` as MessageKey)}`}
            </span>
          </li>
        ))}
      </ol>
      {trip.status === 'PLANNED' && (
        <div className={css.actions}>
          <Button
            variant="secondary"
            disabled={cancel.isPending}
            onClick={async () => {
              if (
                await confirm({
                  title: t('owner.trips.cancelTitle'),
                  body: t('owner.trips.cancelBody', { name: trip.driverName }),
                  confirmLabel: t('owner.trips.cancel'),
                })
              )
                cancel.mutate(undefined);
            }}
          >
            {t('owner.trips.cancel')}
          </Button>
        </div>
      )}
      <Problem error={cancel.error} />
    </article>
  );
}

/** Which orders go on which truck today. The driver's phone shows the rest. */
export function Trips() {
  const t = useT();
  const { can, shops, shopId } = useOwner();
  const mine = shops.filter((shop) => can('trip.assign', shop.id));
  const [picked, setPicked] = useState('');
  const fromTop = shopId && mine.some((shop) => shop.id === shopId) ? shopId : '';
  const locationId = fromTop || picked || mine[0]?.id || '';
  const trips = useQuery({
    enabled: !!locationId,
    queryKey: [...tripsKey, 'list', locationId],
    queryFn: () => api<{ items: TripRow[] }>(`/admin/trips?locationId=${enc(locationId)}`),
    refetchInterval: 30000,
  });
  return (
    <>
      <PageHeader title={t('owner.trips.title')} />
      <div className={css.stack}>
        {!fromTop && mine.length > 1 && (
          <Field label={t('owner.whichShop')}>
            <select value={locationId} onChange={(event) => setPicked(event.target.value)}>
              {mine.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {locationId && <NewTrip key={locationId} locationId={locationId} />}
        <section className={css.stack} aria-label={t('owner.trips.today')}>
          <h2>{t('owner.trips.today')}</h2>
          <QueryStatus query={trips} />
          {trips.data && !trips.data.items.length && (
            <EmptyState title={t('owner.trips.noTrips')} />
          )}
          {trips.data?.items.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </section>
      </div>
    </>
  );
}
