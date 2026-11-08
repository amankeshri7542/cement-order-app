import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { font } from '../platform/fonts';
import {
  colors,
  floodArmMs,
  floodEasing,
  floodMs,
  radiusControl,
  space,
  staffType,
  touchStaff,
} from './tokens';

export type IconName = React.ComponentProps<typeof Feather>['name'] | 'qr' | 'rupee';
export function Icon(props: { name: IconName; size?: number; color?: string }) {
  const size = props.size ?? 26;
  const color = props.color ?? colors.ink;
  if (props.name === 'rupee')
    return (
      <Text
        allowFontScaling={false}
        style={{ fontFamily: font, fontSize: size, lineHeight: size + 4, color }}
      >
        ₹
      </Text>
    );
  if (props.name === 'qr') {
    const cell = Math.round(size * 0.4);
    const box = { width: cell, height: cell, borderWidth: 2, borderColor: color };
    return (
      <View style={{ width: size, height: size, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={box} />
          <View style={box} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={box} />
          <View style={{ width: cell, height: cell, backgroundColor: color }} />
        </View>
      </View>
    );
  }
  return <Feather name={props.name} size={size} color={color} />;
}

type TxtProps = {
  children: ReactNode;
  kind?: 'number' | 'head' | 'body' | 'small';
  color?: string;
  style?: TextStyle;
  testID?: string;
  center?: boolean;
  onLongPress?: () => void;
};
export function Txt({
  kind = 'body',
  color,
  style,
  center,
  children,
  testID,
  onLongPress,
}: TxtProps) {
  const size = staffType[kind];
  return (
    <Text
      testID={testID}
      onLongPress={onLongPress}
      style={[
        {
          fontFamily: font,
          fontSize: size,
          lineHeight: Math.round(size * (kind === 'number' ? 1.1 : kind === 'head' ? 1.2 : 1.35)),
          color: color ?? (kind === 'small' ? colors.ink2 : colors.ink),
          fontVariant: ['tabular-nums'],
        },
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** The three bars. */
export function Mark({ color = colors.ink }: { color?: string }) {
  const bar = (height: number) => <View style={{ width: 4, height, backgroundColor: color }} />;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no">
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 18 }}>
        {bar(12)}
        {bar(18)}
        {bar(12)}
      </View>
      <View style={{ height: 3, width: 20, backgroundColor: color }} />
    </View>
  );
}

export type BtnKind = 'lamp' | 'solid' | 'line' | 'quiet' | 'white';
const btnStyle: Record<BtnKind, { fill: string; press: string; text: string; border?: string }> = {
  lamp: { fill: colors.diya, press: colors.diyaPress, text: colors.onDiya },
  solid: { fill: colors.ink, press: colors.ink2, text: colors.paper },
  line: { fill: 'transparent', press: colors.well, text: colors.ink, border: colors.ink },
  quiet: { fill: colors.well, press: colors.wellPress, text: colors.ink },
  white: { fill: colors.onSolid, press: colors.well, text: colors.ink },
};
export function Btn(props: {
  label: string;
  onPress?: () => void;
  kind?: BtnKind;
  icon?: IconName;
  testID?: string;
  disabled?: boolean;
  /** On a coloured flood, a line button draws in this colour. */
  on?: string;
  flex?: boolean;
}) {
  const look = btnStyle[props.kind ?? 'quiet'];
  const text = props.on ?? look.text;
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        {
          minHeight: touchStaff,
          backgroundColor: pressed ? look.press : look.fill,
          borderRadius: radiusControl,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          opacity: props.disabled ? 0.5 : 1,
        },
        look.border ? { borderWidth: 1.5, borderColor: props.on ?? look.border } : null,
        props.flex ? { flex: 1 } : null,
      ]}
    >
      {props.icon ? <Icon name={props.icon} color={text} /> : null}
      <Txt color={text} center style={{ flexShrink: 1 }}>
        {props.label}
      </Txt>
    </Pressable>
  );
}
/** A big choice. Chosen is shown by a tick as well as by colour. */
export function Choice(props: {
  label: string;
  onPress: () => void;
  chosen?: boolean;
  icon?: IconName;
  testID?: string;
  flex?: boolean;
  detail?: string;
}) {
  return (
    <Pressable
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: Boolean(props.chosen) }}
      onPress={props.onPress}
      style={({ pressed }) => [
        {
          minHeight: touchStaff,
          backgroundColor: props.chosen ? colors.ink : pressed ? colors.wellPress : colors.well,
          borderRadius: radiusControl,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        },
        props.flex ? { flex: 1 } : null,
      ]}
    >
      {props.chosen ? (
        <Icon name="check" color={colors.paper} />
      ) : props.icon ? (
        <Icon name={props.icon} />
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt color={props.chosen ? colors.paper : colors.ink}>{props.label}</Txt>
        {props.detail ? (
          <Txt kind="small" color={props.chosen ? colors.onNight2 : colors.ink2}>
            {props.detail}
          </Txt>
        ) : null}
      </View>
    </Pressable>
  );
}
export function Row(props: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[{ flexDirection: 'row', gap: space.sm }, props.style]}>{props.children}</View>
  );
}

export function Field(
  props: { label: string; testID?: string; error?: string | null } & TextInputProps,
) {
  const { label, testID, error, style, ...input } = props;
  return (
    <View style={{ gap: space.xs }}>
      <Txt>{label}</Txt>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        placeholderTextColor={colors.ink2}
        {...input}
        style={[
          {
            minHeight: touchStaff,
            fontFamily: font,
            fontSize: staffType.body,
            color: colors.ink,
            backgroundColor: colors.paper,
            borderWidth: 1.5,
            borderColor: colors.ink,
            borderRadius: radiusControl,
            paddingHorizontal: space.md,
          },
          style,
        ]}
      />
      {error ? <Txt color={colors.danger}>{error}</Txt> : null}
    </View>
  );
}
/** A figure with a minus and a plus, so the number can be set with no typing. */
export function Stepper(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  testID?: string;
  error?: string | null;
}) {
  const change = (by: number) => {
    const now = Number(props.value) || 0;
    props.onChange(String(Math.max(0, now + by)));
  };
  return (
    <View style={{ gap: space.xs }}>
      <Txt>{props.label}</Txt>
      <Row>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label} -1`}
          onPress={() => change(-1)}
          style={stepButton}
        >
          <Icon name="minus" size={28} />
        </Pressable>
        <TextInput
          testID={props.testID}
          accessibilityLabel={props.label}
          value={props.value}
          onChangeText={(text) => props.onChange(text.replace(/\D/g, '').slice(0, 7))}
          keyboardType="number-pad"
          style={[numberBox, { flex: 1, minWidth: 0, width: '100%' }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${props.label} +1`}
          onPress={() => change(1)}
          style={stepButton}
        >
          <Icon name="plus" size={28} />
        </Pressable>
      </Row>
      {props.error ? <Txt color={colors.danger}>{props.error}</Txt> : null}
    </View>
  );
}
const stepButton: ViewStyle = {
  width: touchStaff,
  height: touchStaff,
  backgroundColor: colors.well,
  borderRadius: radiusControl,
  alignItems: 'center',
  justifyContent: 'center',
};
export const numberBox: TextStyle = {
  minHeight: touchStaff,
  fontFamily: font,
  fontSize: staffType.head,
  textAlign: 'center',
  color: colors.ink,
  backgroundColor: colors.paper,
  borderWidth: 1.5,
  borderColor: colors.ink,
  borderRadius: radiusControl,
  paddingHorizontal: space.sm,
  fontVariant: ['tabular-nums'],
};

export function Band(props: {
  text: string;
  icon?: IconName;
  tone?: 'warn' | 'danger';
  action?: { label: string; onPress: () => void; testID?: string };
  testID?: string;
}) {
  const danger = props.tone === 'danger';
  return (
    <View
      testID={props.testID}
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: danger ? colors.dangerSoft : colors.warnSoft,
        padding: space.md,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
        <Icon
          name={props.icon ?? 'alert-triangle'}
          size={22}
          color={danger ? colors.danger : colors.warn}
        />
        <Txt style={{ flex: 1 }}>{props.text}</Txt>
      </View>
      {props.action ? (
        <Btn
          kind="line"
          label={props.action.label}
          onPress={props.action.onPress}
          {...(props.action.testID ? { testID: props.action.testID } : {})}
        />
      ) : null}
    </View>
  );
}

/** A status: always a word, with a shape as well as a colour. */
export function Shape(props: {
  kind: 'square' | 'triangle' | 'hollow' | 'dash' | 'diamond';
  color: string;
  size?: number;
}) {
  const size = props.size ?? 12;
  switch (props.kind) {
    case 'square':
      return <View style={{ width: size, height: size, backgroundColor: props.color }} />;
    case 'hollow':
      return (
        <View style={{ width: size, height: size, borderWidth: 2, borderColor: props.color }} />
      );
    case 'dash':
      return <View style={{ width: size, height: 3, backgroundColor: props.color }} />;
    case 'diamond':
      return (
        <View
          style={{
            width: size - 2,
            height: size - 2,
            margin: 1,
            backgroundColor: props.color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      );
    case 'triangle':
      return (
        <View
          style={{
            width: 0,
            height: 0,
            borderLeftWidth: size / 2 + 1,
            borderRightWidth: size / 2 + 1,
            borderBottomWidth: size,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: props.color,
          }}
        />
      );
  }
}
export function Tag(props: {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'off';
  testID?: string;
}) {
  const look = {
    ok: { kind: 'square', color: colors.ok },
    warn: { kind: 'triangle', color: colors.warn },
    danger: { kind: 'hollow', color: colors.danger },
    off: { kind: 'dash', color: colors.ink2 },
  } as const;
  const { kind, color } = look[props.tone];
  return (
    <View
      testID={props.testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
    >
      <Shape kind={kind} color={color} />
      <Txt style={{ flexShrink: 1 }}>{props.text}</Txt>
    </View>
  );
}
export function Card(props: { children: ReactNode; quiet?: boolean; testID?: string }) {
  return (
    <View
      testID={props.testID}
      style={[
        { padding: space.md, gap: space.sm },
        props.quiet
          ? { borderTopWidth: 1, borderTopColor: colors.rule }
          : { backgroundColor: colors.well, borderRadius: radiusControl },
      ]}
    >
      {props.children}
    </View>
  );
}

/** One screen: the top bar, the words, and the job's buttons at thumb height. */
export function Screen(props: {
  top?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  tabs?: ReactNode;
  band?: ReactNode;
  testID?: string;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = (
    <View style={{ flexGrow: 1, gap: space.md, padding: space.lg }}>{props.children}</View>
  );
  return (
    <KeyboardAvoidingView
      testID={props.testID}
      behavior="padding"
      style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.paper} />
      {props.top}
      {props.band}
      {props.scroll === false ? (
        <View style={{ flex: 1 }}>{body}</View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
        >
          {body}
        </ScrollView>
      )}
      {props.footer ? (
        <View
          style={{
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: props.tabs ? space.sm : Math.max(insets.bottom, space.lg),
          }}
        >
          {props.footer}
        </View>
      ) : null}
      {props.tabs ? <View style={{ paddingBottom: insets.bottom }}>{props.tabs}</View> : null}
    </KeyboardAvoidingView>
  );
}

/**
 * Runs a job once however many times the button is hit. The lock is taken before anything else, so
 * a second tap in the same moment finds it held, and a double tap can never do a thing twice.
 */
export function useOnce() {
  const held = useRef(false);
  const [busy, setBusy] = useState(false);
  const once = (job: () => Promise<unknown> | unknown) => {
    if (held.current) return;
    held.current = true;
    setBusy(true);
    void Promise.resolve()
      .then(job)
      .catch(() => {})
      .finally(() => {
        held.current = false;
        setBusy(false);
      });
  };
  return { busy, once };
}

/** Whether to skip the one movement this app has. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      listener.remove();
    };
  }, []);
  return reduced;
}

export type FloodTone = 'ok' | 'amber' | 'red';
const floodLook: Record<FloodTone, { fill: string; text: string }> = {
  ok: { fill: colors.ok, text: colors.onSolid },
  amber: { fill: colors.warnSoft, text: colors.ink },
  red: { fill: colors.danger, text: colors.onSolid },
};
/**
 * The whole screen, one colour, and what happened in big words. Green rises from the ground in
 * 400 ms: the only movement in the app. With reduced motion it is simply there, the same colour.
 */
export function Flood(props: {
  tone: FloodTone;
  icon: IconName;
  title: string;
  lines?: string[];
  actions: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const look = floodLook[props.tone];
  const height = Dimensions.get('window').height;
  const rise = useRef(new Animated.Value(props.tone === 'ok' ? height : 0)).current;
  const reduced = useReducedMotion();
  // A double tap on the button underneath must not land on this one and dismiss it unread.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), floodArmMs);
    return () => clearTimeout(timer);
  }, [props.tone, props.title]);
  useEffect(() => {
    if (props.tone !== 'ok') {
      rise.setValue(0);
      return;
    }
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!live) return;
      if (value) {
        rise.setValue(0);
        return;
      }
      Animated.timing(rise, {
        toValue: 0,
        duration: floodMs,
        easing: Easing.bezier(...floodEasing),
        useNativeDriver: true,
      }).start();
    });
    return () => {
      live = false;
    };
  }, [props.tone]);
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: reduced ? look.fill : colors.paper }]}
    >
      <Animated.View
        testID={props.testID ?? `flood-${props.tone}`}
        accessibilityRole={props.tone === 'red' ? 'alert' : 'summary'}
        accessibilityLiveRegion="assertive"
        style={{
          flex: 1,
          backgroundColor: look.fill,
          paddingTop: insets.top + space.lg,
          paddingBottom: Math.max(insets.bottom, space.lg),
          paddingHorizontal: space.lg,
          transform: [{ translateY: rise }],
        }}
      >
        <StatusBar
          barStyle={props.tone === 'amber' ? 'dark-content' : 'light-content'}
          backgroundColor={look.fill}
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: space.md }}
        >
          <Icon name={props.icon} size={48} color={look.text} />
          <Txt kind="number" color={look.text} testID="flood-title">
            {props.title}
          </Txt>
          {(props.lines ?? []).map((line) => (
            <Txt key={line} color={look.text}>
              {line}
            </Txt>
          ))}
        </ScrollView>
        <View
          pointerEvents={armed ? 'auto' : 'none'}
          style={{ gap: space.sm, paddingTop: space.lg }}
        >
          {props.actions}
        </View>
      </Animated.View>
    </View>
  );
}
