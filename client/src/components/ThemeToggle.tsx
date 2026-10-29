import { Check, Leaf, Moon, Palette, Sparkles, Sun } from 'lucide-react';
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
    name: 'Forest After Hours',
    category: 'Recommended · deep evergreen surfaces',
    icon: Moon,
    color: '#14231b',
    accent: '#8bb49a',
  },
  {
    id: 'light',
    name: 'Warm Operations',
    category: 'Ivory surfaces with forest and clay accents',
    icon: Sun,
    color: '#faf7f0',
    accent: '#315f48',
  },
  {
    id: 'cyber',
    name: 'Olive Night',
    category: 'Deep olive with warm parchment text',
    icon: Leaf,
    color: '#202319',
    accent: '#b6a56a',
  },
  {
    id: 'aurora',
    name: 'Forest Canopy',
    category: 'Deep green with soft botanical accents',
    icon: Sparkles,
    color: '#13251d',
    accent: '#80b394',
  },
  {
    id: 'system',
    name: 'System Default',
    category: 'Auto match device preference',
    icon: Palette,
    color: '#faf7f0',
    accent: '#b96548',
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
