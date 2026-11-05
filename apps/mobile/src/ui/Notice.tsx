import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { C, space, T } from './tokens';

type Tone = 'info' | 'good' | 'warn' | 'error';
const looks: Record<Tone, { background: string; color: string; icon: IconName }> = {
  info: { background: C.up, color: C.ink, icon: 'information-circle-outline' },
  good: { background: C.okSoft, color: C.ok, icon: 'checkmark-circle-outline' },
  warn: { background: C.warnSoft, color: C.warn, icon: 'time-outline' },
  error: { background: C.dangerSoft, color: C.danger, icon: 'alert-circle-outline' },
};

/** One plain sentence with a word and a shape. Colour is never the only signal. */
export function Notice({ children, tone = 'info' }: { children: React.ReactNode; tone?: Tone }) {
  const look = looks[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: look.background }]}
    >
      <Icon name={look.icon} color={look.color} size={20} />
      <Text style={[T.body, styles.text, { color: look.color }]}>{children}</Text>
    </View>
  );
}

/** The one empty state on a screen: a plate if there is one, a line and at most one way forward. */
export function Empty({
  title,
  body,
  action,
  onAction,
  plate,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  plate?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {plate}
      <Text style={[T.head, styles.center]} accessibilityRole="header">
        {title}
      </Text>
      {body ? <Text style={[T.body, styles.center, { color: C.ink2 }]}>{body}</Text> : null}
      {action && onAction ? (
        <Button onPress={onAction} style={styles.action}>
          {action}
        </Button>
      ) : null}
    </View>
  );
}

/** A still block while something loads. No shimmer. */
export function Bone({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: number | `${number}%`;
}) {
  return <View style={{ height, width, backgroundColor: C.down }} />;
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', gap: space[2], padding: space[3], alignItems: 'flex-start' },
  text: { flex: 1 },
  empty: {
    gap: space[3],
    alignItems: 'center',
    paddingVertical: space[7],
    paddingHorizontal: space[4],
  },
  center: { textAlign: 'center' },
  action: { alignSelf: 'stretch', marginTop: space[2] },
});
