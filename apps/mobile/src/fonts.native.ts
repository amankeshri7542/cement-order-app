import { Platform } from 'react-native';

// Teko 600 (Latin and Devanagari) is embedded at build time by the expo-font config plugin in
// app.config.ts, so it is there on the first frame with no loading step. Android names a font by
// its file name; iOS by the name inside the file.
export const displayFont = Platform.OS === 'ios' ? 'Teko-SemiBold' : 'Teko_600SemiBold';
