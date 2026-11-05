// Hanken Grotesk is embedded at build time by the expo-font config plugin (app.config.ts), so it is
// there on the first frame with no loading step. Android names a font by its file name.
export const fonts = {
  light: 'HankenGrotesk_300Light',
  regular: 'HankenGrotesk_400Regular',
  medium: 'HankenGrotesk_500Medium',
} as const;
