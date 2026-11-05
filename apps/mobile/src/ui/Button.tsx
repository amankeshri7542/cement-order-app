import { ActivityIndicator, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Press } from './Press';
import { C, radius, space, T, touch } from './tokens';

export type ButtonKind = 'solid' | 'line' | 'lamp' | 'quiet' | 'link';

/** solid: ink. line: outlined. lamp: the one amber button on a screen. quiet: a step in tone. */
export function Button({
  children,
  onPress,
  kind = 'solid',
  disabled,
  loading,
  icon,
  style,
  label,
  testID,
}: {
  children: React.ReactNode;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  /** Accessible name when the visible text is not enough. */
  label?: string;
  testID?: string;
}) {
  const off = Boolean(disabled || loading);
  const onColor = kind === 'solid' && !off ? C.onNight : off && kind !== 'link' ? C.ink2 : C.ink;
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      disabled={off}
      onPress={onPress}
      testID={testID}
      style={[styles.base, styles[kind], off && styles[kind === 'link' ? 'linkOff' : 'off'], style]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'solid' ? C.ink2 : C.ink} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={onColor} /> : null}
          <Text
            style={[
              kind === 'lamp' ? T.titleStrong : T.bodyStrong,
              styles.text,
              { color: onColor },
              kind === 'link' && styles.linkText,
            ]}
            numberOfLines={2}
          >
            {children}
          </Text>
        </>
      )}
    </Press>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  text: { textAlign: 'center', flexShrink: 1 },
  solid: { backgroundColor: C.ink },
  line: { borderWidth: 1.5, borderColor: C.ink },
  lamp: { backgroundColor: C.diya, minHeight: 56 },
  quiet: { backgroundColor: C.down },
  link: { paddingHorizontal: space[1], minHeight: touch },
  linkText: { textDecorationLine: 'underline', fontFamily: T.small.fontFamily, fontSize: 15 },
  off: { backgroundColor: C.down, borderColor: C.down },
  linkOff: { opacity: 0.45 },
});
