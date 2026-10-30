import { Check, Leaf, Moon, Palette, Sun } from 'lucide-react';
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
    category: 'Charcoal surfaces with clear yellow accents and white text',
    icon: Moon,
    color: '#171717',
    accent: '#ffd400',
  },
  {
    id: 'light',
    name: 'Warm Operations',
    category: 'Default: ivory surfaces with forest and clay accents',
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
    category: 'Deep green surfaces with restrained botanical accents',
    icon: Leaf,
    color: '#102019',
    accent: '#83b88f',
  },
  {
    id: 'system',
    name: 'System Default',
    category: 'Clean blue surfaces with bright blue accents',
    icon: Palette,
    color: '#15263a',
    accent: '#65aaff',
  },
];

export function ThemeToggle({ label = false }: { label?: boolean }) {
  const { theme, resolvedTheme, selectTheme: chooseTheme } = useTheme();
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
    chooseTheme(nextTheme);
    setOpen(false);
    if (user) {
      // Backend only validates 'light' | 'dark' | 'system'; cyber and aurora map safely to dark
      const backendPreference = nextTheme === 'light' ? 'light' : nextTheme === 'system' ? 'system' : 'dark';
      void api.users.updatePreferences(backendPreference).then(({ user: updated }) => setUser(updated)).catch(() => undefined);
    }
  }

  const currentOption = themeOptions.find((opt) => opt.id === theme) ?? themeOptions.find((opt) => opt.id === 'system')!;
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
