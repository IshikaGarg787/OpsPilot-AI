import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThemePreference } from '../types';

export type ResolvedTheme = 'dark' | 'light' | 'cyber' | 'aurora' | 'system';

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const WARM_DEFAULT_MIGRATION = 'opspilot-warm-operations-v2';

function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme === 'system') return 'system';
  return (theme as ResolvedTheme) || 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    if (localStorage.getItem(WARM_DEFAULT_MIGRATION) !== 'done') return 'light';
    return (localStorage.getItem('opspilot-theme') as ThemePreference | null) ?? 'light';
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem('opspilot-theme', theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme: setThemeState }), [theme, resolvedTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
