import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  getApp,
  flush,
  keepPhoto,
  newId,
  now,
  readFixForStep,
  refreshToday,
  runStep,
  startLooking,
  useApp,
  type StepResult,
} from '../core';
import { hazriView, firstName } from '../logic/hazri';
import { dayText, hoursWords, istDay, timeText } from '../logic/time';
import { useNav } from '../nav';
import { openLocationSwitch, openSettings } from '../platform/location';
import { Band, Btn, Choice, Flood, Row, Screen, Tag, Txt } from '../ui';
import { colors, space } from '../ui/tokens';
import { Bands, BackBtn, TabBar, TopBar, useServerClockTick } from './shell';

const problems = ['NO_QR', 'QR_WONT_SCAN', 'NO_LOCATION', 'WORKING_OUTSIDE'] as const;
const problemIcon = {
  NO_QR: 'qr',
  QR_WONT_SCAN: 'camera',
  NO_LOCATION: 'map-pin',
  WORKING_OUTSIDE: 'truck',
} as const;

export function ClockBlock() {
  const { tr, today } = useApp();
  useServerClockTick();
  const at = now();
  const shop = today?.shopName ?? today?.shops[0]?.name ?? '';
  return (
    <View>
      <Txt kind="number" testID="server-time">
        {at === null ? '--:--' : timeText(at)}
      </Txt>
      <Txt kind="small">
        {at === null
          ? tr('staff.time.unknown')
          : `${dayText(istDay(at), tr)}${shop ? `. ${shop}` : ''}.`}
      </Txt>
      {at === null ? null : <Txt kind="small">{tr('staff.time.server')}</Txt>}
    </View>
  );
}

function LocationBand() {
  const { tr, fix } = useApp();
  if (fix.status !== 'DENIED' && fix.status !== 'GPS_OFF' && fix.status !== 'APPROXIMATE')
    return null;
  const words =
    fix.status === 'DENIED'
      ? tr('staff.hazri.locationBlocked')
      : fix.status === 'GPS_OFF'
        ? tr('staff.hazri.gpsOff')
        : tr('staff.hazri.approximate');
  return (
    <Band
      testID="location-band"
      icon="map-pin"
      text={words}
      action={{
        testID: 'open-settings',
        label: tr('staff.common.settings'),
        onPress: () => void (fix.status === 'GPS_OFF' ? openLocationSwitch() : openSettings()),
      }}
    />
  );
}

export function HazriHome() {
  const app = useApp();
  const { tr, today, entries } = app;
  const nav = useNav();
  useServerClockTick();
  useEffect(() => startLooking(), []);
  useEffect(() => {
    void refreshToday().catch(() => {});
  }, []);
  const view = hazriView(today, now(), entries);
  const name = today ? firstName(today.user.name) : '';
  const scan = () => nav.push('scan', { mode: view.next });
  const doneForToday = view.status === 'done';
  const blocked = ['DENIED', 'GPS_OFF', 'APPROXIMATE'].includes(app.fix.status);
  const crowded = app.offline || app.failures.length > 0 || blocked || view.stale;
  return (
    <Screen
      testID="screen-hazri"
      top={<TopBar />}
      band={
        <>
          <Bands />
          <LocationBand />
        </>
      }
      tabs={<TabBar />}
      footer={
        <>
          <Btn
            testID="hazri-main"
            kind={doneForToday ? 'line' : 'lamp'}
            icon="qr"
            label={tr(view.next === 'IN' ? 'staff.hazri.markIn' : 'staff.hazri.markOut')}
            onPress={scan}
          />
          <Row>
            <Btn
              testID="hazri-problem"
              flex
              kind="quiet"
              label={tr('staff.hazri.problem')}
              onPress={() => nav.push('problem')}
            />
            <Btn
              testID="hazri-record"
              flex
              kind={doneForToday ? 'lamp' : 'quiet'}
              icon="calendar"
              label={tr('staff.hazri.record')}
              onPress={() => nav.push('record')}
            />
          </Row>
        </>
      }
    >
      <ClockBlock />
      {view.stale ? <Band testID="stale-day" text={tr('staff.hazri.lastKnown')} /> : null}
      {/* With a band taking the room, the greeting goes and where they stand moves up to stay seen. */}
      {crowded ? <StatusWords /> : null}
      <View style={{ flexGrow: 1 }} />
      {!crowded && name ? <Txt kind="head">{tr('staff.hazri.hello', { name })}</Txt> : null}
      {crowded ? null : <StatusWords />}
    </Screen>
  );
}

function StatusWords() {
  const { tr, today, entries } = useApp();
  const view = hazriView(today, now(), entries);
  const came = view.firstInAt ? tr('staff.hazri.came', { time: timeText(view.firstInAt) }) : null;
  const left = view.lastOutAt ? tr('staff.hazri.left', { time: timeText(view.lastOutAt) }) : null;
  switch (view.status) {
    case 'waiting':
      return (
        <View testID="status-waiting" style={{ gap: space.xs }}>
          <Tag tone="warn" text={tr('staff.common.notSent')} />
          <Txt>{tr('staff.hazri.waitingLine')}</Txt>
          {came ? <Txt>{came}</Txt> : null}
        </View>
      );
    case 'review':
      return (
        <View testID="status-review" style={{ gap: space.xs }}>
          <Txt>{tr('staff.hazri.reviewTitle')}</Txt>
          {came ? <Tag tone="warn" text={came} /> : null}
          <Txt kind="small">{tr('staff.hazri.nothingToDo')}</Txt>
        </View>
      );
    case 'in':
      return (
        <View testID="status-in" style={{ gap: space.xs }}>
          <Txt>{tr('staff.hazri.in')}</Txt>
          {came ? <Tag tone="ok" text={came} /> : null}
          {view.lateMinutes > 0 ? (
            <Txt kind="small">{tr('staff.hazri.late', { minutes: view.lateMinutes })}</Txt>
          ) : null}
        </View>
      );
    case 'done':
      return (
        <View testID="status-done" style={{ gap: space.xs }}>
          <Txt>{tr('staff.hazri.doneTitle')}</Txt>
          {came ? <Tag tone="ok" text={came} /> : null}
          {left ? <Tag tone="ok" text={left} /> : null}
          {view.minutes !== null ? (
            <Txt kind="small">
              {tr('staff.hazri.worked', { time: hoursWords(view.minutes, tr) })}
            </Txt>
          ) : null}
        </View>
      );
    default:
      return (
        <View testID="status-none">
          <Txt>{tr('staff.hazri.notYet')}</Txt>
        </View>
      );
  }
}

export function ProblemScreen() {
  const { tr } = useApp();
  const nav = useNav();
  useEffect(() => startLooking(), []);
  const choose = (problem: (typeof problems)[number]) => {
    nav.push('photo', {
      title: tr('staff.problem.photoTitle'),
      line: tr('staff.problem.photoLine'),
      facing: 'front',
      skipLabel: tr('staff.problem.noPhoto'),
      next: { screen: 'problemSend', params: { problem } },
    });
  };
  return (
    <Screen testID="screen-problem" top={<TopBar />} footer={<BackBtn />}>
      <Txt kind="head">{tr('staff.problem.title')}</Txt>
      {problems.map((problem) => (
        <Choice
          key={problem}
          testID={`problem-${problem}`}
          icon={problemIcon[problem]}
          label={tr(`staff.problem.${problem}`)}
          onPress={() => choose(problem)}
        />
      ))}
    </Screen>
  );
}

/** Sends it and says where it stands. Saved or sent, the time is safe and a person will look. */
export function ProblemSend({ params }: { params?: Record<string, unknown> }) {
  const { tr } = useApp();
  const nav = useNav();
  const [result, setResult] = useState<StepResult | null>(null);
  useEffect(() => {
    void (async () => {
      const { today, entries } = getApp();
      const kind = hazriView(today, now(), entries).next;
      const fields = await readFixForStep();
      const photoUri = params?.photoUri as string | undefined;
      const id = newId();
      const shopId = today?.shops[0]?.id;
      const kept = photoUri ? await keepPhoto(photoUri).catch(() => null) : null;
      const reply = await runStep({
        id,
        kind: 'problem',
        method: 'POST',
        path: 'attendance/problem',
        body: { captureId: id, problem: params?.problem, kind, ...fields },
        claimsAge: true,
        ...(kept
          ? { photo: { uri: kept, kind: 'ATTENDANCE_PHOTO' as const, locationId: shopId } }
          : {}),
      });
      setResult(reply);
      void refreshToday().catch(() => {});
      void flush();
    })();
  }, []);
  if (!result)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.warnSoft,
          justifyContent: 'center',
          padding: space.lg,
        }}
      >
        <Txt kind="head">{tr('staff.common.wait')}</Txt>
      </View>
    );
  const ok = () => nav.home();
  const refused = result.how === 'refused' || result.how === 'notSaved';
  if (refused)
    return (
      <Flood
        tone="red"
        icon="alert-triangle"
        title={tr('staff.result.notSaved')}
        lines={[tr('staff.result.nothingSaved')]}
        actions={
          <Btn testID="flood-home" kind="white" label={tr('staff.common.ok')} onPress={ok} />
        }
      />
    );
  const at =
    result.how === 'sent' ? timeText((result.reply as { serverAt: string }).serverAt) : null;
  return (
    <Flood
      tone="amber"
      icon="clock"
      testID="flood-problem"
      title={result.how === 'sent' ? tr('staff.problem.sentTitle') : tr('staff.hazri.waitingTitle')}
      lines={
        result.how === 'sent'
          ? [
              ...(at ? [tr('staff.result.timeSaved', { time: at })] : []),
              tr('staff.problem.sentLine'),
            ]
          : [tr('staff.problem.savedLine')]
      }
      actions={<Btn testID="flood-home" kind="solid" label={tr('staff.common.ok')} onPress={ok} />}
    />
  );
}
