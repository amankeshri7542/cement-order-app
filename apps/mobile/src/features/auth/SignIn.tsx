import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { phoneDigits, type User } from '@shiv/shared';
import { resendSeconds, secondsLeft } from '../../logic/countdown';
import { listenForSignInCode } from '../../platform/sms';
import { api, saveSession } from '../../state/api';
import { say } from '../../state/net';
import { cancelSignIn, completeLogin } from '../../state/session';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { Sheet } from '../../ui/Sheet';
import { space, T, C } from '../../ui/tokens';
import { w } from '../../words';

/** Whole seconds left until `deadline`, counted down once a second. */
function useSecondsLeft(deadline: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline || Date.now() >= deadline) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return secondsLeft(deadline, now);
}

/** Sign-in happens once, at the moment it is needed: mobile number, then the code. */
export function SignIn({ onClosed }: { onClosed: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const waitSeconds = useSecondsLeft(resendAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Android can read the SMS itself. Only the first code read for each request is used: on Android
  // 7-12 another app can fake the SMS broadcast, and a fake must cost one check at most.
  const [autoSubmit, setAutoSubmit] = useState(false);
  const autoRead = useRef(false);
  useEffect(() => {
    if (!sent) return;
    autoRead.current = false;
    return listenForSignInCode((value) => {
      if (autoRead.current) return;
      autoRead.current = true;
      setCode(value);
      setAutoSubmit(true);
    });
  }, [sent, resendAt]);
  async function requestCode() {
    const result = await api<{ devCode?: string }>('/auth/otp/request', 'POST', {
      phone: `+91${phone}`,
    });
    setDevCode(result.devCode || '');
    setCode('');
    setSent(true);
    setResendAt(Date.now() + resendSeconds * 1000);
  }
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (!sent) await requestCode();
      else {
        const result = await api<{ user: User; accessToken?: string; refreshToken?: string }>(
          '/auth/otp/verify',
          'POST',
          { phone: `+91${phone}`, code, surface: 'CUSTOMER' },
        );
        await completeLogin(await saveSession(result));
      }
    } catch (e) {
      setError(say(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (autoSubmit && code.length === 6 && !busy) {
      setAutoSubmit(false);
      void submit();
    }
  }, [autoSubmit, code, busy]);
  return (
    <Sheet
      title={w('signIn.title')}
      onClosed={() => {
        cancelSignIn();
        onClosed();
      }}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <Text style={[T.body, styles.quiet]}>{w('signIn.explain')}</Text>
        <Field
          label={w('signIn.mobile')}
          prefix="+91"
          value={phone}
          onChangeText={(value) => setPhone(phoneDigits(value))}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          // Room for a pasted "+91 98765 43210"; phoneDigits keeps the ten digits.
          maxLength={18}
          editable={!sent && !busy}
          returnKeyType="send"
          onSubmitEditing={() => {
            if (!sent && phone.length === 10 && !busy) void submit();
          }}
          autoFocus
        />
        {sent ? (
          <Field
            label={w('signIn.code')}
            value={code}
            onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (code.length === 6 && !busy) void submit();
            }}
            autoFocus
          />
        ) : null}
        {devCode ? <Notice>{w('signIn.devCode', { code: devCode })}</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button
          loading={busy}
          disabled={sent ? code.length !== 6 : phone.length !== 10}
          onPress={() => void submit()}
        >
          {sent ? w('signIn.verify') : w('signIn.getCode')}
        </Button>
        {sent ? (
          <View style={styles.links}>
            <Button
              kind="link"
              disabled={busy || waitSeconds > 0}
              onPress={() => {
                setBusy(true);
                setError('');
                void requestCode()
                  .catch((e) => setError(say(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {waitSeconds > 0
                ? w('signIn.resendIn', { seconds: waitSeconds })
                : w('signIn.resend')}
            </Button>
            <Button
              kind="link"
              disabled={busy}
              onPress={() => {
                setSent(false);
                setCode('');
                setDevCode('');
                setResendAt(0);
              }}
            >
              {w('signIn.changeNumber')}
            </Button>
          </View>
        ) : null}
        <Text style={[T.small, styles.quiet]}>{w('signIn.privacy')}</Text>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space[4], paddingBottom: space[5], gap: space[3] },
  quiet: { color: C.ink2 },
  links: { flexDirection: 'row', justifyContent: 'space-between', gap: space[3] },
});
