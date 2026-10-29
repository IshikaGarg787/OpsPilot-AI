import { ArrowRight, Bell, BrainCircuit, Clock3, Gauge, History, Plus, Sparkles, Ticket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState, ErrorState, LoadingState, MetricCard, PageIntro, StatusPill } from '../components/ui';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { CustomerTicketsTable } from '../components/CustomerTicketsTable';
import type { CustomerDashboardData, DashboardActivity, DashboardSummary } from '../types';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const formatDuration = (hours?: number) => hours == null ? '—' : hours >= 24 ? `${number.format(hours / 24)}d` : `${number.format(hours)}h`;
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export function DashboardPage() {
  const { user } = useAuth();
  return user?.role === 'customer' ? <CustomerDashboardPage /> : <OperationalDashboardPage />;
}

function OperationalDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null); const [activity, setActivity] = useState<DashboardActivity | null>(null); const [error, setError] = useState('');
  useEffect(() => { Promise.all([api.dashboard.summary(), api.dashboard.activity()]).then(([nextSummary, nextActivity]) => { setSummary(nextSummary); setActivity(nextActivity); }).catch((err) => setError(err instanceof Error ? err.message : 'Dashboard data is unavailable.')); }, []);
  if (error) return <><PageIntro eyebrow="Command center" title="Overview" description="A focused view of your operational intelligence." /><ErrorState message={error} onRetry={() => window.location.reload()} /></>;
  if (!summary || !activity) return <><PageIntro eyebrow="Command center" title="Overview" description="A focused view of your operational intelligence." /><LoadingState /></>;
  return <div className="page-stack"><PageIntro eyebrow="Command center" title="Overview" description="Your operational signal, at a glance." action={<Link className="button button-primary" to="/app/triage"><BrainCircuit size={16} /> Start ticket triage</Link>} />
    <div className="metrics-grid"><MetricCard label="Total predictions" value={number.format(summary.totalPredictions)} detail={summary.totalPredictions ? 'Across your workspace' : 'No history yet'} icon={BrainCircuit} accent="blue" /><MetricCard label="Resolution predictions" value={number.format(summary.resolutionPredictions)} detail="Persisted estimates" icon={Clock3} accent="teal" /><MetricCard label="Average predicted duration" value={formatDuration(summary.averageResolutionHours ?? undefined)} detail={summary.averageResolutionHours == null ? 'Appears after your first result' : 'Successful estimates only'} icon={Gauge} accent="violet" /><MetricCard label="Available models" value={number.format(summary.availableModels)} detail="Health-checked services" icon={Sparkles} accent="amber" /></div>
    <div className="dashboard-grid"><Card title="Prediction activity" action={<Link className="card-link" to="/app/analytics">View analytics <ArrowRight size={14} /></Link>} className="activity-card"><div className="chart-wrap">{activity.daily.length ? <ResponsiveContainer width="100%" height={245}><AreaChart data={activity.daily} margin={{ top: 12, right: 12, left: -20, bottom: 0 }}><defs><linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#73a7ff" stopOpacity={.35} /><stop offset="100%" stopColor="#73a7ff" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--chart-grid)" /><XAxis dataKey="_id" tickFormatter={(value) => value.slice(5)} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: 12, color: 'var(--text)' }} labelStyle={{ color: 'var(--muted)' }} /><Area type="monotone" dataKey="count" name="Predictions" stroke="#73a7ff" fill="url(#activityFill)" strokeWidth={2.5} /></AreaChart></ResponsiveContainer> : <EmptyState title="Your signal line starts here" description="Run a prediction to create the first activity point." action={<Link className="button button-secondary" to="/app/resolution-time">Create prediction</Link>} />}</div></Card>
      <Card title="Model center" action={<Link className="card-link" to="/app/models">View all <ArrowRight size={14} /></Link>} className="model-summary-card"><div className="model-summary-list">{summary.models.map((model) => <div className="model-summary-row" key={model.id}><span className="model-symbol">{model.id === 'resolution-time' ? <Clock3 size={17} /> : <Sparkles size={17} />}</span><div><strong>{model.displayName}</strong><small>{model.description}</small></div><StatusPill status={model.status} /></div>)}</div></Card></div>
    <Card title="Recent activity" action={<Link className="card-link" to="/app/history">Open history <ArrowRight size={14} /></Link>}><div className="table-scroll"><table className="data-table"><thead><tr><th>Model</th><th>Created</th><th>Input context</th><th>Result</th><th>Status</th></tr></thead><tbody>{activity.recent.length ? activity.recent.map((item) => <tr key={item.id}><td><span className="table-model"><Clock3 size={15} /> Resolution time</span></td><td>{formatDate(item.createdAt)}</td><td><span className="context-chip">{item.input.priority}</span><span className="context-muted">{item.input.issueType}</span></td><td className="result-value">{formatDuration(item.output?.duration)}</td><td><StatusPill status={item.status} /></td></tr>) : <tr><td colSpan={5}><EmptyState title="No prediction activity" description="Your completed predictions will appear here." action={<Link className="button button-secondary" to="/app/resolution-time">Run the first one</Link>} /></td></tr>}</tbody></table></div></Card>
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
    {counts && <div className="metrics-grid customer-metrics"><MetricCard label="Total tickets" value={number.format(counts.total)} detail="Tickets you have raised" icon={Ticket} accent="blue" /><MetricCard label="Open" value={number.format(counts.open)} detail="Awaiting resolution" icon={Clock3} accent="amber" /><MetricCard label="In progress" value={number.format(counts.inProgress)} detail="Being worked on" icon={Gauge} accent="violet" /><MetricCard label="Resolved" value={number.format(counts.resolved)} detail="Resolved or closed" icon={Sparkles} accent="teal" /></div>}
    {dashboard && <Card title="Recent activity" className="customer-activity-card"><div className="customer-activity-list">{dashboard.activity.length ? dashboard.activity.map((event) => <Link to={`/app/tickets/${event.ticketId}`} className="customer-activity-item" key={event.id}><span className="customer-activity-icon"><Bell size={16} /></span><span className="customer-activity-copy"><strong>{event.label}</strong><small>{event.ticketNumber} · {event.subject}</small></span><time>{date(event.createdAt)}</time></Link>) : <EmptyState title="Your support activity will appear here" description="Ticket creation, assignment and customer-visible status updates will be listed here." action={<Link className="button button-secondary" to="/app/tickets/new">Raise your first ticket</Link>} />}</div></Card>}
    {dashboard && <CustomerTicketsTable pageSize={8} showViewAll />}
  </div>;
}

export function PredictionsPage() {
  return <div className="page-stack"><PageIntro eyebrow="AI predictions" title="A connected decision workflow" description="Move one new complaint through risk triage, resolution estimation, and future workload planning." /><Link className="choice-card choice-active triage-launch-card" to="/app/triage"><span className="choice-icon"><BrainCircuit size={22} /></span><span className="choice-status">Three live model steps</span><h2>Run ticket triage</h2><p>Capture the complaint, score delay risk, estimate elapsed resolution time, and forecast workload from refreshed ticket history. The complete decision packet is saved together.</p><span className="text-link">Open integrated pipeline <ArrowRight size={16} /></span></Link><div className="prediction-choice-grid prediction-secondary-grid"><Link className="choice-card choice-active" to="/app/resolution-time"><span className="choice-icon"><Clock3 size={22} /></span><span className="choice-status">Single model</span><h2>Resolution-time estimate</h2><p>Run the regression model directly for a focused estimate.</p><span className="text-link">Open predictor <ArrowRight size={16} /></span></Link><Link className="choice-card choice-active" to="/app/workload-forecasting"><span className="choice-icon"><Gauge size={22} /></span><span className="choice-status">Single model</span><h2>Workload forecast</h2><p>Explore a forecast from refreshed ticket history on its own.</p><span className="text-link">Open forecaster <ArrowRight size={16} /></span></Link></div></div>;
}
