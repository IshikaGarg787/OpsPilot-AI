import { Check, LogOut, Moon, Palette, Save, Sparkles, Sun, Terminal, UserRound } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, ErrorState, Notice, PageIntro } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { api, ApiError } from '../services/api';
import type { ThemePreference } from '../types';

export function SettingsPage() {
  const { user, setUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [skillsText, setSkillsText] = useState((user?.skills ?? []).join(', '));
  const [availability, setAvailability] = useState<'available' | 'unavailable'>(user?.availability ?? 'available');
  const [selectedTheme, setSelectedTheme] = useState<ThemePreference>(theme);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(user?.name ?? '');
    setSelectedTheme(theme);
    setSkillsText((user?.skills ?? []).join(', '));
    setAvailability(user?.availability ?? 'available');
  }, [theme, user?.name, user?.skills, user?.availability]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const profile = name.trim() !== user?.name ? await api.users.updateProfile(name) : { user };
      const backendPref = selectedTheme === 'light' ? 'light' : selectedTheme === 'system' ? 'system' : 'dark';
      const preferences = selectedTheme !== theme ? await api.users.updatePreferences(backendPref) : { user: profile.user };
      setUser(preferences.user);
      setTheme(selectedTheme);
      setMessage('Settings saved to your workspace.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function saveItProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.users.updateItProfile({ skills: skillsText.split(',').map((value) => value.trim()).filter(Boolean), availability });
      if (user) setUser({ ...user, skills: result.profile.skills, availability: result.profile.availability });
      setMessage('Skills and availability saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'IT profile could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="page-stack">
      <PageIntro eyebrow="Workspace preferences" title="Settings" description="Keep your profile and display preferences in sync across sessions." />
      {message && <Notice variant="success"><strong>{message}</strong></Notice>}
      {error && <ErrorState message={error} />}

      <div className="settings-grid">
        <Card title="Profile" action={<UserRound size={18} className="card-heading-icon" />}>
          <form className="settings-form" onSubmit={submit}>
            <label className="field">
              <span>Display name</span>
              <div className="field-control"><UserRound size={17} /><input value={name} onChange={(event) => setName(event.target.value)} /></div>
            </label>
            <label className="field">
              <span>Work email</span>
              <div className="field-control is-readonly"><input value={user?.email ?? ''} readOnly /></div>
              <small className="field-help">Email changes are not enabled in this release.</small>
            </label>
            <button className="button button-primary" type="submit" disabled={busy}><Save size={16} />{busy ? 'Saving…' : 'Save changes'}</button>
          </form>
        </Card>

        {user?.role === 'it_team' && (
          <Card title="IT skills and availability">
            <form className="settings-form" onSubmit={saveItProfile}>
              <label className="field">
                <span>Skills</span>
                <input value={skillsText} onChange={(event) => setSkillsText(event.target.value)} placeholder="Networking, Windows, account access" />
                <small className="field-help">Separate skills with commas so Admins can match work to your experience.</small>
              </label>
              <label className="field">
                <span>Availability</span>
                <select value={availability} onChange={(event) => setAvailability(event.target.value as 'available' | 'unavailable')}>
                  <option value="available">Available for work</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
              <small className="field-help">An active assigned ticket also marks you as occupied.</small>
              <button className="button button-primary" type="submit" disabled={busy}><Save size={16} />Save IT profile</button>
            </form>
          </Card>
        )}

        <Card title="Display preference">
          <div className="theme-options">
            <button
              type="button"
              className={`theme-option ${selectedTheme === 'dark' ? 'selected' : ''}`}
              onClick={() => { setSelectedTheme('dark'); setTheme('dark'); }}
            >
              <Moon size={19} />
              <span>
                <strong>Graphite Night</strong>
                <small>Low-glare neutral dark surfaces</small>
              </span>
              {selectedTheme === 'dark' && <Check size={17} />}
            </button>

            <button
              type="button"
              className={`theme-option ${selectedTheme === 'light' ? 'selected' : ''}`}
              onClick={() => { setSelectedTheme('light'); setTheme('light'); }}
            >
              <Sun size={19} />
              <span>
                <strong>Operations Slate</strong>
                <small>Recommended: calm warm neutrals with restrained steel accents</small>
              </span>
              {selectedTheme === 'light' && <Check size={17} />}
            </button>

            <button
              type="button"
              className={`theme-option ${selectedTheme === 'cyber' ? 'selected' : ''}`}
              onClick={() => { setSelectedTheme('cyber'); setTheme('cyber'); }}
            >
              <Terminal size={19} />
              <span>
                <strong>Deep Slate</strong>
                <small>Cool charcoal with restrained blue accents</small>
              </span>
              {selectedTheme === 'cyber' && <Check size={17} />}
            </button>

            <button
              type="button"
              className={`theme-option ${selectedTheme === 'aurora' ? 'selected' : ''}`}
              onClick={() => { setSelectedTheme('aurora'); setTheme('aurora'); }}
            >
              <Sparkles size={19} />
              <span>
                <strong>Field Green</strong>
                <small>Muted green for service operations</small>
              </span>
              {selectedTheme === 'aurora' && <Check size={17} />}
            </button>

            <button
              type="button"
              className={`theme-option ${selectedTheme === 'system' ? 'selected' : ''}`}
              onClick={() => { setSelectedTheme('system'); setTheme('system'); }}
            >
              <Palette size={19} />
              <span>
                <strong>System Default</strong>
                <small>Follow your device operating system preference</small>
              </span>
              {selectedTheme === 'system' && <Check size={17} />}
            </button>
          </div>
          <p className="settings-caption">Clicking any theme applies it immediately. Press &ldquo;Save changes&rdquo; above to persist it to your account.</p>
        </Card>

        <Card title="Account and services">
          <div className="account-list">
            <div><span>Account role</span><strong>{user?.role ?? 'user'}</strong></div>
            <div><span>Application version</span><strong>0.1.0 · local release</strong></div>
            <div><span>Session security</span><strong>HTTP-only cookie</strong></div>
          </div>
          <button className="button button-danger" onClick={() => void signOut()}><LogOut size={16} /> Sign out</button>
        </Card>
      </div>
    </div>
  );
}
