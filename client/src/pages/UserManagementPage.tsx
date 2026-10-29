import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, ErrorState, LoadingState, PageIntro } from '../components/ui';
import { api, ApiError } from '../services/api';

type WorkspaceUser = { id: string; name: string; email: string; role: 'customer' | 'it_team' | 'admin'; createdAt: string };

export function UserManagementPage() {
  const [users, setUsers] = useState<WorkspaceUser[] | null>(null);
  const [error, setError] = useState('');
  async function load() {
    setError('');
    try { setUsers((await api.tickets.users()).users as WorkspaceUser[]); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Workspace users are unavailable.'); }
  }
  useEffect(() => { void load(); }, []);
  if (error && !users) return <><PageIntro eyebrow="Admin controls" title="Users & roles" description="Review workspace accounts." /><ErrorState message={error} onRetry={() => void load()} /></>;
  if (!users) return <><PageIntro eyebrow="Admin controls" title="Users & roles" description="Review workspace accounts." /><LoadingState label="Loading workspace users" /></>;
  return <div className="page-stack"><PageIntro eyebrow="Admin controls" title="Users & roles" description="Review workspace accounts. Privileged roles are assigned through trusted provisioning only." action={<button className="button button-ghost" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>} />{error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}<Card title="Workspace members" className="user-management-card"><div className="user-table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Current role</th><th>Joined</th></tr></thead><tbody>{users.map((person) => <tr key={person.id}><td><span className="user-row-name"><span className="user-avatar-small">{person.name.slice(0, 1).toUpperCase()}</span><span><strong>{person.name}</strong><small>{person.email}</small></span></span></td><td><span className={`role-badge role-${person.role}`}>{person.role === 'it_team' ? 'IT Team' : person.role}</span></td><td>{new Date(person.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div><p className="field-help">Public signup creates a standard user account. The approved IT onboarding policy and Admin provisioning procedure are managed outside this page.</p></Card></div>;
}
