import * as Haptics from 'expo-haptics';

/** One heavy buzz, with the green flood. */
export function confirmHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}
