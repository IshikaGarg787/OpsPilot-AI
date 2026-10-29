import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowRight, BrainCircuit, CheckCircle2, Clock3, RefreshCw, Ticket as TicketIcon } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState, ErrorState, LoadingState, MetricCard } from './ui';
import { api } from '../services/api';
import type { OperationsDashboardData } from '../types';

const colors: Record<string, string> = { met: '#39b981', on_track: '#5794ed', at_risk: '#e6a23c', breached: '#e35d6a', low: '#39b981', medium: '#e6a23c', high: '#e35d6a' };
const statusLabel = (value: string) => value.replaceAll('_', ' ');
const duration = (hours: number | null) => hours == null ? '—' : hours >= 24 ? `${(hours / 24).toFixed(1)}d` : `${hours.toFixed(1)}h`;
const SECTION_PAGE_SIZE = 5;

function SectionPagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / SECTION_PAGE_SIZE));
  if (total <= SECTION_PAGE_SIZE) return null;
  const start = (page - 1) * SECTION_PAGE_SIZE + 1;
  const end = Math.min(page * SECTION_PAGE_SIZE, total);
  return <nav className="ops-pagination" aria-label="Section pagination"><span>Showing {start}–{end} of {total}</span><div><button className="button button-secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pages}</span><button className="button button-secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div></nav>;
}

export function AdminOperationsDashboard({ mode = 'analytics' }: { mode?: 'overview' | 'analytics' }) {
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [priority, setPriority] = useState('');
  const [category, setCategory] = useState('');
  const [attentionStatus, setAttentionStatus] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [search, setSearch] = useState('');
  const [attentionPage, setAttentionPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [data, setData] = useState<OperationsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setLoading(true); setError('');
    api.sla.operations({ range, priority, category }).then((result) => setData(result)).catch((err) => setError(err instanceof Error ? err.message : 'Operations dashboard is unavailable.')).finally(() => setLoading(false));
  }, [range, priority, category]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setAttentionPage(1); }, [range, priority, category, attentionStatus, assigneeFilter, riskFilter, search]);
  useEffect(() => { setActivityPage(1); }, [range, priority, category]);
  const priorityChart = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const item of data?.priorityStatus ?? []) {
      const key = item._id.priority || 'Unknown';
      const row = rows.get(key) ?? { priority: key, met: 0, on_track: 0, at_risk: 0, breached: 0 };
      row[item._id.status] = item.count; rows.set(key, row);
    }
    return [...rows.values()];
  }, [data?.priorityStatus]);
  const trendHasData = !!data?.trend.length;
  const riskTotal = data?.riskDistribution.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const attentionRows = (data?.attention ?? []).filter((ticket) => (!attentionStatus || ticket.firstResponseStatus === attentionStatus || ticket.resolutionStatus === attentionStatus) && (!assigneeFilter || (ticket.assignee ?? 'Unassigned') === assigneeFilter) && (!riskFilter || ticket.delayRiskCategory === riskFilter) && (!search.trim() || `${ticket.ticketNumber} ${ticket.subject}`.toLowerCase().includes(search.trim().toLowerCase())));
  const pageAttentionRows = attentionRows.slice((attentionPage - 1) * SECTION_PAGE_SIZE, attentionPage * SECTION_PAGE_SIZE);
  const pageEvents = (data?.events ?? []).slice((activityPage - 1) * SECTION_PAGE_SIZE, activityPage * SECTION_PAGE_SIZE);

  if (mode === 'overview') return <section className="admin-operations-dashboard page-stack" aria-label="Admin overview">
    {error && <ErrorState message={error} onRetry={load} />}
    {loading && !data && <LoadingState label="Loading your operational snapshot" />}
    {data && <>
      <div className="metrics-grid ops-overview-metrics">
        <MetricCard label="Open tickets" value={String(data.summary.open)} detail="Unresolved tickets · last 30 days" icon={TicketIcon} accent="blue" />
        <MetricCard label="SLA breaches" value={String(data.summary.activeBreaches)} detail="Open tickets past SLA deadline" icon={AlertTriangle} accent="amber" />
        <MetricCard label="At SLA risk" value={String(data.summary.atRisk)} detail="Open tickets approaching deadline" icon={Clock3} accent="amber" />
        <MetricCard label="High delay risk" value={String(data.summary.highRisk)} detail="Saved ML predictions; not confirmed breaches" icon={BrainCircuit} accent="violet" />
      </div>
      <Card title="Needs attention" action={<Link className="card-link" to="/app/analytics">Open full analytics</Link>}>
        {data.attention.length ? <div className="ticket-list">{data.attention.slice(0, 5).map((ticket) => <Link className="ticket-row" to={`/app/tickets/${ticket._id}`} key={ticket._id}><span className="ticket-row-icon"><AlertTriangle size={17} /></span><span className="ticket-row-main"><span className="ticket-number">{ticket.ticketNumber} · {ticket.priority}</span><strong>{ticket.subject}</strong><small>{ticket.assignee ?? 'Unassigned'} · SLA {ticket.firstResponseStatus ?? 'not tracked'} / {ticket.resolutionStatus ?? 'not tracked'} · ML risk {ticket.delayRiskCategory ?? 'unavailable'}</small></span><span className={`ticket-status ticket-status-${ticket.status}`}>{ticket.status.replaceAll('_', ' ')}</span><ArrowRight size={16} /></Link>)}</div> : <EmptyState title="No urgent tickets" description="No current ticket matches the SLA, high-risk, or unassigned attention rules." />}
      </Card>
      <div className="ops-overview-footer"><span>Detailed trends, workload and activity are in Analytics.</span><Link className="button button-secondary" to="/app/analytics">View Analytics <ArrowRight size={15} /></Link></div>
    </>}
  </section>;

  return <section className="admin-operations-dashboard page-stack" aria-label="Admin operations intelligence">
    <Card title="Operations Intelligence" className="ops-dashboard-header" action={<button className="button button-secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>}>
      <div className="ops-dashboard-controls"><p className="field-help">Live SLA, team workload, and persisted ticket delay-risk signals. Historical charts use recorded outcomes only.</p>
        <label className="field"><span>Period</span><select value={range} onChange={(event) => setRange(Number(event.target.value) as 7 | 30 | 90)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
        <label className="field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option>{data?.filterOptions.priorities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{data?.filterOptions.categories.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {(priority || category) && <button className="button button-quiet" onClick={() => { setPriority(''); setCategory(''); }}>Clear filters</button>}
      </div>
    </Card>
    {error && <ErrorState message={error} onRetry={load} />}
    {loading && !data && <LoadingState label="Loading live operations data" />}
    {data && <>
      <p className="ops-metric-caption">Current-state metrics · tickets created in the selected period and filters</p>
      <div className="metrics-grid">
        <button className="ops-metric-button" title="Open ticket queue" onClick={() => { window.location.href = '/app/tickets'; }}><MetricCard label="Open tickets" value={String(data.summary.open)} detail="Unresolved tickets in this view" icon={TicketIcon} accent="blue" /></button>
        <button className="ops-metric-button" title="View completed SLA outcomes" onClick={() => document.getElementById('sla-trend')?.scrollIntoView({ behavior: 'smooth' })}><MetricCard label="SLA compliance" value={data.summary.compliancePercent == null ? '—' : `${data.summary.compliancePercent}%`} detail="Met / completed SLA outcomes in period" icon={CheckCircle2} accent="teal" /></button>
        <button className="ops-metric-button" title="Filter breached tickets" onClick={() => { setAttentionStatus('breached'); setRiskFilter(''); document.getElementById('priority-attention')?.scrollIntoView({ behavior: 'smooth' }); }}><MetricCard label="Active SLA breaches" value={String(data.summary.activeBreaches)} detail="Unique open tickets with a breached SLA" icon={AlertTriangle} accent="amber" /></button>
        <button className="ops-metric-button" title="Filter at-risk tickets" onClick={() => { setAttentionStatus('at_risk'); setRiskFilter(''); document.getElementById('priority-attention')?.scrollIntoView({ behavior: 'smooth' }); }}><MetricCard label="Tickets at SLA risk" value={String(data.summary.atRisk)} detail="Unique open tickets with an at-risk SLA" icon={Clock3} accent="amber" /></button>
        <button className="ops-metric-button" title="Filter high predicted-risk tickets" onClick={() => { setRiskFilter('high'); setAttentionStatus(''); document.getElementById('priority-attention')?.scrollIntoView({ behavior: 'smooth' }); }}><MetricCard label="High predicted delay risk" value={String(data.summary.highRisk)} detail="Existing model label; not a confirmed breach" icon={BrainCircuit} accent="violet" /></button>
        <button className="ops-metric-button" title="Open resolved tickets" onClick={() => { window.location.href = '/app/tickets?status=resolved'; }}><MetricCard label="Average resolution" value={duration(data.summary.averageResolutionHours)} detail="Resolved tickets with recorded completion time" icon={Activity} accent="teal" /></button>
      </div>
      <div className="dashboard-grid ops-chart-grid">
        <div id="sla-trend"><Card title="SLA Compliance Trend" className="activity-card"><p className="field-help">Daily compliance = met persisted SLA outcome events / all persisted met or breached outcome events.</p>{trendHasData ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={260}><LineChart data={data.trend}><CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><YAxis domain={[0, 100]} unit="%" tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip formatter={(value, _name, item) => [`${value}% (${item.payload.met}/${item.payload.eligible} outcomes)`, 'Compliance']} /><Line type="monotone" dataKey="compliancePercent" name="Compliance" stroke="#5794ed" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive /></LineChart></ResponsiveContainer></div> : <EmptyState title="Historical SLA trend is not available yet" description="Trend points appear after response or resolution SLA outcomes are persisted." />}</Card></div>
        <Card title="SLA status by priority"><p className="field-help">SLA obligations, so a ticket may contribute one response and one resolution obligation. Click a segment to filter attention.</p>{priorityChart.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={260}><BarChart data={priorityChart}><CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="priority" tick={{ fill: 'var(--muted)', fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip /><Bar dataKey="met" stackId="sla" fill={colors.met} onClick={(entry: any) => { setPriority(String(entry?.payload?.priority ?? '')); setAttentionStatus('met'); }} /><Bar dataKey="on_track" stackId="sla" fill={colors.on_track} onClick={(entry: any) => { setPriority(String(entry?.payload?.priority ?? '')); setAttentionStatus('on_track'); }} /><Bar dataKey="at_risk" stackId="sla" fill={colors.at_risk} onClick={(entry: any) => { setPriority(String(entry?.payload?.priority ?? '')); setAttentionStatus('at_risk'); }} /><Bar dataKey="breached" stackId="sla" fill={colors.breached} onClick={(entry: any) => { setPriority(String(entry?.payload?.priority ?? '')); setAttentionStatus('breached'); }} /></BarChart></ResponsiveContainer><div className="ops-legend">{['met', 'on_track', 'at_risk', 'breached'].map((key) => <span key={key}><i style={{ background: colors[key] }} />{statusLabel(key)}</span>)}</div></div> : <EmptyState title="No tracked SLA obligations" description="Tickets appear after an enabled policy starts tracking them." />}</Card>
        <Card title="IT team workload"><p className="field-help">Unresolved tickets created in the selected period. Overdue counts use saved SLA deadlines. Click a bar to filter attention.</p>{data.workload.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height={Math.max(180, data.workload.length * 46)}><BarChart data={data.workload} layout="vertical" margin={{ left: 18 }}><CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="var(--chart-grid)" /><XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><YAxis type="category" dataKey="name" width={105} tick={{ fill: 'var(--muted)', fontSize: 11 }} /><Tooltip /><Bar dataKey="count" name="Open assigned tickets" fill="#5794ed" radius={[0, 5, 5, 0]} onClick={(entry: any) => setAssigneeFilter(String(entry?.payload?.name ?? ''))} /></BarChart></ResponsiveContainer><div className="ops-workload-overdue">{data.workload.map((member) => <span key={member.assigneeId ?? 'unassigned'}>{member.name}: {member.overdue} overdue</span>)}</div></div> : <EmptyState title="No workload records" description="There are no unresolved tickets matching the current filters." />}</Card>
        <Card title="ML delay-risk distribution"><p className="field-help">Stored model categories for tickets in this period; these are predictions, not SLA outcomes.</p>{riskTotal ? <div className="ops-risk-content"><div className="chart-wrap"><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={data.riskDistribution} dataKey="count" nameKey="_id" innerRadius={55} outerRadius={82}>{data.riskDistribution.map((row) => <Cell key={row._id} fill={colors[row._id]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><ul>{data.riskDistribution.map((row) => <li key={row._id}><i style={{ background: colors[row._id] }} />{row._id} <strong>{row.count}</strong></li>)}</ul></div> : <EmptyState title="No saved delay-risk predictions" description="Risk distribution appears when ticket predictions are stored." />}</Card>
      </div>
      <div id="priority-attention"><Card title="Priority attention" action={<Link className="card-link" to="/app/tickets">Open ticket queue</Link>}>{(attentionStatus || assigneeFilter || riskFilter || search) && <div className="ops-filter-chip">Filtered{attentionStatus ? ` · SLA ${statusLabel(attentionStatus)}` : ''}{assigneeFilter ? ` · ${assigneeFilter}` : ''}{riskFilter ? ` · ${riskFilter} risk` : ''}{search ? ` · ${search}` : ''} <button onClick={() => { setAttentionStatus(''); setAssigneeFilter(''); setRiskFilter(''); setSearch(''); }}>Clear</button></div>}<label className="field ops-attention-search"><span>Search attention tickets</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ticket ID or subject" /></label><div className="table-scroll"><table className="data-table"><thead><tr><th>Ticket</th><th>Priority</th><th>Assignee</th><th>SLA status</th><th>Predicted delay risk</th><th>Last update</th></tr></thead><tbody>{pageAttentionRows.map((ticket) => <tr key={ticket._id}><td><Link to={`/app/tickets/${ticket._id}`}><strong>{ticket.ticketNumber}</strong><br />{ticket.subject}</Link></td><td>{ticket.priority}</td><td>{ticket.assignee ?? 'Unassigned'}</td><td>{ticket.firstResponseStatus ?? '—'} / {ticket.resolutionStatus ?? '—'}</td><td>{ticket.delayRiskCategory ? `${ticket.delayRiskCategory}${ticket.delayRiskProbability == null ? '' : ` · ${(ticket.delayRiskProbability * 100).toFixed(0)}%`}` : 'Unavailable'}</td><td>{new Date(ticket.updatedAt).toLocaleString()}</td></tr>)}</tbody></table></div>{!attentionRows.length ? <EmptyState title="No tickets need attention" description="No matching open ticket has a SLA warning, high predicted risk, or missing assignee." /> : <SectionPagination page={attentionPage} total={attentionRows.length} onPage={setAttentionPage} />}</Card></div>
      <Card title="Operations activity"><div className="ops-event-list">{pageEvents.map((event) => <div key={event._id} className="ops-event"><span className="ops-event-dot" style={{ background: event.kind.includes('breach') || event.kind === 'breach' ? colors.breached : event.kind === 'warning' ? colors.at_risk : colors.on_track }} /><div><strong>{event.ticketId ? <Link to={`/app/tickets/${event.ticketId}`}>{event.ticketNumber ?? 'Ticket event'}</Link> : 'SLA policy event'} · {statusLabel(event.kind)}</strong><small>{event.message}</small></div><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}{!data.events.length && <EmptyState title="No SLA activity in this period" description="Recorded SLA starts, warnings, and outcomes will appear here." />}</div><SectionPagination page={activityPage} total={data.events.length} onPage={setActivityPage} /></Card>
    </>}
  </section>;
}
