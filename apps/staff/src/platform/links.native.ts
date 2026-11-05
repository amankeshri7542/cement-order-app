import { Linking } from 'react-native';

/** Opens the phone's dialler or the map. Nothing else is ever handed over. */
export function openLink(url: string) {
  void Linking.openURL(url).catch(() => {});
}
