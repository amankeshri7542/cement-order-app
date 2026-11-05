import { FontDisplay, loadAsync } from 'expo-font';
import { HankenGrotesk_300Light } from '@expo-google-fonts/hanken-grotesk/300Light';
import { HankenGrotesk_400Regular } from '@expo-google-fonts/hanken-grotesk/400Regular';
import { HankenGrotesk_500Medium } from '@expo-google-fonts/hanken-grotesk/500Medium';

// Browser test build: served from the app's own origin (CSP font-src 'self') and swapped in when it
// arrives, so text is never invisible. A phone embeds the same files at build time.
const stack = "'Helvetica Neue', Helvetica, Arial, sans-serif";
export const fonts = {
  light: `HankenGrotesk_300Light, ${stack}`,
  regular: `HankenGrotesk_400Regular, ${stack}`,
  medium: `HankenGrotesk_500Medium, ${stack}`,
} as const;

void loadAsync({
  HankenGrotesk_300Light: { uri: HankenGrotesk_300Light, display: FontDisplay.SWAP },
  HankenGrotesk_400Regular: { uri: HankenGrotesk_400Regular, display: FontDisplay.SWAP },
  HankenGrotesk_500Medium: { uri: HankenGrotesk_500Medium, display: FontDisplay.SWAP },
}).catch(() => {});
