import * as Haptics from 'expo-haptics';

/** A short, light vibration confirming an action such as adding to the basket. */
export function tap() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
