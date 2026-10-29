import { ArrowRight, Bell, BrainCircuit, Clock3, Gauge, History, Plus, ShieldAlert, Sparkles, Ticket as TicketIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState, ErrorState, LoadingState, MetricCard, PageIntro, StatusPill } from '../components/ui';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { DashboardActivity, DashboardSummary, Ticket } from '../types';
import { CustomerTicketsTable } from '../components/CustomerTicketsTable';
import type { CustomerDashboardData } from '../types';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatDuration = (hours?: number) => hours == null ? '—' : hours >= 24 ? `${number.format(hours / 24)}d` : `${number.format(hours)}h`;
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

function MyAssignedWork() {
  const { user } = useAuth(); const [tickets, setTickets] = useState<Ticket[] | null>(null);
  useEffect(() => { if (user?.role !== 'it_team') return; api.tickets.list().then(({ tickets: rows }) => setTickets(rows.filter((ticket) => ticket.assignedTo?.id === user.id))).catch(() => setTickets([])); }, [user?.id, user?.role]);
  if (user?.role !== 'it_team') return null;
  return <Card title="My assigned work" action={<Link className="card-link" to="/app/tickets">Open my queue <ArrowRight size={14} /></Link>}><div className="ticket-list">{tickets === null ? <p className="field-help">Loading assigned work…</p> : tickets.length ? tickets.map((ticket) => <Link className="ticket-row" to={`/app/tickets/${ticket.id}`} key={ticket.id}><span className="ticket-row-icon"><TicketIcon size={18} /></span><span className="ticket-row-main"><span className="ticket-number">{ticket.ticketNumber} · {ticket.priority}</span><strong>{ticket.subject}</strong><small>{ticket.category} · {ticket.estimatedResolutionAt ? `Estimated ${new Date(ticket.estimatedResolutionAt).toLocaleString()}` : 'Resolution estimate unavailable'}</small></span><span className={`ticket-status ticket-status-${ticket.status}`}>{statusText(ticket.status)}</span><ArrowRight className="ticket-row-arrow" size={17} /></Link>) : <EmptyState title="No tickets assigned" description="New assignments for you will appear here." />}</div></Card>;
}

const statusText = (status: Ticket['status']) => status.replaceAll('_', ' ');
function resultText(item: import('../types').Prediction) {
  const workload = item.output?.workload;
  if (workload) return typeof workload.expectedTickets === 'number' && Number.isFinite(workload.expectedTickets)
    ? `${workload.expectedTickets.toFixed(0)} tickets / ${workload.horizon ?? '—'} days`
    : 'Workload forecast';
  const risk = item.output?.delayRisk;
  if (risk) return typeof risk.probability === 'number' && Number.isFinite(risk.probability)
    ? `${(risk.probability * 100).toFixed(0)}% ${risk.category ?? ''} risk`
    : 'Delay-risk score';
  return formatDuration(item.output?.duration);
}
function modelText(id: string) { return ({ 'triage-pipeline': 'Ticket decision', 'resolution-time': 'Resolution estimate', 'operational-risk': 'Delay risk', 'workload-forecasting': 'Workload forecast' } as Record<string, string>)[id] ?? id; }

function OperationsDashboard() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; name: string; availability?: string; activeTickets?: number; skills?: string[] }>>([]);
  useEffect(() => {
    api.tickets.list().then(({ tickets: rows }) => setTickets(rows)).catch(() => setTickets([]));
    if (user?.role === 'admin') api.tickets.users().then(({ users }) => setMembers(users.filter((member) => member.role === 'it_team'))).catch(() => setMembers([]));
  }, [user?.role]);
  if (!user || user.role === 'it_team') return null;
  if (!tickets) return <Card title={user.role === 'admin' ? 'Operations overview' : 'My support tickets'}><p className="field-help">Loading ticket activity…</p></Card>;
  if (user.role === 'customer') {
    return <Card title="My support tickets" action={<Link className="card-link" to="/app/tickets">View all tickets <ArrowRight size={14} /></Link>}><div className="ticket-list">{tickets.length ? tickets.slice(0, 6).map((ticket) => <Link className="ticket-row" to={`/app/tickets/${ticket.id}`} key={ticket.id}><span className="ticket-row-icon"><TicketIcon size={18} /></span><span className="ticket-row-main"><span className="ticket-number">{ticket.ticketNumber} · {ticket.category}</span><strong>{ticket.subject}</strong><small>{ticket.sla?.resolution.deadlineAt ? `Resolution SLA due ${new Date(ticket.sla.resolution.deadlineAt).toLocaleString()}` : 'SLA not configured for this priority'}</small></span><span className={`ticket-status ticket-status-${ticket.status}`}>{statusText(ticket.status)}</span></Link>) : <EmptyState title="No support tickets yet" description="Your ticket status and SLA details will appear here." action={<Link className="button button-secondary" to="/app/tickets/new">Raise a ticket</Link>} />}</div></Card>;
  }
  const reviewQueue = tickets.filter((ticket) => ticket.aiSignals?.flaggedForReview || ['at_risk', 'breached'].includes(ticket.sla?.resolution.status ?? '') || ['at_risk', 'breached'].includes(ticket.sla?.response.status ?? ''));
  const available = members.filter((member) => member.availability === 'available').length;
  return <div className="page-stack"><div className="metrics-grid"><MetricCard label="Tickets needing review" value={number.format(reviewQueue.length)} detail="Delay-risk flag or SLA at risk / breached" icon={BrainCircuit} accent="amber" /><MetricCard label="Available IT members" value={`${available} / ${members.length}`} detail="Busy members have active assigned work" icon={TicketIcon} accent="teal" /><MetricCard label="Unassigned tickets" value={number.format(tickets.filter((ticket) => !ticket.assignedTo && !['resolved', 'closed'].includes(ticket.status)).length)} detail="Open tickets without an owner" icon={Clock3} accent="blue" /></div><div className="dashboard-grid"><Card title="Tickets to review" action={<Link className="card-link" to="/app/tickets">Open ticket queue <ArrowRight size={14} /></Link>}><div className="ticket-list">{reviewQueue.length ? reviewQueue.slice(0, 6).map((ticket) => <Link className="ticket-row" to={`/app/tickets/${ticket.id}`} key={ticket.id}><span className="ticket-row-icon"><ShieldAlert size={17} /></span><span className="ticket-row-main"><span className="ticket-number">{ticket.ticketNumber} · {ticket.priority}</span><strong>{ticket.subject}</strong><small>{ticket.aiSignals?.flaggedForReview ? `Delay risk ${((ticket.aiSignals.delayRiskProbability ?? 0) * 100).toFixed(0)}% · ` : ''}SLA {ticket.sla?.resolution.status ?? 'not available'}</small></span><span className={`ticket-status ticket-status-${ticket.status}`}>{statusText(ticket.status)}</span></Link>) : <EmptyState title="No tickets are flagged" description="New tickets will appear here when a model review flag or SLA warning needs attention." />}</div></Card><Card title="IT team availability" action={<Link className="card-link" to="/app/users">Manage team <ArrowRight size={14} /></Link>}><div className="model-summary-list">{members.length ? members.map((member) => <div className="model-summary-row" key={member.id}><span className={`role-badge role-${member.availability}`}>{member.availability}</span><div><strong>{member.name}</strong><small>{member.activeTickets ?? 0} active ticket{member.activeTickets === 1 ? '' : 's'} · {member.skills?.join(', ') || 'Skills not set'}</small></div></div>) : <EmptyState title="No IT members yet" description="Create the fixed roster in Users & Roles." action={<Link className="button button-secondary" to="/app/users">Set up team</Link>} />}</div></Card></div></div>;
}

export function DashboardPage() {
  const { user } = useAuth();
  return user?.role === 'customer' ? <CustomerDashboardPage /> : <OperationalDashboardPage />;
}

function OperationalDashboardPage() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null); const [activity, setActivity] = useState<DashboardActivity | null>(null); const [error, setError] = useState('');
  useEffect(() => { Promise.all([api.dashboard.summary(), api.dashboard.activity()]).then(([nextSummary, nextActivity]) => { setSummary(nextSummary); setActivity(nextActivity); }).catch((err) => setError(err instanceof Error ? err.message : 'Dashboard data is unavailable.')); }, []);
  if (error) return <><PageIntro eyebrow="Command center" title="Overview" description="A focused view of your operational intelligence." /><ErrorState message={error} onRetry={() => window.location.reload()} /></>;
  if (!summary || !activity) return <><PageIntro eyebrow="Command center" title="Overview" description="A focused view of your operational intelligence." /><LoadingState /></>;
  const dashboardAction = user?.role === 'admin' ? <Link className="button button-primary" to="/app/triage"><BrainCircuit size={16} /> Review ticket decisions</Link> : <Link className="button button-primary" to="/app/tickets/new"><TicketIcon size={16} /> Raise a ticket</Link>;
  return <div className="page-stack"><PageIntro eyebrow="Command center" title="Overview" description="Your tickets and model signals, at a glance." action={dashboardAction} />
    <MyAssignedWork /><OperationsDashboard />
    <div className="metrics-grid"><MetricCard label="Model runs" value={number.format(summary.totalPredictions)} detail="Saved to prediction history" icon={BrainCircuit} accent="blue" /><MetricCard label="Delay-risk scores" value={number.format(summary.delayRiskPredictions)} detail="Tickets reviewed for delay risk" icon={ShieldAlert} accent="amber" /><MetricCard label="Resolution estimates" value={number.format(summary.resolutionPredictions)} detail={summary.averageResolutionHours == null ? 'No successful estimate yet' : `Average ${formatDuration(summary.averageResolutionHours)}`} icon={Clock3} accent="teal" /><MetricCard label="Workload forecasts" value={number.format(summary.workloadForecasts)} detail="Saved incoming-volume outlooks" icon={Gauge} accent="violet" /><MetricCard label="Available models" value={number.format(summary.availableModels)} detail="Health-checked services" icon={Sparkles} accent="amber" /></div>
    <div className="dashboard-grid"><Card title="Prediction activity" action={<Link className="card-link" to="/app/analytics">View analytics <ArrowRight size={14} /></Link>} className="activity-card"><div className="chart-wrap">{activity.daily.length ? <ResponsiveContainer width="100%" height={245}><AreaChart data={activity.daily} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}><defs><linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#73a7ff" stopOpacity={.35} /><stop offset="100%" stopColor="#73a7ff" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="_id" tickFormatter={(value) => value.slice(5)} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: 12, color: 'var(--text)' }} labelStyle={{ color: 'var(--muted)' }} /><Area type="monotone" dataKey="count" name="Predictions" stroke="#73a7ff" fill="url(#activityFill)" strokeWidth={2.5} /></AreaChart></ResponsiveContainer> : <EmptyState title="Your signal line starts here" description="Run a prediction to create the first activity point." action={<Link className="button button-secondary" to="/app/resolution-time">Create prediction</Link>} />}</div></Card>
      <Card title="Model center" action={<Link className="card-link" to="/app/models">View all <ArrowRight size={14} /></Link>} className="model-summary-card"><div className="model-summary-list">{summary.models.map((model) => <div className="model-summary-row" key={model.id}><span className="model-symbol">{model.id === 'resolution-time' ? <Clock3 size={17} /> : <Sparkles size={17} />}</span><div><strong>{model.displayName}</strong><small>{model.description}</small></div><StatusPill status={model.status} /></div>)}</div></Card></div>
    <Card title="Recent model activity" action={<Link className="card-link" to="/app/history">Open model history <ArrowRight size={14} /></Link>}><div className="table-scroll"><table className="data-table"><thead><tr><th>Model</th><th>Created</th><th>Input context</th><th>Result</th><th>Status</th></tr></thead><tbody>{activity.recent.length ? activity.recent.map((item) => <tr key={item.id}><td><span className="table-model"><BrainCircuit size={15} /> {modelText(item.modelId)}</span></td><td>{formatDate(item.createdAt)}</td><td><span className="context-chip">{item.input.priority}</span><span className="context-muted">{item.input.issueType}</span></td><td className="result-value">{resultText(item)}</td><td><StatusPill status={item.status} /></td></tr>) : <tr><td colSpan={5}><EmptyState title="No model activity yet" description="New ticket submissions save delay-risk and resolution results. Forecasts are saved after generation." action={<Link className="button button-secondary" to="/app/tickets">View tickets</Link>} /></td></tr>}</tbody></table></div></Card>
  </div>;
}

function CustomerDashboardPage() {
  const [dashboard, setDashboard] = useState<CustomerDashboardData | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    api.tickets.customerDashboard().then((data) => { if (active) setDashboard(data); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Your support dashboard is unavailable.'); });
    return () => { active = false; };
  }, [retry]);
  const counts = dashboard?.counts;
  const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <div className="page-stack customer-dashboard">
    <PageIntro eyebrow="Customer support" title="Your dashboard" description="Raise support requests and follow their status and updates." action={<Link className="button button-primary" to="/app/tickets/new"><Plus size={16} /> Raise a ticket</Link>} />
    {error && <ErrorState message={error} onRetry={() => setRetry((n) => n + 1)} />}
    {!dashboard && !error && <LoadingState label="Loading your ticket overview" />}
    {counts && <div className="metrics-grid customer-metrics"><MetricCard label="Total tickets" value={number.format(counts.total)} detail="Tickets you have raised" icon={TicketIcon} accent="blue" /><MetricCard label="Open" value={number.format(counts.open)} detail="Awaiting resolution" icon={Clock3} accent="amber" /><MetricCard label="In progress" value={number.format(counts.inProgress)} detail="Being worked on" icon={Gauge} accent="violet" /><MetricCard label="Resolved" value={number.format(counts.resolved)} detail="Resolved or closed" icon={Sparkles} accent="teal" /></div>}
    {dashboard && <Card title="Recent activity" className="customer-activity-card"><div className="customer-activity-list">{dashboard.activity.length ? dashboard.activity.map((event) => <Link to={`/app/tickets/${event.ticketId}`} className="customer-activity-item" key={event.id}><span className="customer-activity-icon"><Bell size={16} /></span><span className="customer-activity-copy"><strong>{event.label}</strong><small>{event.ticketNumber} · {event.subject}</small></span><time>{date(event.createdAt)}</time></Link>) : <EmptyState title="Your support activity will appear here" description="Ticket creation, assignment and customer-visible status updates will be listed here." action={<Link className="button button-secondary" to="/app/tickets/new">Raise your first ticket</Link>} />}</div></Card>}
    {dashboard && <CustomerTicketsTable pageSize={8} showViewAll />}
  </div>;
}

export function PredictionsPage() {
  return <div className="page-stack"><PageIntro eyebrow="AI predictions" title="A connected decision workflow" description="Move one new complaint through risk triage, resolution estimation, and future workload planning." /><Link className="choice-card choice-active triage-launch-card" to="/app/triage"><span className="choice-icon"><BrainCircuit size={22} /></span><span className="choice-status">Three live model steps</span><h2>Run ticket triage</h2><p>Capture the complaint, score delay risk, estimate elapsed resolution time, and forecast workload from refreshed ticket history. The complete decision packet is saved together.</p><span className="text-link">Open integrated pipeline <ArrowRight size={16} /></span></Link><div className="prediction-choice-grid prediction-secondary-grid"><Link className="choice-card choice-active" to="/app/resolution-time"><span className="choice-icon"><Clock3 size={22} /></span><span className="choice-status">Single model</span><h2>Resolution-time estimate</h2><p>Run the regression model directly for a focused estimate.</p><span className="text-link">Open predictor <ArrowRight size={16} /></span></Link><Link className="choice-card choice-active" to="/app/workload-forecasting"><span className="choice-icon"><Gauge size={22} /></span><span className="choice-status">Single model</span><h2>Workload forecast</h2><p>Explore a forecast from refreshed ticket history on its own.</p><span className="text-link">Open forecaster <ArrowRight size={16} /></span></Link></div></div>;
}
