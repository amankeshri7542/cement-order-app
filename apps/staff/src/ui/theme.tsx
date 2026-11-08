import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { palettes, type Palette, type Scheme, type ThemeChoice } from '@shiv/tokens';

/**
 * Light and dark for this app (plan v4 B1). A screen asks for its styles with useStyles, and they are
 * rebuilt only when the theme changes. "auto" follows the phone. The same file lives in the other
 * Expo app until the native kit (phase B5) makes it one package.
 */
type Theme = { scheme: Scheme; c: Palette };
const ThemeContext = createContext<Theme>({ scheme: 'light', c: palettes.light });

export function ThemeProvider({
  choice = 'auto',
  children,
}: {
  choice?: ThemeChoice;
  children: ReactNode;
}) {
  const device = useColorScheme();
  const scheme: Scheme = choice === 'auto' ? (device === 'dark' ? 'dark' : 'light') : choice;
  const value = useMemo(() => ({ scheme, c: palettes[scheme] }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** Styles drawn from the theme, made once per theme and per screen. */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(build: (c: Palette) => T) {
  const cache = new Map<Scheme, T>();
  return function useStyles(): T {
    const { scheme, c } = useTheme();
    let styles = cache.get(scheme);
    if (!styles) {
      styles = StyleSheet.create(build(c));
      cache.set(scheme, styles);
    }
    return styles;
  };
}
