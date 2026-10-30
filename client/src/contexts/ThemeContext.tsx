import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemePreference } from '../types';

export type ResolvedTheme = 'dark' | 'light' | 'cyber' | 'aurora' | 'system';

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  selectTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const USER_THEME_CHOICE = 'opspilot-theme-user-selected';
const VALID_THEMES: ThemePreference[] = ['light', 'dark', 'system', 'cyber', 'aurora'];

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') return 'system';
  return (theme as ResolvedTheme) || 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('opspilot-theme');
    const hasUserChoice = localStorage.getItem(USER_THEME_CHOICE) === 'true';
    return hasUserChoice && VALID_THEMES.includes(saved as ThemePreference) ? saved as ThemePreference : 'system';
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  const selectTheme = useCallback((nextTheme: ThemePreference) => {
    localStorage.setItem(USER_THEME_CHOICE, 'true');
    setThemeState(nextTheme);
  }, []);

  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem('opspilot-theme', theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme: setThemeState, selectTheme }), [theme, resolvedTheme, selectTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
