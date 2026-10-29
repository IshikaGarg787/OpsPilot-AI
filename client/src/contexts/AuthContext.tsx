import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { AppRole, User } from '../types';
import { useTheme } from './ThemeContext';

type AuthContextValue = { user: User | null; loading: boolean; login: (email: string, password: string, remember: boolean, expectedRole: AppRole) => Promise<void>; signup: (name: string, email: string, password: string) => Promise<void>; logout: () => Promise<void>; setUser: (user: User | null) => void };
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { setTheme } = useTheme();
  useEffect(() => { api.auth.me().then(({ user: current }) => { setUser(current); setTheme(current.themePreference); }).catch(() => undefined).finally(() => setLoading(false)); }, [setTheme]);
  const value = useMemo<AuthContextValue>(() => ({
    user, loading, setUser,
    login: async (email, password, remember, expectedRole) => { const result = await api.auth.login({ email, password, remember, expectedRole }); setUser(result.user); setTheme(result.user.themePreference); },
    signup: async (name, email, password) => { const result = await api.auth.signup({ name, email, password, termsAccepted: true }); setUser(result.user); setTheme(result.user.themePreference); },
    logout: async () => { await api.auth.logout().catch(() => undefined); setUser(null); },
  }), [loading, setTheme, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('useAuth must be used inside AuthProvider'); return value; }