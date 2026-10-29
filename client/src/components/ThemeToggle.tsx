import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

export function ThemeToggle({ label = false }: { label?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { user, setUser } = useAuth();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  function toggle() {
    setTheme(next);
    if (user) void api.users.updatePreferences(next).then(({ user: updated }) => setUser(updated)).catch(() => undefined);
  }
  return <button className="icon-button theme-toggle" type="button" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
    {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}{label && <span>{resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
  </button>;
}
