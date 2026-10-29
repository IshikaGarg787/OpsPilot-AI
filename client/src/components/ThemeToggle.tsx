import { Check, ChevronDown, Moon, Palette, ShieldAlert, Sparkles, Sun, Terminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import type { ThemePreference } from '../types';

interface ThemeOption {
  id: ThemePreference;
  name: string;
  category: string;
  icon: typeof Sun;
  color: string;
  accent: string;
}

const themeOptions: ThemeOption[] = [
  {
    id: 'dark',
    name: 'Graphite Night',
    category: 'Low-glare neutral dark',
    icon: Moon,
    color: '#0b1020',
    accent: '#73a7ff',
  },
  {
    id: 'light',
    name: 'Operations Slate',
    category: 'Recommended · clear daylight surfaces',
    icon: Sun,
    color: '#f1f2f0',
    accent: '#596e72',
  },
  {
    id: 'cyber',
    name: 'Deep Slate',
    category: 'Cool charcoal with restrained blue',
    icon: Terminal,
    color: '#0d1117',
    accent: '#38bdf8',
  },
  {
    id: 'aurora',
    name: 'Field Green',
    category: 'Muted green for service operations',
    icon: Sparkles,
    color: '#061412',
    accent: '#10b981',
  },
  {
    id: 'system',
    name: 'System Default',
    category: 'Auto match device preference',
    icon: Palette,
    color: '#15213a',
    accent: '#a88bff',
  },
];

export function ThemeToggle({ label = false }: { label?: boolean }) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { user, setUser } = useAuth();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  function selectTheme(nextTheme: ThemePreference) {
    setTheme(nextTheme);
    setOpen(false);
    if (user) {
      // Backend only validates 'light' | 'dark' | 'system'; cyber and aurora map safely to dark
      const backendPreference = nextTheme === 'light' ? 'light' : nextTheme === 'system' ? 'system' : 'dark';
      void api.users.updatePreferences(backendPreference).then(({ user: updated }) => setUser(updated)).catch(() => undefined);
    }
  }

  const currentOption = themeOptions.find((opt) => opt.id === theme) ?? themeOptions[0];
  const CurrentIcon = currentOption.icon;

  return (
    <div className="theme-toggle-wrapper" ref={dropdownRef}>
      <button
        className="icon-button theme-toggle-button"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Select theme options"
        title={`Current theme: ${currentOption.name}. Click to switch theme.`}
        aria-expanded={open}
      >
        <CurrentIcon size={18} />
        {label && <span className="theme-toggle-label">{currentOption.name}</span>}
      </button>

      {open && (
        <div className="theme-dropdown-menu" role="menu">
          <div className="theme-dropdown-header">
            <span>Theme options</span>
            <small>Tailored for OpsPilot</small>
          </div>
          <div className="theme-dropdown-list">
            {themeOptions.map((opt) => {
              const OptionIcon = opt.icon;
              const isSelected = theme === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`theme-dropdown-item ${isSelected ? 'active' : ''}`}
                  onClick={() => selectTheme(opt.id)}
                  role="menuitem"
                >
                  <span className="theme-color-badge" style={{ background: opt.color, borderColor: opt.accent }}>
                    <span className="theme-color-dot" style={{ background: opt.accent }} />
                  </span>
                  <div className="theme-item-text">
                    <strong>{opt.name}</strong>
                    <small>{opt.category}</small>
                  </div>
                  {isSelected && <Check size={15} className="theme-check-icon" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
