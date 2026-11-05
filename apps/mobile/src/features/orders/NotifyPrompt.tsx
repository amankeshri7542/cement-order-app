import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { enableOrderPush, pushKeys, type PushResult } from '../../platform/push';
import { readSaved, writeSaved } from '../../state/saved';
import { sessionStore } from '../../state/session';
import { showToast } from '../../state/ui';
import { useSelect } from '../../state/use';
import { Button } from '../../ui/Button';
import { C, space, T } from '../../ui/tokens';
import { w } from '../../words';

/** What a notification answer means, in plain words. */
export const pushWords = (result: PushResult) =>
  result === 'on'
    ? w('push.on')
    : result === 'denied'
      ? w('push.denied')
      : result === 'offline'
        ? w('push.offline')
        : w('push.unavailable');

/**
 * One question right after an order: get its updates on this phone? It is asked once on Android (the
 * answer is remembered either way); Account keeps the switch for later.
 */
export function NotifyPrompt() {
  const user = useSelect(sessionStore, (state) => state.user);
  const userId = user?.id;
  const [asked, setAsked] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android' || !userId) return;
    let active = true;
    void readSaved<boolean>(pushKeys.asked(userId)).then((value) => {
      if (active) setAsked(value === true);
    });
    return () => {
      active = false;
    };
  }, [userId]);
  if (Platform.OS !== 'android' || asked || !user || user.role === 'ADMIN') return null;
  async function answer(turnOn: boolean) {
    if (!userId) return;
    setBusy(true);
    try {
      await writeSaved(pushKeys.asked(userId), true).catch(() => {});
      setAsked(true);
      if (!turnOn) return;
      const result = await enableOrderPush(w('push.channel'));
      if (result === 'on') await writeSaved(pushKeys.on(userId), true).catch(() => {});
      // No signal is not an answer: the question comes back next time.
      if (result === 'offline') {
        await writeSaved(pushKeys.asked(userId), null).catch(() => {});
        setAsked(false);
      }
      showToast(pushWords(result));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.card} testID="notify-prompt">
      <Text style={T.bodyStrong} accessibilityRole="header">
        {w('push.question')}
      </Text>
      <Text style={[T.small, styles.quiet]}>{w('push.explain')}</Text>
      <View style={styles.row}>
        <Button
          icon="notifications-outline"
          loading={busy}
          style={styles.flex}
          onPress={() => void answer(true)}
        >
          {w('push.turnOn')}
        </Button>
        <Button kind="quiet" disabled={busy} onPress={() => void answer(false)}>
          {w('push.notNow')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.up, padding: space[3], gap: space[2] },
  quiet: { color: C.ink2 },
  row: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  flex: { flex: 1 },
});
