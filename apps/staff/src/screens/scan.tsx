import { useEffect, useReducer, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  fixForScan,
  newId,
  proveQr,
  punchEntry,
  refreshToday,
  runStep,
  startLooking,
  stopWatching,
  useApp,
  type StepResult,
} from '../core';
import { isNetworkError } from '../logic/api';
import { isShopQr, type PunchKind } from '../logic/capture';
import { punchOutcome, refusedOutcome, savedOutcome, type PunchReply } from '../logic/outcome';
import { scanStart, scanStep, slowAfterMs } from '../logic/scan';
import { useNav } from '../nav';
import { mono } from '../platform/device';
import { openSettings } from '../platform/location';
import { QrCamera, useCameraAccess } from '../platform/camera';
import { Band, Btn, Flood, Icon, Screen, Txt } from '../ui';
import { colors, radiusControl, space } from '../ui/tokens';
import { OutcomeFlood } from './flood';
import { BackBtn, TopBar } from './shell';

// Behind a build-time switch, so a production bundle does not contain it at all.
const PasteCode =
  process.env.EXPO_PUBLIC_STAFF_PASTE === '1'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../platform/paste') as typeof import('../platform/paste')).PasteCode
    : null;

/** The way through when the camera is blocked: the exact switch, and the Problem path. */
function CameraBlocked(props: { onProblem?: () => void; ask: boolean; onAsk: () => void }) {
  const { tr } = useApp();
  return (
    <Screen
      testID="screen-camera-blocked"
      top={<TopBar />}
      footer={
        <>
          {props.ask ? (
            <Btn
              testID="camera-ask"
              kind="lamp"
              icon="camera"
              label={tr('staff.scan.cameraOn')}
              onPress={props.onAsk}
            />
          ) : (
            <Btn
              testID="open-settings"
              kind="lamp"
              icon="settings"
              label={tr('staff.common.settings')}
              onPress={() => void openSettings()}
            />
          )}
          {props.onProblem ? (
            <Btn
              testID="camera-problem"
              kind="quiet"
              label={tr('staff.hazri.problem')}
              onPress={props.onProblem}
            />
          ) : null}
          <BackBtn />
        </>
      }
    >
      <Icon name="camera-off" size={48} />
      <Txt kind="head">{tr('staff.scan.cameraBlockedTitle')}</Txt>
      <Txt>{tr(props.ask ? 'staff.scan.cameraAsk' : 'staff.scan.cameraBlocked')}</Txt>
    </Screen>
  );
}

/** Shop's QR for a new phone. A proof, so it goes straight or not at all, and no hazri is made. */
function ProofScan() {
  const { tr } = useApp();
  const nav = useNav();
  const lock = useRef(false);
  const { access, ask } = useCameraAccess();
  const [problem, setProblem] = useState<'not-ours' | 'no-signal' | null>(null);
  const [torch, setTorch] = useState(false);
  const [paste, setPaste] = useState(false);
  const onCode = (text: string) => {
    if (lock.current) return;
    lock.current = true;
    if (!isShopQr(text)) {
      setProblem('not-ours');
      return;
    }
    proveQr(text)
      .then(() => nav.pop())
      .catch((error) => {
        setProblem(isNetworkError(error) ? 'no-signal' : 'not-ours');
      });
  };
  if (access === 'ask' || access === 'blocked')
    return <CameraBlocked ask={access === 'ask'} onAsk={ask} />;
  if (problem)
    return (
      <Flood
        tone="red"
        icon="alert-triangle"
        title={tr(problem === 'not-ours' ? 'staff.result.notOurQr' : 'staff.result.notSaved')}
        lines={[tr(problem === 'not-ours' ? 'staff.result.notOurQrLine' : 'staff.common.noSignal')]}
        actions={
          <Btn
            testID="flood-rescan"
            kind="white"
            label={tr('staff.result.rescan')}
            onPress={() => {
              lock.current = false;
              setProblem(null);
            }}
          />
        }
      />
    );
  return (
    <CameraFrame
      title={tr('staff.scan.titleProof')}
      torch={torch}
      onTorch={() => setTorch((value) => !value)}
      onPaste={() => setPaste(true)}
      showPaste={paste}
      onCode={onCode}
      active
    />
  );
}

function CameraFrame(props: {
  title: string;
  torch: boolean;
  onTorch(): void;
  onPaste(): void;
  showPaste: boolean;
  onCode(text: string): void;
  active: boolean;
  below?: string;
}) {
  const { tr } = useApp();
  const insets = useSafeAreaInsets();
  return (
    <View testID="screen-scan" style={{ flex: 1, backgroundColor: colors.night }}>
      <QrCamera onCode={props.onCode} torch={props.torch} active={props.active} />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            paddingTop: insets.top + space.sm,
            paddingBottom: Math.max(insets.bottom, space.lg),
            paddingHorizontal: space.lg,
            justifyContent: 'space-between',
          },
        ]}
      >
        <View style={{ paddingTop: space.xl, gap: space.md }}>
          <Txt
            kind="head"
            center
            color={colors.onNight}
            testID="scan-title"
            {...(PasteCode ? { onLongPress: props.onPaste } : {})}
          >
            {props.title}
          </Txt>
          {PasteCode && props.showPaste ? <PasteCode tr={tr} onCode={props.onCode} /> : null}
        </View>
        <View
          pointerEvents="none"
          style={{
            alignSelf: 'center',
            width: 240,
            height: 240,
            borderWidth: 3,
            borderColor: colors.diya,
            borderRadius: radiusControl,
          }}
        />
        <View style={{ gap: space.sm }}>
          {props.below ? (
            <View
              style={{
                backgroundColor: colors.nightUp,
                padding: space.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.sm,
              }}
            >
              <Icon name="map-pin" size={20} color={colors.onNight} />
              <Txt color={colors.onNight} style={{ flex: 1 }}>
                {props.below}
              </Txt>
            </View>
          ) : null}
          <Btn
            testID="torch"
            kind="line"
            icon={props.torch ? 'zap-off' : 'zap'}
            label={tr('staff.scan.torch')}
            on={colors.onNight}
            onPress={props.onTorch}
          />
          <BackBtn />
        </View>
      </View>
    </View>
  );
}

/** Scanning for hazri. Saved on the phone first, then sent; the answer may come at any time. */
function HazriScan({ kind }: { kind: PunchKind }) {
  const app = useApp();
  const { tr, today } = app;
  const nav = useNav();
  const [state, dispatch] = useReducer(scanStep, scanStart);
  const { access, ask } = useCameraAccess();
  const [torch, setTorch] = useState(false);
  const [paste, setPaste] = useState(false);
  const lock = useRef(false);
  const capture = useRef<string | null>(null);
  const arrivedAt = useRef(today?.arrivedAt ?? null);
  useEffect(() => startLooking(), []);
  useEffect(
    () => () => {
      if (capture.current) stopWatching(capture.current);
    },
    [],
  );
  const onStep = (id: string, result: StepResult) => {
    if (result.how === 'sent') {
      const reply = result.reply as PunchReply;
      dispatch({ type: 'ANSWER', captureId: id, reply, result: reply.result });
      void refreshToday().catch(() => {});
    } else if (result.how === 'refused')
      dispatch({ type: 'REFUSED', captureId: id, code: result.code });
    else if (result.how === 'notSaved') dispatch({ type: 'SAVE_FAILED' });
    else if (result.why === 'offline') dispatch({ type: 'NO_SIGNAL', captureId: id });
    else dispatch({ type: 'TIMER', captureId: id });
  };
  const onCode = (text: string) => {
    if (lock.current) return;
    lock.current = true;
    dispatch({ type: 'CODE', text });
    if (!isShopQr(text)) return;
    void (async () => {
      const started = mono();
      const fix = await fixForScan();
      const id = newId();
      capture.current = id;
      dispatch({ type: 'SAVED', captureId: id });
      const left = Math.max(slowAfterMs - (mono() - started), 0);
      const result = await runStep(punchEntry(id, text, kind, fix), {
        waitMs: left,
        keepWatching: (late) => onStep(id, late),
      });
      onStep(id, result);
    })();
  };
  if (access === 'ask' || access === 'blocked')
    return (
      <CameraBlocked ask={access === 'ask'} onAsk={ask} onProblem={() => nav.replace('problem')} />
    );
  if (state.step === 'shown') {
    const again = () => {
      lock.current = false;
      capture.current = null;
      dispatch({ type: 'AGAIN' });
    };
    const on = {
      home: () => {
        void refreshToday().catch(() => {});
        nav.pop();
      },
      rescan: again,
      problem: () => nav.replace('problem'),
      settings: () => void openSettings(),
      relink: () => nav.home(),
    };
    const shown = state.shown;
    const outcome =
      shown.kind === 'answered'
        ? punchOutcome(shown.reply as PunchReply, tr, {
            retriesInARow: state.retries,
            arrivedAt: arrivedAt.current,
          })
        : shown.kind === 'saved'
          ? savedOutcome(tr, shown.why)
          : refusedOutcome(shown.code, tr);
    return <OutcomeFlood outcome={outcome} on={on} />;
  }
  const below =
    app.fix.status === 'DENIED'
      ? tr('staff.result.why.locationOff')
      : app.fix.has
        ? tr('staff.scan.locationFound')
        : tr('staff.scan.locationNone');
  return (
    <>
      <CameraFrame
        title={tr(kind === 'IN' ? 'staff.scan.titleIn' : 'staff.scan.titleOut')}
        torch={torch}
        onTorch={() => setTorch((value) => !value)}
        onPaste={() => setPaste(true)}
        showPaste={paste}
        onCode={onCode}
        active={state.step === 'looking'}
        below={below}
      />
      {state.step === 'looking' ? null : (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', padding: space.lg }]}>
          <Band text={tr('staff.scan.reading')} />
        </View>
      )}
    </>
  );
}

export function ScanScreen({ params }: { params?: Record<string, unknown> }) {
  const mode = params?.mode as 'IN' | 'OUT' | 'PROOF';
  if (mode === 'PROOF') return <ProofScan />;
  return <HazriScan kind={mode} />;
}
