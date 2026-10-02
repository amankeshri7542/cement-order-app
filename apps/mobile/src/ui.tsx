import {
  ActivityIndicator,
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
  navy: '#142c43',
  yellow: '#f5c344',
  ink: '#1c3044',
  muted: '#607484',
  line: '#e5ebef',
  paper: '#f4f6f8',
  green: '#257659',
  white: '#fff',
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
        placeholderTextColor="#9aa7b2"
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
        <Icon name={icon} size={33} color="#698297" />
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
          backgroundColor: tone === 'green' ? '#eaf5ef' : tone === 'yellow' ? '#fff4d6' : '#edf1f5',
        },
      ]}
    >
      <Text
        style={[
          s.tagText,
          { color: tone === 'green' ? C.green : tone === 'yellow' ? '#947222' : '#647888' },
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
    borderRadius: 8,
    backgroundColor: C.yellow,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: C.navy, fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: C.white, borderWidth: 1, borderColor: '#d8e0e7' },
  field: { gap: 8 },
  label: { fontSize: 12, color: '#5d7182', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#dbe3e9',
    borderRadius: 7,
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
  noticeText: { fontSize: 12, lineHeight: 19, color: '#856720', flex: 1 },
  empty: { paddingVertical: 50, paddingHorizontal: 24, alignItems: 'center' },
  emptyIcon: {
    height: 74,
    width: 74,
    borderRadius: 37,
    backgroundColor: '#eaf0f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: C.ink, textAlign: 'center', maxWidth: 310 },
  emptyBody: {
    fontSize: 13,
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
  },
  sectionAction: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44 },
  h2: { color: C.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  link: { color: C.navy, fontWeight: '600', fontSize: 12 },
  tag: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4 },
  tagText: { fontSize: 10, fontWeight: '600' },
  card: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 20,
  },
  stack: { gap: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: C.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  body: { color: C.muted, fontSize: 13, lineHeight: 21 },
  eyebrow: { color: '#7c8f9f', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  price: { color: C.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 5 },
});
