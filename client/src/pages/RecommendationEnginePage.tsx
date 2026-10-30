import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, Check, CheckCircle2, Clock3, RefreshCw, ShieldAlert, UserRound, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, LoadingState, Notice, PageIntro } from '../components/ui';
import { api } from '../services/api';
import type { Ticket, TriageResult } from '../types';

function readable(value?: string | null) {
  return value ? value.replaceAll('_', ' ') : 'Not available';
}

export function RecommendationEnginePage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [queueHistory, setQueueHistory] = useState<Awaited<ReturnType<typeof api.predictions.queueWorkloadHistory>> | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [selectedAction, setSelectedAction] = useState<'priority_review' | 'standard_queue'>('priority_review');
  const [decisionNote, setDecisionNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [analysisResult, setAnalysisResult] = useState<TriageResult | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    if (!silent) setLoadError('');
    try {
      const [ticketResponse, history] = await Promise.all([api.tickets.list(), api.predictions.queueWorkloadHistory()]);
      const next = ticketResponse.tickets;
      setTickets(next);
      setQueueHistory(history);
      setSelectedId((current) => next.some((ticket) => ticket.id === current)
        ? current
        : (next.find((ticket) => ticket.recommendation?.state === 'pending') ?? next[0])?.id ?? '');
    } catch (error) {
      if (!silent) setLoadError(error instanceof Error ? error.message : 'Could not load ticket recommendations.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? null;
  useEffect(() => {
    setSelectedAction(selected?.recommendation?.action ?? 'priority_review');
    setDecisionNote('');
    setFeedback('');
  }, [selected?.id, selected?.recommendation?.action]);

  useEffect(() => {
    setAnalysisError('');
    setAnalysisResult(null);
  }, [selected?.id]);

  const pendingCount = tickets.filter((ticket) => ticket.recommendation?.state === 'pending').length;
  const assignmentCount = tickets.filter((ticket) => ticket.aiSignals?.recommendedAssignee && ticket.aiSignals.recommendedAssignee.id !== ticket.assignedTo?.id).length;
  const priorityCount = tickets.filter((ticket) => ticket.aiSignals?.recommendedPriority && ticket.aiSignals.recommendedPriority.toLowerCase() !== ticket.priority.toLowerCase()).length;
  const outlookCount = tickets.filter((ticket) => ticket.workloadOutlook?.forecast?.length).length;

  async function updateTicket(operation: () => Promise<{ ticket: Ticket }>, successMessage: string) {
    if (!selected) return;
    setBusy(true);
    setFeedback('');
    try {
      const { ticket } = await operation();
      setTickets((current) => current.map((item) => item.id === ticket.id ? ticket : item));
      setFeedback(successMessage);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'That action could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedAnalysis() {
    if (!selected || !queueHistory) return;
    setBusy(true);
    setFeedback('');
    setAnalysisError('');
    try {
      const result = await api.predictions.createTriage({
        complaint: selected.description,
        issue_created: new Date(selected.createdAt).toISOString(),
        issue_priority: selected.priority,
        issue_type: selected.category,
        issue_proj: selected.project,
        horizon: 7,
        workload_source: 'queue_history',
        workload_records: queueHistory.records.map(({ date, ticket_count }) => ({ date, ticket_count })),
        ticketId: selected.id,
      });
      await refresh(true);
      setAnalysisResult(result);
      window.requestAnimationFrame(() => resultsRef.current?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      }));
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'The full analysis could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && tickets.length === 0) return <><PageIntro eyebrow="Admin decision support" title="Recommendation Engine" description="Review the available next steps across your ticket queue." /><LoadingState label="Loading recommendations" /></>;
  if (loadError && tickets.length === 0) return <><PageIntro eyebrow="Admin decision support" title="Recommendation Engine" description="Review the available next steps across your ticket queue." /><ErrorState message={loadError} onRetry={() => void refresh()} /></>;

  if (analysisResult) {
    const result = analysisResult;
    const forecastTotal = result.workload.forecast.reduce((sum, day) => sum + day.forecast, 0);
    const highLoadDays = result.workload.forecast.filter((day) => day.high_load_flag).length;
    return <div className="page-stack recommendation-engine-page recommendation-results-view" ref={resultsRef}>
      <PageIntro eyebrow="Analysis complete" title="Decision results" description={`Full analysis for ${selected?.ticketNumber ?? 'the selected ticket'}. Review the evidence and choose any follow-up yourself.`} action={<button className="button button-secondary" type="button" onClick={() => { setAnalysisResult(null); setAnalysisError(''); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}><ArrowLeft size={15} /> Back to recommendations</button>} />
      <Notice variant="success"><strong>All analysis steps completed.</strong> The model produced delay risk, resolution, and workload results. Recommendations remain advisory; no assignment, priority, or SLA was changed automatically.</Notice>
      <div className="recommendation-results-grid" aria-label="Analysis results">
        <Card className="recommendation-result-card"><span className="eyebrow">Delay risk</span><strong className="recommendation-result-value">{(result.risk.risk_probability * 100).toFixed(1)}%</strong><span className={`risk-pill risk-${result.risk.risk_category}`}>{result.risk.risk_category} risk</span><p>{result.risk.flagged_for_review ? 'Flagged for human review.' : 'Below the review threshold.'} Threshold: {(result.risk.decision_threshold * 100).toFixed(1)}%.</p></Card>
        <Card className="recommendation-result-card"><span className="eyebrow">Estimated resolution</span><strong className="recommendation-result-value">{result.resolution.duration.toFixed(1)} h</strong><p>About {(result.resolution.duration / 24).toFixed(1)} days from ticket creation. This is a model estimate, not an SLA commitment.</p></Card>
        <Card className="recommendation-result-card"><span className="eyebrow">Workload · next {result.workload.horizon} days</span><strong className="recommendation-result-value">{forecastTotal.toFixed(0)} tickets</strong><p>{highLoadDays} high-load {highLoadDays === 1 ? 'day' : 'days'} forecast. Based on {result.workload.history_days} history days ({result.workload.ticket_total.toLocaleString()} tickets).</p></Card>
      </div>
      <Card title="Recommended next step" className="recommendation-result-recommendation">
        <div className="recommendation-result-heading"><CheckCircle2 size={20} /><strong>{result.recommendation.action === 'priority_review' ? 'Review early' : 'Keep in the standard queue'}</strong></div>
        <p>{result.recommendation.rationale}</p>
        <div className="recommendation-result-details"><div><span>Suggested priority</span><strong>{result.recommendation.recommendedPriority}</strong></div><div><span>Assignee option</span><strong>{result.recommendation.assignee ? `${result.recommendation.assignee.name} · ${result.recommendation.assignee.activeTickets} active tickets` : 'No available teammate suggestion'}</strong></div><div><span>Official SLA</span><strong>{result.sla ? `Response ${readable(result.sla.response.status)} · Resolution ${readable(result.sla.resolution.status)}` : 'No SLA snapshot available'}</strong></div></div>
      </Card>
      {result.risk.explanation && <Card title="Why the risk score looks this way"><p>{result.risk.explanation.summary}</p>{result.risk.explanation.historical_evidence.map((item) => <p className="recommendation-evidence-row" key={item.factor}><strong>{readable(item.factor)} · {item.value}</strong><span>{(item.historical_delay_rate * 100).toFixed(1)}% delayed across {item.historical_tickets.toLocaleString()} earlier tickets</span></p>)}<small className="field-help">{result.risk.explanation.interpretation}</small></Card>}
      <div className="recommendation-result-actions"><button className="button button-primary" type="button" onClick={() => { setAnalysisResult(null); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>Review recommendations <ArrowRight size={15} /></button><Link className="button button-ghost" to={selected ? `/app/tickets/${selected.id}` : '/app/tickets'}>Open ticket <ArrowRight size={14} /></Link><Link className="button button-ghost" to="/app/workload-forecasting">Open workload forecast <ArrowRight size={14} /></Link></div>
    </div>;
  }

  return <div className="page-stack recommendation-engine-page">
    <PageIntro
      eyebrow="Admin decision support"
      title="Recommendation Engine"
      description="Compare ticket risk, SLA clocks, resolution estimates, workload outlook, and teammate capacity. Choose which recommendation to move forward with."
      action={<div className="recommendation-page-actions"><button className="button button-ghost" type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} /> Refresh</button><button className="button button-primary" type="button" onClick={() => void runSelectedAnalysis()} disabled={busy || !selected || !queueHistory}><RefreshCw size={15} className={busy ? 'spin' : undefined} /> {busy ? 'Updating signals…' : 'Run full analysis'}</button></div>}
    />

    <Notice><strong>Human decision stays in control.</strong> Suggestions are advisory. Assignments and priority changes happen only after you choose and confirm them.</Notice>
    {analysisError && <Notice variant="warning"><strong>Analysis did not complete.</strong> {analysisError} Check that the model service is running, then retry.</Notice>}

    {queueHistory && <Card title="Live ticket-queue history" className="recommendation-queue-history"><p className="card-subtitle">A rolling 120-calendar-day history is generated from the queue automatically and refreshes every 30 seconds. Today’s count is partial.</p><div className="recommendation-history-stats"><div><span>Actual queue tickets</span><strong>{queueHistory.actualTicketCount.toLocaleString()}</strong></div><div><span>Days covered by queue history</span><strong>{queueHistory.actualDays} / 120</strong></div><div><span>Bootstrap days still used</span><strong>{queueHistory.syntheticDays}</strong></div></div><small className="field-help">Bootstrap values are simulated and clearly marked in the downloadable CSV. They fill only dates before the first ticket in the available queue history. As real history grows, the rolling window drops its oldest calendar day.</small></Card>}

    <section className="recommendation-engine-metrics" aria-label="Recommendation overview">
      <div className="metric-card"><span>Awaiting admin review</span><strong>{pendingCount}</strong><small>Pending ticket decisions</small></div>
      <div className="metric-card"><span>Assignee options</span><strong>{assignmentCount}</strong><small>Suggested teammates to review</small></div>
      <div className="metric-card"><span>Priority options</span><strong>{priorityCount}</strong><small>Different from current priority</small></div>
      <div className="metric-card"><span>Workload outlooks</span><strong>{outlookCount}</strong><small>Tickets with a saved forecast</small></div>
    </section>

    {tickets.length === 0 ? <EmptyState title="No tickets to review yet" description="Ticket recommendations will appear here after tickets enter the workspace." /> : <>
        <Card title="Choose a ticket" className="recommendation-ticket-picker">
        <label className="field"><span>Ticket</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.ticketNumber} · {ticket.subject}</option>)}</select></label>
        {selected && <div className="recommendation-ticket-meta"><span>{selected.priority} priority</span><span>{readable(selected.status)}</span><span>{selected.assignedTo?.name ?? 'Unassigned'}</span><Link to={`/app/tickets/${selected.id}`}>Open ticket <ArrowRight size={14} /></Link></div>}
      </Card>

      {selected && <section className="recommendation-functions" aria-label="Available recommendation functions">
        <Card title="Queue decision" className="recommendation-function-card">
          <div className="recommendation-function-heading"><ShieldAlert size={18} /><span>Review timing</span><strong>{selected.recommendation?.action === 'priority_review' ? 'Review early' : selected.recommendation?.action === 'standard_queue' ? 'Standard queue' : 'Needs analysis'}</strong></div>
          <p>{selected.recommendation?.rationale ?? 'Run the full decision analysis to calculate a recommendation for this ticket.'}</p>
          <label className="field"><span>Select the action you want to review</span><select value={selectedAction} onChange={(event) => setSelectedAction(event.target.value as 'priority_review' | 'standard_queue')}><option value="priority_review">Review early</option><option value="standard_queue">Keep in standard queue</option></select></label>
          <label className="field"><span>Decision note</span><textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} rows={2} placeholder="Why are you approving, changing, or rejecting this suggestion?" /></label>
          {feedback && <p className="recommendation-feedback" role="status">{feedback}</p>}
          <div className="recommendation-function-actions">
            <button className="button button-primary button-small" disabled={busy || decisionNote.trim().length < 2 || !selected.recommendation?.action} onClick={() => void updateTicket(() => api.tickets.decideRecommendation(selected.id, { decision: 'approved', note: decisionNote }), 'Recommendation approved and recorded.') }><Check size={14} /> Approve recommendation</button>
            <button className="button button-secondary button-small" disabled={busy || decisionNote.trim().length < 2 || !selected.recommendation?.action} onClick={() => void updateTicket(() => api.tickets.decideRecommendation(selected.id, { decision: 'modified', action: selectedAction, note: decisionNote }), 'Your adjusted recommendation was recorded.')}>Save selected action</button>
            <button className="button button-ghost button-small" disabled={busy || decisionNote.trim().length < 2 || !selected.recommendation?.action} onClick={() => void updateTicket(() => api.tickets.decideRecommendation(selected.id, { decision: 'rejected', note: decisionNote }), 'Recommendation rejected and recorded.')}>Reject</button>
          </div>
          {selected.recommendation?.state && <small className="field-help">Current decision state: {readable(selected.recommendation.state)}</small>}
        </Card>

        <Card title="Assignment fit" className="recommendation-function-card">
          <div className="recommendation-function-heading"><Users size={18} /><span>Team workload</span><strong>{selected.aiSignals?.recommendedAssignee?.name ?? 'No suggestion yet'}</strong></div>
          {selected.aiSignals?.recommendedAssignee ? <>
            <p>Suggested with {selected.aiSignals.recommendedAssignee.activeTickets} active {selected.aiSignals.recommendedAssignee.activeTickets === 1 ? 'ticket' : 'tickets'}. Workload ranks first; matching skills break ties{selected.aiSignals.recommendedAssignee.matchingSkills?.length ? ` · ${selected.aiSignals.recommendedAssignee.matchingSkills.join(', ')}` : ''}.</p>
            <button className="button button-secondary button-small" disabled={busy || selected.assignedTo?.id === selected.aiSignals.recommendedAssignee.id} onClick={() => void updateTicket(() => api.tickets.assign(selected.id, selected.aiSignals!.recommendedAssignee!.id), 'Suggested teammate assigned.') }><UserRound size={14} /> {selected.assignedTo?.id === selected.aiSignals.recommendedAssignee.id ? 'Already assigned' : 'Assign suggested teammate'}</button>
          </> : <p>Run the full analysis to compare available teammates by active workload and skill fit.</p>}
        </Card>

        <Card title="Priority review" className="recommendation-function-card">
          <div className="recommendation-function-heading"><ShieldAlert size={18} /><span>Suggested priority</span><strong>{selected.aiSignals?.recommendedPriority ?? 'Not calculated'}</strong></div>
          <p>Current priority: {selected.priority}. Confirm the ticket’s customer impact before applying a suggested change.</p>
          <button className="button button-secondary button-small" disabled={busy || !selected.aiSignals?.recommendedPriority || selected.aiSignals.recommendedPriority.toLowerCase() === selected.priority.toLowerCase()} onClick={() => void updateTicket(() => api.tickets.updatePriority(selected.id, selected.aiSignals!.recommendedPriority!, decisionNote.trim() || 'Admin accepted the recommendation engine priority suggestion.'), 'Suggested priority applied and recorded.')}>Apply suggested priority</button>
        </Card>

        <Card title="SLA and workload context" className="recommendation-function-card">
          <div className="recommendation-context-list">
            <div><Clock3 size={16} /><span>First response SLA</span><strong>{readable(selected.sla?.response.status)}{selected.sla?.response.remainingHours != null ? ` · ${selected.sla.response.remainingHours.toFixed(1)}h left` : ''}</strong></div>
            <div><Clock3 size={16} /><span>Resolution SLA</span><strong>{readable(selected.sla?.resolution.status)}{selected.sla?.resolution.remainingHours != null ? ` · ${selected.sla.resolution.remainingHours.toFixed(1)}h left` : ''}</strong></div>
            <div><BarChart3 size={16} /><span>Workload forecast</span><strong>{selected.workloadOutlook?.expectedTickets != null ? `${Math.round(selected.workloadOutlook.expectedTickets)} tickets / ${selected.workloadOutlook.horizon ?? '?'} days` : 'Not calculated'}</strong></div>
            <div><BarChart3 size={16} /><span>High-load days</span><strong>{selected.workloadOutlook?.highLoadDays ?? '—'}</strong></div>
          </div>
          <Link className="button button-ghost button-small" to="/app/workload-forecasting">Open workload forecast <ArrowRight size={14} /></Link>
        </Card>
      </section>}
    </>}
  </div>;
}
