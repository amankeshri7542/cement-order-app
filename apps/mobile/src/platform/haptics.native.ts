import * as Haptics from 'expo-haptics';

/** A short, light vibration. On Add and on a placed order, nothing else (plan 04 section 5.1). */
export function tap() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
