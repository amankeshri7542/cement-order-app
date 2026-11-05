import { useEffect, useState } from 'react';
import { View } from 'react-native';
import {
  acceptNotice,
  backToNumber,
  refreshLink,
  reportLost,
  requestCode,
  setReason,
  startAgain,
  useApp,
  verifyCode,
  yoursSeen,
} from '../core';
import { ApiError } from '../logic/api';
import { fullPhone, mustWait, signInError, validCode } from '../logic/link';
import { useNav } from '../nav';
import { Band, Btn, Choice, Field, Flood, Icon, Screen, Tag, Txt, useOnce } from '../ui';
import { colors, space } from '../ui/tokens';
import { TopBar } from './shell';

const reasonKeys = ['broken', 'lost', 'changed'] as const;

export function NumberScreen() {
  const { tr, reason } = useApp();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(false);
  const { busy, once } = useOnce();
  const [newPhone, setNewPhone] = useState(false);
  const go = async () => {
    const full = fullPhone(phone);
    if (!full) {
      setError(tr('staff.link.errNumber'));
      return;
    }
    setError(null);
    try {
      await requestCode(full);
    } catch (problem) {
      const code = problem instanceof ApiError ? problem.code : 'NETWORK';
      setError(tr(signInError(code)));
      setWait(mustWait(code));
    }
  };
  return (
    <Screen
      testID="screen-number"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="number-next"
            kind="lamp"
            label={tr('staff.link.next')}
            disabled={busy}
            onPress={() => once(go)}
          />
          <Btn
            testID="new-phone"
            kind="quiet"
            label={tr('staff.link.newPhone')}
            onPress={() => setNewPhone((value) => !value)}
          />
        </>
      }
    >
      <Txt kind="head">{tr('staff.link.numberTitle')}</Txt>
      <Field
        testID="phone-input"
        label={tr('staff.link.numberLabel')}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        maxLength={16}
        autoComplete="tel"
      />
      <Txt kind="small">{tr('staff.link.numberHint')}</Txt>
      {error ? <Band testID="number-error" tone={wait ? 'warn' : 'danger'} text={error} /> : null}
      {newPhone ? (
        <View style={{ gap: space.sm }}>
          <Txt>{tr('staff.link.reasonTitle')}</Txt>
          {reasonKeys.map((key) => {
            const words = tr(`staff.link.reason.${key}`);
            return (
              <Choice
                key={key}
                testID={`reason-${key}`}
                label={words}
                chosen={reason === words}
                onPress={() => setReason(words)}
              />
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}

export function CodeScreen() {
  const { tr, phone, devCode } = useApp();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(false);
  const { busy, once } = useOnce();
  const go = async (value = code) => {
    if (!validCode(value)) {
      setError(tr('staff.link.errCode'));
      return;
    }
    setError(null);
    try {
      await verifyCode(value);
    } catch (problem) {
      // Anything but an answer from the server means the phone's own key could not be used.
      const name = problem instanceof ApiError ? problem.code : 'BAD_SIGNATURE';
      setError(tr(signInError(name)));
      setWait(mustWait(name));
    }
  };
  const resend = async () => {
    setError(null);
    try {
      await requestCode(phone);
    } catch (problem) {
      const name = problem instanceof ApiError ? problem.code : 'NETWORK';
      setError(tr(signInError(name)));
      setWait(mustWait(name));
    }
  };
  return (
    <Screen
      testID="screen-code"
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="code-next"
            kind="lamp"
            label={tr('staff.link.next')}
            disabled={busy}
            onPress={() => once(() => go())}
          />
          <Btn
            testID="code-resend"
            kind="quiet"
            label={tr('staff.link.resend')}
            disabled={busy}
            onPress={() => once(resend)}
          />
          <Btn
            testID="code-back"
            kind="quiet"
            icon="chevron-left"
            label={tr('staff.common.back')}
            onPress={backToNumber}
          />
        </>
      }
    >
      <Txt kind="head">{tr('staff.link.codeTitle')}</Txt>
      <Txt kind="small">{tr('staff.link.codeSent', { phone })}</Txt>
      <Field
        testID="code-input"
        label={tr('staff.link.codeLabel')}
        keyboardType="number-pad"
        value={code}
        onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
        maxLength={6}
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
      />
      {devCode ? (
        <Txt testID="dev-code" kind="small">
          {tr('staff.link.devCode', { code: devCode })}
        </Txt>
      ) : null}
      {error ? <Band testID="code-error" tone={wait ? 'warn' : 'danger'} text={error} /> : null}
    </Screen>
  );
}

export function YoursScreen() {
  const { tr } = useApp();
  return (
    <Screen
      testID="screen-yours"
      top={<TopBar />}
      footer={
        <Btn testID="yours-ok" kind="lamp" label={tr('staff.common.ok')} onPress={yoursSeen} />
      }
    >
      <Icon name="smartphone" size={48} />
      <Txt kind="head">{tr('staff.link.yoursTitle')}</Txt>
      <Txt>{tr('staff.link.yoursLine')}</Txt>
      <Txt kind="small">{tr('staff.link.yoursApprove')}</Txt>
    </Screen>
  );
}

const noticeLines = ['what', 'why', 'who', 'long', 'track', 'fix'] as const;
export function NoticeScreen() {
  const { tr } = useApp();
  const [error, setError] = useState<string | null>(null);
  const { busy, once } = useOnce();
  const go = async () => {
    setError(null);
    try {
      await acceptNotice();
    } catch {
      setError(tr('staff.common.noSignal'));
    }
  };
  return (
    <Screen
      testID="screen-notice"
      top={<TopBar />}
      footer={
        <Btn
          testID="notice-accept"
          kind="lamp"
          label={tr('staff.link.noticeAccept')}
          disabled={busy}
          onPress={() => once(go)}
        />
      }
    >
      <Txt kind="head">{tr('staff.link.noticeTitle')}</Txt>
      {noticeLines.map((line) => (
        <Txt key={line}>{tr(`staff.link.notice.${line}`)}</Txt>
      ))}
      {error ? <Band tone="danger" text={error} /> : null}
    </Screen>
  );
}

/** First phone and new phone share this: it waits, and opens by itself once someone agrees. */
export function WaitingScreen({ newPhone }: { newPhone: boolean }) {
  const { tr, link } = useApp();
  const nav = useNav();
  const [note, setNote] = useState<string | null>(null);
  const [lost, setLost] = useState<'cut' | 'none' | null>(null);
  const { once } = useOnce();
  useEffect(() => {
    const timer = setInterval(() => void refreshLink().catch(() => {}), 15000);
    void refreshLink().catch(() => {});
    return () => clearInterval(timer);
  }, []);
  const check = async () => {
    setNote(null);
    try {
      await refreshLink();
      setNote(tr('staff.link.notYet'));
    } catch {
      setNote(tr('staff.common.noSignal'));
    }
  };
  const report = async () => {
    setNote(null);
    try {
      const reply = await reportLost();
      setLost(reply.cutOff ? 'cut' : 'none');
    } catch {
      setNote(tr('staff.common.noSignal'));
    }
  };
  if (lost)
    return (
      <Flood
        tone="amber"
        icon="smartphone"
        title={tr(lost === 'cut' ? 'staff.link.lostTitle' : 'staff.link.lostNothing')}
        lines={[tr('staff.link.lostLine')]}
        actions={
          <Btn
            testID="lost-ok"
            kind="solid"
            label={tr('staff.common.ok')}
            onPress={() => setLost(null)}
          />
        }
      />
    );
  const proved = Boolean(link?.request?.qrScannedAt);
  return (
    <Screen
      testID={newPhone ? 'screen-new-phone' : 'screen-waiting'}
      top={<TopBar />}
      footer={
        <>
          <Btn
            testID="link-check"
            kind={proved ? 'lamp' : 'quiet'}
            label={tr('staff.link.check')}
            onPress={() => void check()}
          />
          {proved ? null : (
            <Btn
              testID="scan-proof"
              kind="lamp"
              icon="qr"
              label={tr('staff.link.scanProof')}
              onPress={() => nav.push('scan', { mode: 'PROOF' })}
            />
          )}
          {newPhone ? (
            <Btn
              testID="lost-old"
              kind="line"
              label={tr('staff.link.lostBtn')}
              onPress={() => once(report)}
            />
          ) : null}
        </>
      }
    >
      <Icon name="clock" size={48} />
      <Txt kind="head">{tr(newPhone ? 'staff.link.newTitle' : 'staff.link.waitTitle')}</Txt>
      <Txt>{tr(newPhone ? 'staff.link.newLine' : 'staff.link.waitLine')}</Txt>
      <Txt kind="small">{tr('staff.link.byManager')}</Txt>
      {proved ? <Tag testID="proof-done" tone="ok" text={tr('staff.link.proofDone')} /> : null}
      {note ? <Band testID="link-note" text={note} /> : null}
    </Screen>
  );
}

export function RefusedScreen() {
  const { tr } = useApp();
  return (
    <Flood
      tone="amber"
      icon="alert-triangle"
      testID="screen-refused"
      title={tr('staff.link.refusedTitle')}
      lines={[tr('staff.link.refusedLine')]}
      actions={
        <Btn
          testID="relink"
          kind="solid"
          label={tr('staff.link.relink')}
          onPress={() => void startAgain()}
        />
      }
    />
  );
}
export function CutOffScreen() {
  const { tr } = useApp();
  return (
    <Screen
      testID="screen-cut-off"
      top={<TopBar />}
      footer={
        <Btn
          testID="relink"
          kind="lamp"
          label={tr('staff.link.relink')}
          onPress={() => void startAgain()}
        />
      }
    >
      <Icon name="lock" size={48} color={colors.danger} />
      <Txt kind="head">{tr('staff.link.cutTitle')}</Txt>
      <Txt>{tr('staff.link.cutLine')}</Txt>
    </Screen>
  );
}
