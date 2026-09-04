import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { DARK, LIGHT, type ThemeTokens } from './tokens';
import { fadeFor, type Fade } from './typography';

export type ThemeName = 'system' | 'dark' | 'light';
export type Scheme = 'dark' | 'light';

export interface ThemeValue {
  tokens: ThemeTokens;
  /**
   * Text-opacity ramp for THIS scheme. Per-scheme because the canvas's single
   * ramp fails WCAG AA -- see the note on `fadeFor` in typography.ts. Always
   * prefer this over the module-level `fade` import inside a component.
   */
  fade: Fade;
  /** The resolved scheme actually being painted. */
  scheme: Scheme;
  isDark: boolean;
  /** The user's setting, which may be 'system'. */
  name: ThemeName;
  setName: (n: ThemeName) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  children,
  initial = 'system',
}: {
  children: ReactNode;
  initial?: ThemeName;
}) {
  const [name, setName] = useState<ThemeName>(initial);
  const system = useColorScheme();


  // Match the canvas exactly. Its renderVals() reads
  //   theme === 'system' ? (mq ? mq.matches : true) : theme === 'dark'
  // so an UNKNOWN system preference resolves to DARK, not light.
  // useColorScheme() can return 'light', 'dark', 'unspecified', null or
  // undefined -- everything that is not an explicit choice is "unknown".
  const systemScheme: Scheme | null =
    system === 'light' || system === 'dark' ? system : null;
  const scheme: Scheme = name === 'system' ? (systemScheme ?? 'dark') : name;
  const tokens = scheme === 'dark' ? DARK : LIGHT;

  // Paint the window background too, or navigator transitions flash white
  // between screens before the new screen's own background mounts.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(tokens.base100).catch(() => {});
  }, [tokens]);

  const value = useMemo<ThemeValue>(
    () => ({ tokens, fade: fadeFor[scheme], scheme, isDark: scheme === 'dark', name, setName }),
    [tokens, scheme, name],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
