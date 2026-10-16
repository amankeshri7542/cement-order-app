import { FontDisplay, loadAsync } from 'expo-font';
import { Teko_600SemiBold } from '@expo-google-fonts/teko/600SemiBold';

// Web build: Teko 600 is served from the app's own origin (CSP font-src 'self') and swapped in
// when it arrives, so text is never invisible while it loads. The fallbacks match the website's
// --display stack. Android embeds the same file at build time (see fonts.native.ts).
export const displayFont =
  "Teko_600SemiBold, 'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Arial Narrow', sans-serif";

void loadAsync({ Teko_600SemiBold: { uri: Teko_600SemiBold, display: FontDisplay.SWAP } }).catch(
  () => {},
);
