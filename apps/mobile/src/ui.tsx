import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, textSize, touch } from '@shiv/shared';

// One theme with the website and owner desk (packages/shared/src/theme.ts): ivory paper,
// blueprint ink, clay for the one action that matters on each screen.
export const C = colors;
export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({
  name,
  color = C.ink,
  size = 22,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} color={color} size={size} aria-hidden accessible={false} />;
}

/** The "शिव" signboard stamp used on every surface of the shop. */
export function Stamp({ size = 44, tone = 'ink' }: { size?: number; tone?: 'ink' | 'clay' }) {
  return (
    <View
      accessible={false}
      style={[
        s.stamp,
        {
          width: size,
          height: size * 1.08,
          backgroundColor: tone === 'ink' ? C.ink : C.clay,
          borderTopRightRadius: size * 0.3,
        },
      ]}
    >
      <Text style={[s.stampText, { fontSize: size * 0.52 }]}>शिव</Text>
    </View>
  );
}

export function Button({
  children,
  onPress,
  kind = 'primary',
  secondary,
  disabled,
  loading,
  icon,
  style,
  label,
}: {
  children: ReactNode;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet';
  /** Shorthand for kind="secondary". */
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: ViewStyle;
  /** Accessible name when the visible text is not enough. */
  label?: string;
}) {
  const variant = secondary ? 'secondary' : kind;
  const color = variant === 'primary' ? C.surface : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.secondary,
        variant === 'quiet' && s.quiet,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { opacity: 0.82, transform: [{ scale: 0.985 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color={color} />}
          <Text style={[s.buttonText, { color }]} numberOfLines={2}>
            {children}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** A round icon-only button with a visible-size touch target of 48dp. */
export function IconButton({
  icon,
  label,
  onPress,
  color = C.ink,
  background,
  badge,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  background?: string;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        s.iconButton,
        background ? { backgroundColor: background } : null,
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Icon name={icon} color={color} />
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={C.muted}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 88, textAlignVertical: 'top' },
          props.editable === false && { backgroundColor: C.stone },
          props.style,
        ]}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({
  children,
  error,
  tone,
}: {
  children: ReactNode;
  error?: boolean;
  tone?: 'info' | 'good';
}) {
  const good = tone === 'good';
  return (
    <View
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion={error ? 'assertive' : 'polite'}
      style={[
        s.notice,
        error && { backgroundColor: C.dangerSoft, borderLeftColor: C.danger },
        good && { backgroundColor: C.greenSoft, borderLeftColor: C.green },
      ]}
    >
      <Icon
        name={error ? 'alert-circle' : good ? 'checkmark-circle' : 'information-circle'}
        color={error ? C.danger : good ? C.green : C.inkSoft}
        size={20}
      />
      <Text style={[s.noticeText, error && { color: C.danger }]}>{children}</Text>
    </View>
  );
}

export function Empty({
  icon = 'cube-outline',
  title,
  body,
  action,
  onAction,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={32} color={C.inkSoft} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      {body ? <Text style={s.emptyBody}>{body}</Text> : null}
      {action && onAction && (
        <Button onPress={onAction} style={{ marginTop: space.xl, alignSelf: 'stretch' }}>
          {action}
        </Button>
      )}
    </View>
  );
}

export function Section({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.section}>
      <Text style={s.h2} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction && (
        <Pressable accessibilityRole="button" onPress={onAction} style={s.sectionAction}>
          <Text style={s.link}>{action}</Text>
          <Icon name="arrow-forward" size={16} color={C.clay} />
        </Pressable>
      )}
    </View>
  );
}

export function Tag({
  children,
  tone = 'green',
}: {
  children: ReactNode;
  tone?: 'green' | 'clay' | 'grey';
}) {
  const [background, color] =
    tone === 'green'
      ? [C.greenSoft, C.green]
      : tone === 'clay'
        ? [C.dangerSoft, C.clayDeep]
        : [C.stone, C.muted];
  return (
    <View style={[s.tag, { backgroundColor: background }]}>
      <Text style={[s.tagText, { color }]}>{children}</Text>
    </View>
  );
}

/** A selectable pill: filters, delivery dates, languages. */
export function Chip({
  label,
  selected,
  onPress,
  detail,
  accessibilityLabel,
  role = 'button',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  detail?: string;
  accessibilityLabel?: string;
  role?: 'button' | 'radio';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={role === 'radio' ? { checked: selected } : { selected }}
      aria-checked={role === 'radio' ? selected : undefined}
      onPress={onPress}
      style={({ pressed }) => [s.chip, selected && s.chipSelected, pressed && { opacity: 0.8 }]}
    >
      <Text style={[s.chipText, selected && { color: C.surface }]}>{label}</Text>
      {detail ? (
        <Text style={[s.chipDetail, selected && { color: C.clayOnInk }]}>{detail}</Text>
      ) : null}
    </Pressable>
  );
}

/** A grey placeholder block shown while content loads. */
export function Bone({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: ViewStyle['width'];
}) {
  return <View style={{ height, width, backgroundColor: C.stone, borderRadius: radius.sm }} />;
}

/**
 * Every screen's scroll container. `footer` stays pinned above the tab bar so the screen's
 * main action is always visible without scrolling.
 */
export function Screen({
  children,
  footer,
  refreshing = false,
  onRefresh,
  wide,
}: {
  children: ReactNode;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  wide?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.screen, { maxWidth: wide ? 1080 : 720 }]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[C.clay]}
              tintColor={C.clay}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </View>
  );
}

/** Honours the phone's "remove animations" setting. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

export const s = StyleSheet.create({
  stamp: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
    paddingTop: 4,
  },
  stampText: { color: C.paper, fontWeight: '800', includeFontPadding: false },
  button: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: C.clay,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700', fontSize: textSize.body, textAlign: 'center', flexShrink: 1 },
  secondary: { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink },
  quiet: { backgroundColor: 'transparent', minHeight: touch },
  iconButton: {
    width: touch,
    height: touch,
    borderRadius: touch / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: C.clay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: C.surface, fontSize: 12, fontWeight: '800' },
  field: { gap: space.sm },
  label: { fontSize: textSize.caption, color: C.ink, fontWeight: '700' },
  hint: { fontSize: textSize.caption, color: C.muted, lineHeight: 20 },
  input: {
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: radius.md,
    backgroundColor: C.surface,
    color: C.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: textSize.body,
    minHeight: 52,
  },
  notice: {
    backgroundColor: C.stone,
    borderLeftWidth: 4,
    borderLeftColor: C.inkSoft,
    padding: space.md,
    borderRadius: radius.sm,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
  },
  noticeText: { fontSize: textSize.caption + 1, lineHeight: 22, color: C.ink, flex: 1 },
  empty: { paddingVertical: space.xxl, paddingHorizontal: space.lg, alignItems: 'center' },
  emptyIcon: {
    height: 72,
    width: 72,
    borderRadius: 36,
    backgroundColor: C.stone,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emptyTitle: {
    fontSize: textSize.title,
    fontWeight: '800',
    color: C.ink,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyBody: {
    fontSize: textSize.body,
    color: C.muted,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: space.sm,
  },
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.xl,
    marginBottom: space.md,
    gap: space.md,
  },
  sectionAction: { flexDirection: 'row', gap: 4, alignItems: 'center', minHeight: touch },
  h1: { color: C.ink, fontSize: textSize.heading, fontWeight: '800', letterSpacing: -0.6 },
  h2: { color: C.ink, fontSize: textSize.title - 2, fontWeight: '800', flexShrink: 1 },
  h3: { color: C.ink, fontSize: textSize.lead, fontWeight: '700' },
  link: { color: C.clayDeep, fontWeight: '700', fontSize: textSize.body },
  tag: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: space.sm,
    borderRadius: 4,
  },
  tagText: { fontSize: textSize.caption, fontWeight: '700' },
  chip: {
    minHeight: touch,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderWidth: 1.5,
    borderColor: C.line,
    borderRadius: radius.md,
    backgroundColor: C.surface,
  },
  chipSelected: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: {
    fontSize: textSize.caption + 1,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'center',
  },
  chipDetail: { fontSize: 13, color: C.muted, textAlign: 'center' },
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: radius.md,
    padding: space.lg,
  },
  stack: { gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  body: { color: C.muted, fontSize: textSize.body, lineHeight: 24 },
  small: { color: C.muted, fontSize: textSize.caption, lineHeight: 20 },
  eyebrow: { color: C.clayDeep, fontSize: textSize.caption, fontWeight: '800', letterSpacing: 0.6 },
  price: { color: C.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: space.xs },
  screen: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  footer: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
    ...(Platform.OS === 'web' ? {} : { elevation: 8 }),
  },
});
