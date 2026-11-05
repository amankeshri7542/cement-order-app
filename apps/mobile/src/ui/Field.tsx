import { useRef, type Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { C, radius, space, T } from './tokens';

/** A visible label above; a paper fill; a real border. Forms are one of the places lines belong. */
export function Field({
  label,
  hint,
  error,
  ref,
  prefix,
  ...props
}: TextInputProps & {
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  ref?: Ref<TextInput>;
}) {
  const input = useRef<TextInput | null>(null);
  const attach = (node: TextInput | null) => {
    input.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <View style={styles.field}>
      {/* A tap on the label goes to its field. TalkBack reads the label on the field itself. */}
      <Text
        style={T.bodyStrong}
        importantForAccessibility="no"
        onPress={() => input.current?.focus()}
      >
        {label}
      </Text>
      <View style={[styles.box, props.multiline && styles.tall, error ? styles.bad : null]}>
        {prefix ? (
          <Text style={[T.body, styles.prefix]} numberOfLines={1}>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          ref={attach}
          accessibilityLabel={label}
          accessibilityHint={hint}
          placeholderTextColor={C.ink2}
          {...props}
          style={[T.body, styles.input, props.multiline && styles.tallInput, props.style]}
        />
      </View>
      {error ? (
        <Text accessibilityLiveRegion="polite" style={[T.small, { color: C.danger }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[T.small, { color: C.ink2 }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: radius.control,
    backgroundColor: C.up,
    paddingHorizontal: space[3],
  },
  bad: { borderColor: C.danger },
  tall: { alignItems: 'flex-start', minHeight: 96 },
  prefix: { color: C.ink2, marginRight: space[2], flexShrink: 0 },
  input: { flex: 1, minHeight: 48, paddingVertical: space[2], color: C.ink },
  tallInput: { textAlignVertical: 'top' },
});
