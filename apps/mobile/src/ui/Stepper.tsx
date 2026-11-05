import { memo, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { nextDown, nextUp, parseTyped } from '../logic/quantity-steps';
import { w } from '../words';
import { Icon } from './Icon';
import { C, radius, T } from './tokens';

/**
 * A quantity you can step or type into: 200 bori is one entry, not forty taps. What is being typed
 * is never overwritten by a save finishing in the background.
 */
export const Stepper = memo(function Stepper({
  name,
  value,
  min,
  step,
  onChange,
  onInvalid,
}: {
  /** What this is the quantity of, for TalkBack. */
  name: string;
  value: number;
  min: number;
  step: number;
  /** 0 means take it off the list. */
  onChange: (next: number) => void;
  onInvalid?: (text: string) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);
  function commit() {
    if (!editing.current) return;
    editing.current = false;
    const typed = parseTyped(draft, min, step);
    if (typed === null) {
      setDraft(String(value));
      onInvalid?.(w('stepper.invalid', { min, step }));
      return;
    }
    setDraft(String(typed));
    if (typed !== value) onChange(typed);
  }
  // Closing the keyboard with the back button leaves the field focused, with no blur. What is on
  // screen must be what the total is worked out from, so it counts as finished.
  const commitNow = useRef(commit);
  commitNow.current = commit;
  useEffect(() => {
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      if (!editing.current) return;
      commitNow.current();
      input.current?.blur();
    });
    return () => hidden.remove();
  }, []);
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={w('stepper.less', { name })}
        onPress={() => onChange(nextDown(value, min, step))}
        style={styles.button}
      >
        <Icon name="remove" size={20} />
      </Pressable>
      <TextInput
        ref={input}
        accessibilityLabel={w('stepper.quantity', { name })}
        value={draft}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={5}
        onFocus={() => {
          editing.current = true;
        }}
        onChangeText={(text) => {
          if (!/^\d*$/.test(text)) return;
          setDraft(text);
          // A whole valid number counts at once, so a total can never lag behind what is typed.
          const typed = parseTyped(text, min, step);
          if (typed) onChange(typed);
        }}
        onBlur={commit}
        onSubmitEditing={commit}
        style={[T.rateSmall, styles.value]}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={w('stepper.more', { name })}
        onPress={() => onChange(nextUp(value, min, step))}
        style={styles.button}
      >
        <Icon name="add" size={20} />
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.ink,
    borderRadius: radius.control,
    backgroundColor: C.up,
  },
  button: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  value: { width: 56, height: 48, padding: 0, textAlign: 'center', color: C.ink },
});
