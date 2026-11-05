import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  fetchFresh,
  keepPhoto,
  newId,
  now,
  readFixForStep,
  runStep,
  useApp,
  type StepResult,
} from '../core';
import {
  cashWithYou,
  handoverDifference,
  mapLink,
  nextStop,
  parseRupees,
  rupees,
  rupeesInput,
  stopAddress,
  stopFigure,
  telLink,
  tripStage,
  withQueue,
  type CashState,
  type Stop,
  type StopView,
  type Trip,
} from '../logic/kaam';
import { timeText } from '../logic/time';
import { useNav } from '../nav';
import { openLink } from '../platform/links';
import { askLocation } from '../platform/location';
import { Band, Btn, Card, Choice, Field, Row, Screen, Tag, Txt, useOnce } from '../ui';
import { space } from '../ui/tokens';
import { BackBtn, Bands, TabBar, TopBar, Waiting } from './shell';
import { ItemsList, StepFlood } from './stock';

function useTrips() {
  const { entries } = useApp();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const load = useCallback(() => {
    void fetchFresh<{ items: Trip[] }, Trip[]>(
      'trips',
      'staff/trips/mine',
      (reply) => reply.items,
    ).then((result) => setTrips(result.value ?? []));
  }, []);
  useEffect(load, [load]);
  return { trips: trips === null ? null : withQueue(trips, entries), load };
}
function useCash() {
  const [cash, setCash] = useState<CashState | null>(null);
  const load = useCallback(() => {
    void fetchFresh<CashState>('cash', 'staff/cash').then((result) => setCash(result.value));
  }, []);
  useEffect(load, [load]);
  return { cash, load };
}

function figureWords(
  stop: Pick<Stop, 'collectPaise' | 'onCredit'>,
  tr: ReturnType<typeof useApp>['tr'],
) {
  const figure = stopFigure(stop);
  if (figure.kind === 'collect') return tr('staff.stop.collect', { amount: rupees(figure.paise) });
  return tr(figure.kind === 'udhaar' ? 'staff.stop.udhaar' : 'staff.stop.nothing');
}

export function TripHome({ tabs }: { tabs?: boolean }) {
  const { tr, entries } = useApp();
  const nav = useNav();
  const { trips, load } = useTrips();
  const { cash } = useCash();
  const [result, setResult] = useState<{ step: StepResult; time: string } | null>(null);
  const { busy, once } = useOnce();
  useEffect(() => {
    void askLocation();
  }, []);
  const held = cashWithYou(cash, entries);
  const trip =
    trips?.find((row) => row.stops.some((stop) => stop.status === 'PENDING')) ?? trips?.[0];
  const cashRow = (
    <Btn
      testID="trip-cash"
      kind="quiet"
      icon="rupee"
      label={`${tr('staff.trip.cash')}: ${rupees(held.holdingPaise)}`}
      onPress={() => nav.push('cash')}
    />
  );
  const leave = async () => {
    if (!trip) return;
    // Location is read at this tap, and only at this tap.
    const fields = await readFixForStep();
    const key = newId();
    const step = await runStep({
      id: key,
      kind: 'tripStart',
      method: 'POST',
      path: `staff/trips/${trip.id}/start`,
      body: { idempotencyKey: key, ...fields },
      claimsAge: true,
    });
    const at = now();
    setResult({ step, time: at === null ? '' : timeText(at) });
    load();
  };
  if (result)
    return (
      <StepFlood
        result={result.step}
        title={result.time ? tr('staff.trip.left', { time: result.time }) : tr('staff.trip.leave')}
        lines={[tr('staff.trip.leftLine')]}
        onDone={() => setResult(null)}
      />
    );
  if (trips === null)
    return (
      <Screen
        testID="screen-trip"
        top={<TopBar />}
        band={<Bands />}
        {...(tabs ? { tabs: <TabBar /> } : {})}
      >
        <Txt kind="head">{tr('staff.trip.title')}</Txt>
        <Waiting />
      </Screen>
    );
  if (!trip)
    return (
      <Screen
        testID="screen-trip"
        top={<TopBar />}
        band={<Bands />}
        {...(tabs ? { tabs: <TabBar /> } : {})}
        footer={cashRow}
      >
        <Txt kind="head">{tr('staff.trip.title')}</Txt>
        <Txt testID="trip-empty">{tr('staff.trip.empty')}</Txt>
      </Screen>
    );
  const stage = tripStage(trip);
  const next = nextStop(trip);
  return (
    <Screen
      testID="screen-trip"
      top={<TopBar />}
      band={<Bands />}
      {...(tabs ? { tabs: <TabBar /> } : {})}
      footer={
        <>
          {stage === 'LEAVE' ? (
            <Btn
              testID="trip-leave"
              kind="lamp"
              icon="truck"
              label={tr('staff.trip.leave')}
              disabled={busy}
              onPress={() => once(leave)}
            />
          ) : null}
          {stage === 'ON_ROAD' && next ? (
            <Btn
              testID="trip-next"
              kind="lamp"
              icon="chevron-right"
              label={tr('staff.trip.next')}
              // While leaving is being sent, a second tap must not land on this.
              disabled={busy}
              onPress={() => nav.push('stop', { stop: next })}
            />
          ) : null}
          {cashRow}
        </>
      }
    >
      <Txt kind="head">{tr('staff.trip.title')}</Txt>
      {trip.vehicle ? (
        <Txt kind="small">{tr('staff.trip.vehicle', { vehicle: trip.vehicle })}</Txt>
      ) : null}
      {trip.waiting ? (
        <Tag testID="trip-not-sent" tone="warn" text={tr('staff.common.notSent')} />
      ) : null}
      {stage === 'NOT_LOADED' ? (
        <Band testID="trip-not-loaded" text={tr('staff.trip.notLoaded')} />
      ) : null}
      {stage === 'FINISHED' ? (
        <Tag testID="trip-finished" tone="ok" text={tr('staff.trip.finished')} />
      ) : null}
      {trip.stops.map((stop) => (
        <StopRow key={stop.id} stop={stop} open={stage === 'ON_ROAD'} />
      ))}
    </Screen>
  );
}
function StopRow({ stop, open }: { stop: StopView; open: boolean }) {
  const { tr } = useApp();
  const nav = useNav();
  if (stop.status !== 'PENDING')
    return (
      <Card quiet testID={`stop-row-${stop.sequence}`}>
        <Txt>
          {stop.sequence}. {stop.area || stop.line1}
        </Txt>
        <Tag
          tone={stop.waiting ? 'warn' : stop.status === 'DELIVERED' ? 'ok' : 'warn'}
          text={
            stop.waiting
              ? tr('staff.common.notSent')
              : tr(stop.status === 'DELIVERED' ? 'staff.trip.delivered' : 'staff.trip.problem')
          }
        />
      </Card>
    );
  const label = `${stop.sequence}. ${stop.area || stop.line1}`;
  const detail = `${stop.name}. ${figureWords(stop, tr)}`;
  if (!open)
    return (
      <Card testID={`stop-row-${stop.sequence}`}>
        <Txt>{label}</Txt>
        <Txt kind="small">{detail}</Txt>
      </Card>
    );
  return (
    <Choice
      testID={`stop-row-${stop.sequence}`}
      label={label}
      detail={detail}
      icon="map-pin"
      onPress={() => nav.push('stop', { stop })}
    />
  );
}

export function StopScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const stop = params?.stop as StopView;
  return (
    <Screen
      testID="screen-stop"
      top={<TopBar />}
      band={<Bands />}
      footer={
        <>
          <Btn
            testID="stop-reached"
            kind="lamp"
            label={tr('staff.stop.reached')}
            onPress={() => nav.push('delivered', { stop })}
          />
          <Row>
            <Btn
              testID="stop-problem"
              flex
              kind="quiet"
              label={tr('staff.stop.problem')}
              onPress={() => nav.push('stopProblem', { stop })}
            />
            <Btn
              testID="back"
              flex
              kind="quiet"
              icon="chevron-left"
              label={tr('staff.common.back')}
              onPress={() => nav.pop()}
            />
          </Row>
        </>
      }
    >
      <Txt kind="head" testID="stop-name">
        {stop.name}
      </Txt>
      <Txt kind="head" testID="stop-address">
        {stopAddress(stop)}
      </Txt>
      <Row>
        {stop.phone ? (
          <Btn
            testID="stop-call"
            flex
            kind="line"
            icon="phone"
            label={tr('staff.stop.call')}
            onPress={() => openLink(telLink(stop.phone))}
          />
        ) : null}
        <Btn
          testID="stop-map"
          flex
          kind="line"
          icon="map"
          label={tr('staff.stop.map')}
          onPress={() => openLink(mapLink(stop))}
        />
      </Row>
      <ItemsList items={stop.items} />
      <Txt kind="number" testID="stop-figure">
        {figureWords(stop, tr)}
      </Txt>
    </Screen>
  );
}

const skipReasons = ['dark', 'phone', 'refused'] as const;
export function DeliveredScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const stop = params?.stop as StopView;
  const figure = stopFigure(stop);
  const due = figure.kind === 'collect' ? figure.paise : 0;
  const [amount, setAmount] = useState(due ? rupeesInput(due) : '');
  const [channel, setChannel] = useState<'CASH' | 'UPI'>('CASH');
  const [photo, setPhoto] = useState<string | null>(null);
  const [skip, setSkip] = useState<(typeof skipReasons)[number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, once } = useOnce();
  const [result, setResult] = useState<{ step: StepResult; time: string; lines: string[] } | null>(
    null,
  );
  const typed = parseRupees(amount);
  const diff = due && typed !== null ? typed - due : 0;
  const save = async () => {
    if (due && typed === null) return setError(tr('staff.stop.needMoney'));
    if (!photo && !skip) return setError(tr('staff.stop.needProof'));
    setError(null);
    const fields = await readFixForStep();
    const key = newId();
    const kept = photo ? await keepPhoto(photo).catch(() => null) : null;
    const skipWords = skip ? tr(`staff.stop.skip.${skip}`) : tr('staff.photo.failed');
    const step = await runStep({
      id: key,
      kind: 'delivered',
      method: 'POST',
      path: `staff/stops/${stop.id}/delivered`,
      body: {
        idempotencyKey: key,
        ...fields,
        ...(due ? { collected: { amountPaise: typed, channel } } : {}),
        ...(kept ? {} : { skipReason: skipWords.slice(0, 120) }),
      },
      claimsAge: true,
      ...(kept
        ? {
            photo: {
              uri: kept,
              kind: 'DELIVERY_PHOTO' as const,
              // A photo that is refused must not lose the delivery.
              fallback: { skipReason: tr('staff.photo.failed').slice(0, 120) },
            },
          }
        : {}),
    });
    const at = now();
    const money =
      due && typed
        ? [
            channel === 'CASH'
              ? tr('staff.stop.withYou', { amount: rupees(typed) })
              : tr('staff.stop.upiLine', { amount: rupees(typed) }),
          ]
        : [];
    setResult({ step, time: at === null ? '' : timeText(at), lines: money });
  };
  if (result)
    return (
      <StepFlood
        result={result.step}
        title={
          result.time ? tr('staff.stop.doneTitle', { time: result.time }) : tr('staff.stop.reached')
        }
        lines={result.lines}
        onDone={() => nav.home()}
      />
    );
  return (
    <Screen
      testID="screen-delivered"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="delivered-save"
            kind="lamp"
            label={tr('staff.stop.save')}
            disabled={busy}
            onPress={() => once(save)}
          />
          <BackBtn />
        </>
      }
    >
      {due ? (
        <>
          <Txt kind="head">{tr('staff.stop.moneyTitle')}</Txt>
          <Txt kind="small">{tr('staff.stop.due', { amount: rupees(due) })}</Txt>
          <Field
            testID="money-input"
            label="₹"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            maxLength={12}
            style={{ fontSize: 28 }}
          />
          <Row>
            <Choice
              testID="money-cash"
              flex
              label={tr('staff.stop.cash')}
              chosen={channel === 'CASH'}
              onPress={() => setChannel('CASH')}
            />
            <Choice
              testID="money-upi"
              flex
              label={tr('staff.stop.upi')}
              chosen={channel === 'UPI'}
              onPress={() => setChannel('UPI')}
            />
          </Row>
          {diff ? (
            <Band
              testID="money-diff"
              text={tr(diff < 0 ? 'staff.stop.less' : 'staff.stop.more', {
                amount: rupees(Math.abs(diff)),
              })}
            />
          ) : null}
        </>
      ) : (
        <Txt kind="head">{figureWords(stop, tr)}</Txt>
      )}
      <Choice
        testID="delivered-photo"
        icon="camera"
        label={tr('staff.stop.photo')}
        chosen={Boolean(photo)}
        {...(photo ? { detail: tr('staff.photo.added') } : {})}
        onPress={() =>
          nav.push('photo', {
            title: tr('staff.stop.photo'),
            facing: 'back',
            onDone: (uri: string) => {
              setPhoto(uri);
              setSkip(null);
            },
          })
        }
      />
      {photo ? null : (
        <View style={{ gap: space.sm }}>
          <Txt>{tr('staff.stop.skipTitle')}</Txt>
          {skipReasons.map((key) => (
            <Choice
              key={key}
              testID={`skip-${key}`}
              label={tr(`staff.stop.skip.${key}`)}
              chosen={skip === key}
              onPress={() => setSkip(key)}
            />
          ))}
        </View>
      )}
      {error ? <Band testID="form-error" tone="danger" text={error} /> : null}
    </Screen>
  );
}

const stopProblems = ['NO_ACCESS', 'CUSTOMER_ABSENT', 'SHORT_TAKEN', 'OTHER'] as const;
export function StopProblemScreen({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const stop = params?.stop as StopView;
  const [problem, setProblem] = useState<(typeof stopProblems)[number] | null>(null);
  const [note, setNote] = useState('');
  const { busy, once } = useOnce();
  const [result, setResult] = useState<StepResult | null>(null);
  const send = async () => {
    if (!problem) return;
    const fields = await readFixForStep();
    const key = newId();
    setResult(
      await runStep({
        id: key,
        kind: 'stopProblem',
        method: 'POST',
        path: `staff/stops/${stop.id}/problem`,
        body: {
          idempotencyKey: key,
          problem,
          ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
          ...fields,
        },
        claimsAge: true,
      }),
    );
  };
  if (result)
    return (
      <StepFlood
        result={result}
        title={tr('staff.stop.problemSent')}
        amberWhenSent
        onDone={() => nav.home()}
      />
    );
  return (
    <Screen
      testID="screen-stop-problem"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="stop-problem-send"
            kind="lamp"
            label={tr('staff.damage.send')}
            disabled={busy || !problem}
            onPress={() => once(send)}
          />
          <BackBtn />
        </>
      }
    >
      <Txt kind="head">{tr('staff.stop.problemTitle')}</Txt>
      {stopProblems.map((key) => (
        <Choice
          key={key}
          testID={`stop-problem-${key}`}
          label={tr(`staff.stop.problem.${key}`)}
          chosen={problem === key}
          onPress={() => setProblem(key)}
        />
      ))}
      <Field
        testID="stop-problem-note"
        label={tr('staff.stop.problemNote')}
        value={note}
        onChangeText={setNote}
        maxLength={200}
      />
    </Screen>
  );
}

export function CashScreen() {
  const { tr, entries } = useApp();
  const nav = useNav();
  const { cash, load } = useCash();
  const held = cashWithYou(cash, entries);
  const [amount, setAmount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busy, once } = useOnce();
  const [result, setResult] = useState<StepResult | null>(null);
  const typed = amount ?? (held.holdingPaise ? rupeesInput(held.holdingPaise) : '');
  const give = async () => {
    const paise = parseRupees(typed);
    if (!paise) return setError(tr('staff.stop.needMoney'));
    setError(null);
    const key = newId();
    setResult(
      await runStep({
        id: key,
        kind: 'handover',
        method: 'POST',
        path: 'staff/cash/handover',
        body: { amountPaise: paise, handoverKey: key },
        claimsAge: false,
      }),
    );
    load();
  };
  if (result)
    return (
      <StepFlood
        result={result}
        title={tr('staff.cash.waiting')}
        lines={[tr('staff.cash.waitingLine')]}
        amberWhenSent
        onDone={() => setResult(null)}
      />
    );
  const last = cash?.handovers[0];
  const difference = last ? handoverDifference(last) : null;
  return (
    <Screen
      testID="screen-cash"
      top={<TopBar />}
      band={<Bands />}
      footer={
        <>
          {held.holdingPaise > 0 ? (
            <Btn
              testID="cash-give"
              kind="lamp"
              label={tr('staff.cash.give')}
              disabled={busy}
              onPress={() => once(give)}
            />
          ) : null}
          <BackBtn onPress={() => nav.pop()} />
        </>
      }
    >
      {cash === null && !held.holdingPaise ? <Waiting /> : null}
      {held.holdingPaise > 0 ? (
        <>
          <Txt kind="head">{tr('staff.cash.title')}</Txt>
          <Txt kind="number" testID="cash-figure">
            {rupees(held.holdingPaise)}
          </Txt>
          <Txt>{tr('staff.cash.handIn')}</Txt>
          {held.waiting ? <Tag tone="warn" text={tr('staff.common.notSent')} /> : null}
          <Field
            testID="cash-amount"
            label={tr('staff.cash.giveTitle')}
            keyboardType="decimal-pad"
            value={typed}
            onChangeText={setAmount}
            maxLength={12}
            style={{ fontSize: 28 }}
            error={error}
          />
        </>
      ) : cash !== null ? (
        <>
          <Txt kind="head" testID="cash-none">
            {tr('staff.cash.none')}
          </Txt>
          {held.waiting ? <Tag tone="warn" text={tr('staff.common.notSent')} /> : null}
        </>
      ) : null}
      {last?.status === 'WAITING' ? (
        <Card testID="handover-waiting">
          <Tag tone="warn" text={tr('staff.cash.waiting')} />
          <Txt kind="small">{rupees(last.offeredPaise)}</Txt>
          <Txt kind="small">{tr('staff.cash.waitingLine')}</Txt>
        </Card>
      ) : null}
      {last?.status === 'DIFFERENT' ? (
        <Card testID="handover-different">
          <Tag
            tone="warn"
            text={
              difference
                ? tr('staff.cash.different', { amount: rupees(difference) })
                : tr('staff.cash.differentPlain')
            }
          />
          <Txt kind="small">
            {tr('staff.cash.differentLine', {
              said: rupees(last.offeredPaise),
              counted: rupees(last.countedPaise ?? 0),
            })}
          </Txt>
        </Card>
      ) : null}
      {last?.status === 'DONE' ? (
        <Card quiet testID="handover-done">
          <Tag tone="ok" text={tr('staff.cash.done')} />
          <Txt kind="small">
            {tr('staff.cash.doneLine', { amount: rupees(last.countedPaise ?? last.offeredPaise) })}
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}
