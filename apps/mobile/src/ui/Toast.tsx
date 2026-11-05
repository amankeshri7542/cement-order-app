import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hideToast, uiStore } from '../state/ui';
import { useSelect } from '../state/use';
import { w } from '../words';
import { ease } from './motion';
import { C, motion, radius, space, T, touch } from './tokens';

/** One short message near the top, so it never covers a screen's main button. */
export function Toast() {
  const toast = useSelect(uiStore, (state) => state.toast);
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (toast) {
      rise.setValue(0);
      ease(rise, 1, motion.ui);
    }
  }, [toast, rise]);
  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          top: insets.top + space[2],
          opacity: rise,
          transform: [
            { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
          ],
        },
      ]}
    >
      <View style={styles.toast}>
        <Text accessibilityLiveRegion="polite" style={[T.body, styles.text]}>
          {toast.text}
        </Text>
        {toast.undo ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              toast.undo?.();
              hideToast();
            }}
            style={styles.undo}
          >
            <Text style={[T.bodyStrong, { color: C.diya }]}>{w('common.undo')}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space[3], right: space[3], zIndex: 10 },
  toast: {
    backgroundColor: C.night,
    borderRadius: radius.control,
    padding: space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    elevation: 8,
  },
  text: { flex: 1, color: C.onNight },
  undo: { minHeight: touch, justifyContent: 'center', paddingHorizontal: space[2] },
});
