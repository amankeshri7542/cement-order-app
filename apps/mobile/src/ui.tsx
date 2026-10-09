import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
export const C = {
  navy: '#252C2B',
  yellow: '#E9AD32',
  ink: '#252C2B',
  muted: '#58615C',
  line: '#D0D2C9',
  paper: '#F7F6F1',
  green: '#386451',
  white: '#FFFFFF',
  concrete: '#E7E6E1',
  sand: '#D9C9A8',
  red: '#a23930',
};
export type IconName = ComponentProps<typeof Ionicons>['name'];
export function Icon({
  name,
  color = C.ink,
  size = 21,
}: {
  name: IconName;
  color?: string;
  size?: number;
}) {
  return <Ionicons name={name} color={color} size={size} aria-hidden accessible={false} />;
}
export function Button({
  children,
  onPress,
  secondary,
  disabled,
  loading,
  icon,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={C.navy} />
      ) : (
        <>
          <Text style={s.buttonText}>{children}</Text>
          {icon && <Icon name={icon} size={18} />}
        </>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={C.muted}
        {...props}
        style={[
          s.input,
          props.multiline && { minHeight: 84, textAlignVertical: 'top' },
          props.style,
        ]}
      />
    </View>
  );
}
export function Notice({ children, error }: { children: ReactNode; error?: boolean }) {
  return (
    <View
      accessibilityRole={error ? 'alert' : undefined}
      style={[s.notice, error && { backgroundColor: '#fff0ed' }]}
    >
      <Icon
        name={error ? 'alert-circle-outline' : 'information-circle-outline'}
        color={error ? C.red : '#856720'}
        size={19}
      />
      <Text style={[s.noticeText, error && { color: C.red }]}>{children}</Text>
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
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Icon name={icon} size={33} color={C.muted} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
      {action && onAction && (
        <Button onPress={onAction} style={{ marginTop: 20 }}>
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
      <Text style={s.h2}>{title}</Text>
      {action && (
        <Pressable accessibilityRole="button" onPress={onAction} style={s.sectionAction}>
          <Text style={s.link}>{action}</Text>
          <Icon name="arrow-forward" size={15} />
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
  tone?: 'green' | 'yellow' | 'grey';
}) {
  return (
    <View
      style={[
        s.tag,
        {
          backgroundColor:
            tone === 'green' ? '#E8EFE9' : tone === 'yellow' ? '#F8EDCD' : C.concrete,
        },
      ]}
    >
      <Text
        style={[
          s.tagText,
          { color: tone === 'green' ? C.green : tone === 'yellow' ? '#70531A' : C.muted },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
export const s = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 4,
    backgroundColor: C.yellow,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: C.navy, fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line },
  field: { gap: 8 },
  label: { fontSize: 13, color: C.muted, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    backgroundColor: C.white,
    color: C.ink,
    padding: 13,
    fontSize: 14,
    minHeight: 48,
  },
  notice: {
    backgroundColor: '#fff5d9',
    padding: 14,
    borderRadius: 7,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  noticeText: { fontSize: 14, lineHeight: 21, color: '#70531A', flex: 1 },
  empty: { paddingVertical: 50, paddingHorizontal: 24, alignItems: 'center' },
  emptyIcon: {
    height: 74,
    width: 74,
    borderRadius: 37,
    backgroundColor: C.concrete,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: C.ink, textAlign: 'center', maxWidth: 310 },
  emptyBody: {
    fontSize: 14,
    color: C.muted,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 310,
    marginTop: 10,
  },
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 27,
    marginBottom: 16,
    gap: 12,
    flexWrap: 'wrap',
  },
  sectionAction: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44 },
  h2: { color: C.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  link: { color: C.navy, fontWeight: '600', fontSize: 14 },
  tag: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4 },
  tagText: { fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 5,
    padding: 20,
  },
  stack: { gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: C.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  body: { color: C.muted, fontSize: 14, lineHeight: 22 },
  eyebrow: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  specification: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  price: { color: C.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 5 },
});
