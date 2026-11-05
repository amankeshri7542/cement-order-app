import { AccessibilityInfo, Animated, Platform } from 'react-native';
import { motion } from './tokens';

// The app's whole motion list is plan 04 section 5.1, on React Native's own Animated with the
// native driver: transform and opacity only, started from a press, never written from a render.

/** Follows the phone's "remove animations" setting live, without a listener per button. */
let reducedNow = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reducedNow = value;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reducedNow = value;
});
export const reducedMotion = () => reducedNow;

export const nativeDriver = Platform.OS !== 'web';

/** Moves a value to `to`, or sets it at once under reduced motion. */
export function ease(
  value: Animated.Value,
  to: number,
  duration: number = motion.ui,
  done?: () => void,
) {
  if (reducedNow) {
    value.setValue(to);
    done?.();
    return;
  }
  Animated.timing(value, { toValue: to, duration, useNativeDriver: nativeDriver }).start(() =>
    done?.(),
  );
}
