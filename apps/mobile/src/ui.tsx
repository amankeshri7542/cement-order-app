import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, motion, radius, space, textSize, touch } from '@shiv/shared';
import { displayFont } from './fonts';

// Direction A, "counter and sindoor" (packages/shared/src/theme.ts): cement-stone ground,
// surfaces one tone up, slip paper for the parchi and the latest-order slip, steel ink for the
// top bar and the open rate folder, and sindoor red only for actions and the शिव stamp.
// Teko 600 sets display text, headings and prices, as the website's var(--display); body text
// stays in the phone's own face.
export const C = colors;
export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Prices and quantities line up in columns. */
const figures: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Teko 600. The file carries its own weight, so the style asks for none (Android would
 * otherwise thicken it a second time).
 */
export const display: TextStyle = { fontFamily: displayFont, fontWeight: 'normal' };

/**
 * Teko is condensed and small on its body, so it runs one optical step above the reading sizes
 * (as the website's --t-title and --t-figure). Each line is 1.15 em: Teko's Devanagari vowel
 * signs reach 0.85 em above the baseline, and a tighter line would cut them off.
 */
export const displaySize = { display: 56, head: 40, title: 30, figure: 26, small: 22 } as const;
export const displayLine = (size: number) => Math.round(size * 1.15);
export const teko = (size: number): TextStyle => ({
  ...display,
  fontSize: size,
  lineHeight: displayLine(size),
});

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

/** The "शिव" stamp: a square of sindoor with the name in white, as on the shop's signboard. */
export function Stamp({ size = 44 }: { size?: number }) {
  return (
    <View accessible={false} style={[s.stamp, { width: size, height: size }]}>
      <Text
        style={[s.stampText, teko(Math.round(size * 0.56))]}
        maxFontSizeMultiplier={1}
        aria-hidden
      >
        शिव
      </Text>
    </View>
  );
}

/** The round cash-on-delivery stamp pressed on the parchi. */
export function CodStamp({ label, text }: { label: string; text: string }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={s.codStamp}>
      <Text style={s.codStampText} maxFontSizeMultiplier={1.2} aria-hidden>
        {text}
      </Text>
    </View>
  );
}

/** The torn bottom edge of a paper slip. Drawn with rotated squares, so no SVG is needed. */
export function TornEdge({ color = C.paper }: { color?: string }) {
  return (
    <View style={s.torn} accessible={false} aria-hidden>
      {Array.from({ length: 64 }, (_, i) => (
        <View key={i} style={s.tooth}>
          <View style={[s.toothShape, { backgroundColor: color }]} />
        </View>
      ))}
    </View>
  );
}

/**
 * A figure that rolls when its value changes, like a rate board number being turned. The
 * phone's "remove animations" setting shows the new value at once.
 */
export function Roll({
  value,
  style,
  maxFontSizeMultiplier,
}: {
  value: string;
  style?: StyleProp<TextStyle>;
  /** Caps very large figures so they wrap by line, not by character, at big font scales. */
  maxFontSizeMultiplier?: number;
}) {
  const reduced = useReducedMotion();
  const shift = useRef(new Animated.Value(0)).current;
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (reduced) return;
    const native = Platform.OS !== 'web';
    const easing = Easing.bezier(...motion.easing);
    shift.setValue(0);
    Animated.sequence([
      Animated.timing(shift, { toValue: -1, duration: 315, easing, useNativeDriver: native }),
      Animated.timing(shift, { toValue: 1, duration: 0, useNativeDriver: native }),
      Animated.timing(shift, { toValue: 0, duration: 585, easing, useNativeDriver: native }),
    ]).start();
  }, [value, reduced, shift]);
  return (
    <Animated.View
      style={{
        opacity: shift.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
        transform: [
          { translateY: shift.interpolate({ inputRange: [-1, 1], outputRange: [-14, 14] }) },
        ],
      }}
    >
      <Text style={style} maxFontSizeMultiplier={maxFontSizeMultiplier}>
        {value}
      </Text>
    </Animated.View>
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
  /** primary: sindoor; secondary: ink; quiet: an underlined link; paper: light on an ink ground. */
  kind?: 'primary' | 'secondary' | 'quiet' | 'paper';
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
  const off = Boolean(disabled || loading);
  const color =
    off && variant !== 'quiet'
      ? C.muted
      : variant === 'primary'
        ? C.onAccent
        : variant === 'secondary'
          ? C.onInk
          : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        variant === 'secondary' && s.secondary,
        variant === 'paper' && s.paperButton,
        variant === 'quiet' && s.quiet,
        pressed && variant === 'primary' && { backgroundColor: C.accentPress },
        pressed && variant === 'secondary' && { backgroundColor: C.ink2 },
        pressed && (variant === 'quiet' || variant === 'paper') && { opacity: 0.7 },
        off && variant !== 'quiet' && s.buttonOff,
        off && variant === 'quiet' && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? C.onInk : C.ink} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} color={color} />}
          <Text
            style={[s.buttonText, { color }, variant === 'quiet' && s.quietText]}
            numberOfLines={2}
          >
            {children}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** An icon-only button with a 48dp touch target. */
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
  ref,
  ...props
}: TextInputProps & { label: string; hint?: string; ref?: Ref<TextInput> }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={C.muted}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 96, textAlignVertical: 'top' },
          props.editable === false && { backgroundColor: C.surface, color: C.muted },
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
  tone?: 'info' | 'good' | 'warn';
}) {
  const good = tone === 'good';
  const warn = tone === 'warn';
  const color = error ? C.danger : good ? C.ok : warn ? C.warn : C.ink;
  return (
    <View
      accessibilityRole={error ? 'alert' : undefined}
      accessibilityLiveRegion={error ? 'assertive' : 'polite'}
      style={[
        s.notice,
        error && { backgroundColor: C.dangerSoft },
        good && { backgroundColor: C.okSoft },
        warn && { backgroundColor: C.paper },
      ]}
    >
      <Icon
        name={
          error
            ? 'alert-circle'
            : good
              ? 'checkmark-circle'
              : warn
                ? 'warning'
                : 'information-circle'
        }
        color={color}
        size={20}
      />
      <Text style={[s.noticeText, { color }]}>{children}</Text>
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
        <Icon name={icon} size={32} color={C.ink2} />
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
          <Icon name="arrow-forward" size={16} color={C.ink} />
        </Pressable>
      )}
    </View>
  );
}

/** A status pill. Pills are used for status only. */
export function Tag({
  children,
  tone = 'green',
}: {
  children: ReactNode;
  tone?: 'green' | 'clay' | 'grey';
}) {
  const [background, color] =
    tone === 'green'
      ? [C.okSoft, C.ok]
      : tone === 'clay'
        ? [C.dangerSoft, C.danger]
        : [C.tab1, C.ink2];
  return (
    <View style={[s.tag, { backgroundColor: background }]}>
      <Text style={[s.tagText, { color }]}>{children}</Text>
    </View>
  );
}

/** A selectable control: filters, delivery dates, languages. */
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
      <Text style={[s.chipText, selected && { color: C.onInk }]}>{label}</Text>
      {detail ? (
        <Text style={[s.chipDetail, selected && { color: C.onInkMuted }]}>{detail}</Text>
      ) : null}
    </Pressable>
  );
}

/** A placeholder block shown while content loads. */
export function Bone({
  height = 16,
  width = '100%',
}: {
  height?: number;
  width?: ViewStyle['width'];
}) {
  return <View style={{ height, width, backgroundColor: C.tab1 }} />;
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
              colors={[C.accent]}
              tintColor={C.accent}
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

const TOOTH = 14;

export const s = StyleSheet.create({
  stamp: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.accent,
    paddingTop: 2,
  },
  stampText: { color: C.onAccent, ...display, includeFontPadding: false },
  codStamp: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.sm,
    transform: [{ rotate: '-11deg' }],
  },
  codStampText: { color: C.accent, ...teko(18), textAlign: 'center' },
  torn: { height: TOOTH / 2, flexDirection: 'row', overflow: 'hidden', pointerEvents: 'none' },
  tooth: { width: TOOTH, height: TOOTH / 2 },
  toothShape: {
    position: 'absolute',
    width: TOOTH / Math.SQRT2,
    height: TOOTH / Math.SQRT2,
    left: TOOTH / 2 - TOOTH / Math.SQRT2 / 2,
    top: -TOOTH / Math.SQRT2 / 2,
    transform: [{ rotate: '45deg' }],
  },
  button: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.control,
    backgroundColor: C.accent,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700', fontSize: textSize.body, textAlign: 'center', flexShrink: 1 },
  buttonOff: { backgroundColor: C.tab3 },
  secondary: { backgroundColor: C.ink },
  paperButton: { backgroundColor: C.paper },
  quiet: { backgroundColor: 'transparent', paddingHorizontal: space.xs },
  quietText: { textDecorationLine: 'underline' },
  iconButton: {
    width: touch,
    height: touch,
    borderRadius: radius.control,
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
    borderRadius: radius.pill,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: C.onAccent, fontSize: textSize.small, fontWeight: '800', ...figures },
  field: { gap: space.sm },
  label: { fontSize: textSize.body, color: C.ink, fontWeight: '700' },
  hint: { fontSize: textSize.small, color: C.muted, lineHeight: 20 },
  input: {
    borderWidth: 1.5,
    borderColor: C.rule,
    borderBottomWidth: 2,
    borderBottomColor: C.muted,
    borderRadius: radius.control,
    backgroundColor: C.paper,
    color: C.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: textSize.body,
    minHeight: touch,
  },
  notice: {
    backgroundColor: C.surface,
    padding: space.md,
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
  },
  noticeText: { fontSize: textSize.body, lineHeight: 24, color: C.ink, flex: 1 },
  empty: { paddingVertical: space.xxl, paddingHorizontal: space.lg, alignItems: 'center' },
  emptyIcon: {
    height: 72,
    width: 72,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emptyTitle: {
    ...teko(displaySize.title),
    color: C.ink,
    textAlign: 'center',
    maxWidth: 320,
  },
  emptyBody: {
    fontSize: textSize.body,
    color: C.muted,
    lineHeight: 25,
    textAlign: 'center',
    maxWidth: 320,
    marginTop: space.sm,
  },
  section: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: space.xl,
    marginBottom: space.md,
    gap: space.md,
  },
  sectionAction: { flexDirection: 'row', gap: 4, alignItems: 'center', minHeight: touch },
  /** Display: the one big line on a screen (rates, prices). */
  display: { color: C.ink, ...teko(displaySize.display), ...figures },
  h1: { color: C.ink, ...teko(displaySize.head) },
  h2: { color: C.ink, ...teko(displaySize.title), flexShrink: 1 },
  /** Sub-headings and item names stay in the reading face, as on the website's product cards. */
  h3: { color: C.ink, fontSize: textSize.lead, lineHeight: 26, fontWeight: '700' },
  link: {
    color: C.ink,
    fontWeight: '700',
    fontSize: textSize.body,
    textDecorationLine: 'underline',
  },
  tag: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  tagText: { fontSize: textSize.small, fontWeight: '700' },
  chip: {
    minHeight: touch,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderWidth: 1.5,
    borderColor: C.rule,
    borderRadius: radius.control,
    backgroundColor: C.paper,
  },
  chipSelected: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: {
    fontSize: textSize.body,
    fontWeight: '700',
    color: C.ink,
    textAlign: 'center',
  },
  chipDetail: { fontSize: textSize.small, color: C.muted, textAlign: 'center' },
  /** A surface: one tone up from the ground. No border, no shadow. */
  card: {
    backgroundColor: C.surface,
    padding: space.lg,
  },
  /** Slip paper: the parchi, the latest-order slip, receipts. Square-cornered. */
  paper: {
    backgroundColor: C.paper,
    padding: space.lg,
  },
  /** A ruled line: tables, forms and the parchi only. */
  ruled: { borderBottomWidth: 1, borderBottomColor: C.rule },
  stack: { gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  between: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  body: { color: C.muted, fontSize: textSize.body, lineHeight: 25 },
  small: { color: C.muted, fontSize: textSize.small, lineHeight: 20 },
  price: { color: C.ink, ...teko(displaySize.figure), ...figures },
  priceBig: { color: C.ink, ...teko(displaySize.head), ...figures },
  divider: { height: 1, backgroundColor: C.rule, marginVertical: space.xs },
  screen: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    gap: space.lg,
  },
  footer: {
    backgroundColor: C.paper,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: space.sm,
  },
});
