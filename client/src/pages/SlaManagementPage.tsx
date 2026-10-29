import { useEffect, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../services/api';
import type { SlaOverview, SlaPolicy } from '../types';
import { Card, EmptyState, ErrorState, LoadingState, PageIntro } from '../components/ui';

const hours = (minutes: number) => (minutes / 60).toFixed(minutes % 60 ? 2 : 0);
const target = (value: number | null) => value == null ? '—' : `${value.toFixed(1)} h`;
const normalizeSearch = (value: string) => value.trim().normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').toLowerCase();

export function SlaManagementPage() {
  const [policies, setPolicies] = useState<SlaPolicy[] | null>(null);
  const [overview, setOverview] = useState<SlaOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [slaFilter, setSlaFilter] = useState('');
  const [draft, setDraft] = useState({ name: '', priority: '', firstResponseMinutes: '', resolutionMinutes: '' });

  async function load() {
    setError('');
    try { const [p, o] = await Promise.all([api.sla.policies(), api.sla.overview()]); setPolicies(p.policies); setOverview(o); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'SLA management data could not be loaded.'); }
  }
  useEffect(() => { void load(); }, []);
  async function savePolicy(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload = { ...draft, firstResponseMinutes: Number(draft.firstResponseMinutes), resolutionMinutes: Number(draft.resolutionMinutes) };
      if (editingId) {
        if (!window.confirm('Apply these SLA targets to tickets that become eligible from now on? Existing deadlines will be preserved.')) { setBusy(false); return; }
        await api.sla.updatePolicy(editingId, payload);
      } else {
        if (!window.confirm('Create and enable this SLA policy for new matching tickets?')) { setBusy(false); return; }
        await api.sla.createPolicy({ ...payload, enabled: true });
      }
      setEditingId(null);
      setDraft({ name: '', priority: '', firstResponseMinutes: '', resolutionMinutes: '' }); await load();
    } catch (e) { setError(e instanceof ApiError ? e.message : 'The policy could not be saved.'); }
    finally { setBusy(false); }
  }
  async function toggle(policy: SlaPolicy) {
    if (!window.confirm(`${policy.enabled ? 'Disable' : 'Enable'} the ${policy.name} SLA policy? Existing ticket deadlines remain unchanged.`)) return;
    try { await api.sla.updatePolicy(policy._id, { enabled: !policy.enabled }); await load(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'The policy could not be updated.'); }
  }
  function edit(policy: SlaPolicy) {
    setEditingId(policy._id);
    setDraft({ name: policy.name, priority: policy.priority, firstResponseMinutes: String(policy.firstResponseMinutes), resolutionMinutes: String(policy.resolutionMinutes) });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
  if (!policies && !error) return <><PageIntro eyebrow="Admin operations" title="SLA Management" description="Configure service targets and monitor ticket deadlines." /><LoadingState label="Loading SLA records" /></>;
  const metrics = overview?.metrics;
  const normalizedSearch = normalizeSearch(search);
  const visibleTickets = overview?.tickets.filter((t) => (!normalizedSearch || normalizeSearch(`${t.ticketNumber} ${t.subject}`).includes(normalizedSearch)) && (!priorityFilter || t.priority === priorityFilter) && (!statusFilter || t.status === statusFilter) && (!slaFilter || t.slaSnapshot?.firstResponseStatus === slaFilter || t.slaSnapshot?.resolutionStatus === slaFilter)) ?? [];
  return <div className="page-stack sla-management-page">
    <PageIntro eyebrow="Admin operations" title="SLA Management" description="Manage 24×7 calendar-time targets and monitor actual response and resolution outcomes." action={<span className="status-pill"><ShieldCheck size={15} /> Server evaluated</span>} />
    <p className="card-subtitle">Metrics cover all SLA-tracked tickets. Compliance uses resolved tickets only; response and resolution averages include records with an actual completion timestamp.</p>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <div className="metrics-grid">
      <Card><span className="eyebrow">Resolution compliance</span><strong className="triage-result-number">{metrics?.compliancePercent == null ? '—' : `${metrics.compliancePercent}%`}</strong><small>Resolved tickets meeting policy target</small></Card>
      <Card><span className="eyebrow">Approaching deadlines</span><strong className="triage-result-number">{metrics?.approaching ?? '—'}</strong><small>Active response or resolution at risk</small></Card>
      <Card><span className="eyebrow">Breached tickets</span><strong className="triage-result-number">{metrics?.breached ?? '—'}</strong><small>At least one active target overdue</small></Card>
      <Card><span className="eyebrow">Targets met</span><strong className="triage-result-number">{metrics?.met ?? '—'}</strong><small>Resolved within target</small></Card>
      <Card><span className="eyebrow">Average first response</span><strong className="triage-result-number">{target(metrics?.averageFirstResponseHours ?? null)}</strong><small>Tickets with a genuine staff reply</small></Card>
      <Card><span className="eyebrow">Average resolution</span><strong className="triage-result-number">{target(metrics?.averageResolutionHours ?? null)}</strong><small>Tickets with recorded resolution</small></Card>
    </div>
    <Card title="SLA policy targets"><p className="card-subtitle">Policy edits apply to newly eligible tickets. Stored ticket deadlines are preserved.</p>
      {policies?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Policy</th><th>Priority</th><th>First response</th><th>Resolution</th><th>State</th><th>Updated</th><th /></tr></thead><tbody>{policies.map((p) => <tr key={p._id}><td>{p.name}</td><td>{p.priority}</td><td>{p.firstResponseMinutes} min</td><td>{hours(p.resolutionMinutes)} h</td><td>{p.enabled ? 'Enabled' : 'Disabled'}</td><td>{new Date(p.updatedAt).toLocaleString()}</td><td><button className="button button-secondary" onClick={() => edit(p)}>Edit</button> <button className="button button-secondary" onClick={() => void toggle(p)}>{p.enabled ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div> : <EmptyState title="No SLA policies" description="Create a policy to start tracking eligible tickets." />}
    </Card>
    <Card title={editingId ? 'Edit policy' : 'Create policy'}><form className="form-grid-two" onSubmit={(e) => void savePolicy(e)}><label className="field"><span>Policy name</span><input required minLength={2} maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><label className="field"><span>Ticket priority key</span><input required value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} placeholder="e.g. Critical" /></label><label className="field"><span>First-response target (minutes)</span><input type="number" min="1" max="525600" required value={draft.firstResponseMinutes} onChange={(e) => setDraft({ ...draft, firstResponseMinutes: e.target.value })} /></label><label className="field"><span>Resolution target (minutes)</span><input type="number" min="1" max="525600" required value={draft.resolutionMinutes} onChange={(e) => setDraft({ ...draft, resolutionMinutes: e.target.value })} /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : <><Save size={15} /> {editingId ? 'Save changes' : 'Create policy'}</>}</button>{editingId && <button type="button" className="button button-secondary" onClick={() => { setEditingId(null); setDraft({ name: '', priority: '', firstResponseMinutes: '', resolutionMinutes: '' }); }}>Cancel edit</button>}</div></form></Card>
    <Card title="Ticket SLA monitoring"><p className="card-subtitle">Showing {visibleTickets.length} of {overview?.tickets.length ?? 0} recent tickets. Find the real ticket ID or subject in Ticket Queue; punctuation in the ID is ignored.</p><div className="form-grid-two"><label className="field"><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Actual ticket ID or subject" /></label><label className="field"><span>Priority</span><select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}><option value="">All priorities</option>{[...new Set(overview?.tickets.map((t) => t.priority) ?? [])].map((p) => <option key={p}>{p}</option>)}</select></label><label className="field"><span>Ticket status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option>{[...new Set(overview?.tickets.map((t) => t.status) ?? [])].map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}</select></label><label className="field"><span>SLA status</span><select value={slaFilter} onChange={(e) => setSlaFilter(e.target.value)}><option value="">All SLA states</option><option value="breached">Breached</option><option value="at_risk">At risk</option><option value="on_track">On track</option><option value="met">Met</option></select></label></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Ticket</th><th>Subject</th><th>Priority</th><th>Status</th><th>Assignee</th><th>First response deadline</th><th>Response SLA</th><th>Resolution deadline</th><th>Resolution SLA</th><th>Policy</th><th>Predicted delay risk</th></tr></thead><tbody>{visibleTickets.map((t) => <tr key={t._id}><td>{t.ticketNumber}</td><td>{t.subject}</td><td>{t.priority}</td><td>{t.status.replaceAll('_', ' ')}</td><td>{t.assignedTo?.name ?? 'Not assigned'}</td><td>{t.slaSnapshot?.firstResponseDeadlineAt ? new Date(t.slaSnapshot.firstResponseDeadlineAt).toLocaleString() : '—'}</td><td>{t.slaSnapshot?.firstResponseStatus ?? 'Not tracked'}</td><td>{t.slaSnapshot?.resolutionDeadlineAt ? new Date(t.slaSnapshot.resolutionDeadlineAt).toLocaleString() : '—'}</td><td>{t.slaSnapshot?.resolutionStatus ?? 'Not tracked'}</td><td>{t.slaSnapshot?.policyName ?? 'No active policy'}</td><td>{t.aiSignals?.delayRiskCategory ? `${t.aiSignals.delayRiskCategory}${t.aiSignals.delayRiskProbability == null ? '' : ` · ${(t.aiSignals.delayRiskProbability * 100).toFixed(0)}%`}` : 'Unavailable'}</td></tr>)}</tbody></table></div>{overview?.tickets.length && !visibleTickets.length ? <EmptyState title="No tickets match these filters" description={search ? `No ticket contains “${search}”. Clear search or filters to see tickets.` : "Clear the selected filters to see tickets."} /> : !overview?.tickets.length && <EmptyState title="No tickets found" description="Create a ticket first, or confirm this backend has ticket records." />}</Card>
    <Card title="SLA events and audit history">{overview?.events.length ? <div className="ticket-audit-list">{overview.events.map((event) => <div key={event._id}><strong>{event.kind.replaceAll('_', ' ')}{event.ticketNumber ? ` · ${event.ticketNumber}` : ''}</strong><span>{new Date(event.createdAt).toLocaleString()}</span><small>{event.message}</small></div>)}</div> : <EmptyState title="No SLA events yet" description="Policy changes, SLA starts, warnings, and outcomes appear here as they occur." />}</Card>
  </div>;
}
