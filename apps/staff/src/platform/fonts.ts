import { FontDisplay, loadAsync } from 'expo-font';
import { HankenGrotesk_500Medium } from '@expo-google-fonts/hanken-grotesk/500Medium';

// Web build: served from the app's own origin and swapped in when it arrives.
export const font = "HankenGrotesk_500Medium, 'Hanken Grotesk', Arial, sans-serif";

void loadAsync({
  HankenGrotesk_500Medium: { uri: HankenGrotesk_500Medium, display: FontDisplay.SWAP },
}).catch(() => {});
