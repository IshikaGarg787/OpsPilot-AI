import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Ticket as TicketIcon, UserRound } from 'lucide-react';
import { Card, EmptyState, ErrorState, LoadingState, MetricCard, PageIntro } from '../components/ui';
import { api, ApiError } from '../services/api';
import type { WorkforceMember, WorkforceTicketPage, WorkforceTicketSummary } from '../types';

const statusText = (status: WorkforceMember['status']) => status === 'setup_pending' ? 'Unavailable · setup pending' : status === 'unavailable' ? 'Unavailable · unresolved tickets' : 'Available';
const confidenceText = (value: WorkforceMember['capacityForecast']['confidence']) => value === 'moderate' ? 'Moderate history' : value === 'limited' ? 'Limited history' : 'Not enough completion history';

export function WorkforcePage() {
  const { memberId } = useParams();
  const navigate = useNavigate();
  const [workers, setWorkers] = useState<WorkforceMember[] | null>(null);
  const [availabilityFilter, setAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigned, setAssigned] = useState<WorkforceTicketPage | null>(null);
  const [raised, setRaised] = useState<WorkforceTicketPage | null>(null);
  const [assignedPage, setAssignedPage] = useState(1);
  const [raisedPage, setRaisedPage] = useState(1);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketError, setTicketError] = useState('');
  const [resolvingId, setResolvingId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [delayExplanation, setDelayExplanation] = useState('');
  const [savingResolution, setSavingResolution] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api.users.workforce();
      setWorkers(result.workers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'IT workforce data is unavailable.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function loadMemberTickets(userId: string, assignedToPage = assignedPage, raisedToPage = raisedPage) {
    if (!userId) return;
    setTicketsLoading(true);
    setTicketError('');
    try {
      const [assignedResult, raisedResult] = await Promise.all([
        api.users.workforceTickets(userId, 'assigned', assignedToPage, 10),
        api.users.workforceTickets(userId, 'raised', raisedToPage, 10),
      ]);
      setAssigned(assignedResult);
      setRaised(raisedResult);
    } catch (err) {
      setTicketError(err instanceof ApiError ? err.message : 'Member tickets are unavailable.');
      setAssigned(null);
      setRaised(null);
    } finally { setTicketsLoading(false); }
  }

  useEffect(() => {
    setAssignedPage(1);
    setRaisedPage(1);
    setResolvingId('');
    if (memberId) void loadMemberTickets(memberId, 1, 1);
    else { setAssigned(null); setRaised(null); setTicketError(''); }
  }, [memberId]);

  async function resolveRaisedTicket(ticket: WorkforceTicketSummary) {
    const late = !!ticket.estimatedResolutionAt && Date.now() > new Date(ticket.estimatedResolutionAt).getTime();
    if (late && !delayExplanation.trim()) return;
    setSavingResolution(true);
    setTicketError('');
    try {
      await api.tickets.updateStatus(ticket.id, {
        status: 'resolved',
        ...(resolutionNote.trim() ? { resolutionNote: resolutionNote.trim() } : {}),
        ...(late ? { delayExplanation: delayExplanation.trim() } : {}),
      });
      setResolvingId('');
      setResolutionNote('');
      setDelayExplanation('');
      await Promise.all([loadMemberTickets(memberId ?? ''), load()]);
    } catch (err) {
      setTicketError(err instanceof ApiError ? err.message : 'Could not resolve this ticket.');
    } finally { setSavingResolution(false); }
  }

  const selected = workers?.find((worker) => worker.id === memberId);
  const visibleWorkers = (workers ?? []).filter((worker) => availabilityFilter === 'all' || (worker.status === 'available' ? 'available' : 'unavailable') === availabilityFilter);
  const forecastBars = useMemo(() => {
    if (!selected) return [];
    const daily = selected.capacityForecast.expectedCompletions / 7;
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.now() + (index + 1) * 86400000);
      return { date: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), expected: daily };
    });
  }, [selected]);
  const maxForecast = Math.max(1, ...forecastBars.map((item) => item.expected));

  return <div className="page-stack workforce-page">
    <PageIntro eyebrow="Admin operations · IT team" title={selected?.name ?? (memberId ? workers ? 'Member not found' : 'IT member' : 'IT Workforce')} description={selected ? 'Review this member’s current assignments, SLA outcomes, and upcoming capacity.' : memberId ? workers ? 'This IT member could not be found in the workforce.' : 'Loading this member’s workforce profile.' : 'An IT member is available only when they have no unresolved assigned tickets. Select a member to open their full profile.'} action={memberId ? <div className="workforce-detail-actions"><Link className="button button-secondary" to="/app/workforce">← All IT members</Link><button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button></div> : <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>} />
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {loading && !workers && <LoadingState label="Loading IT workforce" />}
    {workers && !workers.length && <Card><EmptyState title="No IT members yet" description="Create IT accounts in Users & Roles to start building the workforce view." /></Card>}
    {!memberId && !!workers?.length && <>
      <Card className="workforce-roster-card" title="IT members" action={<span className="neutral-pill">{workers.length} members</span>}>
        <div className="workforce-roster-toolbar"><label className="field"><span>Availability</span><select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value as typeof availabilityFilter)}><option value="all">All members</option><option value="available">Available</option><option value="unavailable">Unavailable</option></select></label><span className="field-help">Showing {visibleWorkers.length} of {workers.length} members</span></div>
        <div className="workforce-table-wrap">
          <table className="workforce-table">
            <thead><tr><th>Member</th><th>Availability</th><th>Unresolved tickets</th><th>SLA breaches</th><th>SLA met</th></tr></thead>
            <tbody>{visibleWorkers.map((worker) => {
              const selectedRow = memberId === worker.id;
              const selectOnKeyboard = (event: KeyboardEvent<HTMLTableRowElement>) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/app/workforce/${worker.id}`); }
              };
              return <tr key={worker.id} className={selectedRow ? 'selected' : ''} tabIndex={0} aria-selected={selectedRow} onClick={() => navigate(`/app/workforce/${worker.id}`)} onKeyDown={selectOnKeyboard}>
                <td><span className="workforce-person-cell"><span className="workforce-member-avatar">{worker.name.slice(0, 1).toUpperCase()}</span><span><strong>{worker.name}</strong><small>{worker.email}</small></span></span></td>
                <td><span className={`role-badge role-${worker.status === 'available' ? 'available' : 'unavailable'}`}>{statusText(worker.status)}</span></td>
                <td><span className="workforce-number-cell"><TicketIcon size={15} /> {worker.activeTickets}</span></td>
                <td><span className="workforce-number-cell workforce-breach-cell"><AlertTriangle size={15} /> {worker.slaBreaches}</span></td>
                <td><span className="workforce-number-cell workforce-met-cell"><CheckCircle2 size={15} /> {worker.slaMet}</span></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </Card>
    </>}
    {selected && <section className="workforce-detail" aria-label={`${selected.name} workforce details`}>
        <Card title={`${selected.name} · employee profile`} action={<span className={`role-badge role-${selected.status === 'available' ? 'available' : 'unavailable'}`}>{statusText(selected.status)}</span>}>
          <div className="workforce-profile-meta"><span><UserRound size={15} /> {selected.email}</span><span>Joined {new Date(selected.joinedAt).toLocaleDateString()}</span><span>{selected.setupPending ? 'Account setup is pending' : selected.skills.length ? selected.skills.join(' · ') : 'Skills not provided'}</span></div>
          <div className="metrics-grid workforce-metrics">
            <MetricCard label="Unresolved assigned tickets" value={String(selected.activeTickets)} detail="Any assigned ticket not yet resolved or closed" icon={TicketIcon} accent="blue" />
            <MetricCard label="Total assigned" value={String(selected.totalAssigned)} detail={`${selected.completedTotal} resolved or closed` } icon={Activity} accent="violet" />
            <MetricCard label="SLA breaches" value={String(selected.slaBreaches)} detail="Breached response or resolution obligations" icon={AlertTriangle} accent="amber" />
            <MetricCard label="SLA met" value={String(selected.slaMet)} detail="Met response or resolution obligations" icon={CheckCircle2} accent="teal" />
          </div>
        </Card>
        <Card title="Next 7 days · workload capacity estimate">
          <div className="workforce-capacity-summary"><div><span>Expected completions at recent pace</span><strong>{selected.capacityForecast.confidence === 'insufficient_history' ? '—' : selected.capacityForecast.expectedCompletions.toFixed(1)}</strong></div><div><span>Estimated additional tickets the member can take</span><strong>{selected.capacityForecast.confidence === 'insufficient_history' ? '—' : selected.capacityForecast.additionalTicketCapacity}</strong></div><span className="neutral-pill">{confidenceText(selected.capacityForecast.confidence)}</span></div>
          {selected.capacityForecast.confidence === 'insufficient_history' ? <EmptyState title="Not enough history for a capacity estimate" description="This member has no completed tickets in the last 30 days. The estimate will appear after work history is available." /> : <>
            <p className="field-help">Projected from this member’s resolved tickets over the last 30 days, adjusted for their current active queue. This is a planning estimate, not a guaranteed or model-trained capacity.</p>
            <div className="workforce-capacity-forecast">{forecastBars.map((item) => <div className="workforce-capacity-day" key={item.date}><span>{item.date}</span><div><i style={{ width: `${Math.max(3, (item.expected / maxForecast) * 100)}%` }} /></div><strong>{item.expected.toFixed(1)}</strong></div>)}</div>
          </>}
        </Card>
        <Card title="Assigned tickets">
          <p className="field-help">Tickets assigned to this member. These summaries cannot be opened from the workforce view.</p>
          {ticketsLoading && !assigned ? <LoadingState label="Loading assigned tickets" /> : !assigned?.tickets.length ? <EmptyState title="No assigned tickets" description="There are no tickets assigned to this member." /> : <>
            <div className="workforce-ticket-list">{assigned.tickets.map((ticket) => <article className="workforce-ticket-row" key={ticket.id}>
              <span className="workforce-ticket-id">{ticket.ticketNumber}</span><strong>{ticket.subject}</strong><span className="neutral-pill">{ticket.status.replaceAll('_', ' ')}</span>
            </article>)}</div>
            <TicketPagination page={assigned.page} pages={assigned.pages} onPage={(page) => { setAssignedPage(page); void loadMemberTickets(memberId ?? '', page, raisedPage); }} />
          </>}
        </Card>
        <Card title="Tickets raised by this member">
          <p className="field-help">Admin only · Open a ticket to review its details. The list shows only whether it is resolved.</p>
          {ticketError && <ErrorState message={ticketError} />}
          {ticketsLoading && !raised ? <LoadingState label="Loading raised tickets" /> : !raised?.tickets.length ? <EmptyState title="No tickets raised" description="This member has not raised any tickets." /> : <>
            <div className="workforce-ticket-list">{raised.tickets.map((ticket) => {
              const isResolved = ticket.status === 'resolved' || ticket.status === 'closed';
              const late = !!ticket.estimatedResolutionAt && Date.now() > new Date(ticket.estimatedResolutionAt).getTime();
              return <article className="workforce-raised-ticket" key={ticket.id}>
                <div className="workforce-ticket-row"><span className="workforce-ticket-id">{ticket.ticketNumber}</span><strong>{ticket.subject}</strong><span className={`role-badge role-${isResolved ? 'available' : 'busy'}`}>{isResolved ? 'Resolved' : 'Not resolved'}</span><Link className="button button-secondary button-small" to={`/app/tickets/${ticket.id}`}>View <ExternalLink size={13} /></Link></div>
                {!isResolved && (resolvingId === ticket.id ? <div className="workforce-resolve-form">
                  <label className="field"><span>Resolution note (optional)</span><input value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={5000} placeholder="Summarize the fix" /></label>
                  {late && <label className="field"><span>Why was this ticket late? *</span><textarea value={delayExplanation} onChange={(event) => setDelayExplanation(event.target.value)} maxLength={2000} rows={2} required placeholder="Explain the blocker or delay" /></label>}
                  <div className="workforce-resolve-actions"><button className="button button-secondary button-small" type="button" onClick={() => setResolvingId('')}>Cancel</button><button className="button button-primary button-small" type="button" disabled={savingResolution || (late && !delayExplanation.trim())} onClick={() => void resolveRaisedTicket(ticket)}>{savingResolution ? 'Resolving…' : 'Confirm resolved'}</button></div>
                </div> : <button className="button button-secondary button-small workforce-resolve-trigger" type="button" onClick={() => { setResolvingId(ticket.id); setResolutionNote(''); setDelayExplanation(''); }}>Mark resolved</button>)}
              </article>;
            })}</div>
            <TicketPagination page={raised.page} pages={raised.pages} onPage={(page) => { setRaisedPage(page); void loadMemberTickets(memberId ?? '', assignedPage, page); }} />
          </>}
        </Card>
      </section>}
    {memberId && workers && !selected && <Card><EmptyState title="IT member not found" description="The member may have been removed or the link may be incorrect." action={<Link className="button button-secondary" to="/app/workforce">Return to IT Workforce</Link>} /></Card>}
  </div>;
}

function TicketPagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="workforce-ticket-pagination" aria-label="Ticket pages"><span>Page {page} of {pages}</span><div><button className="button button-secondary button-small" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /> Previous</button><button className="button button-secondary button-small" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={14} /></button></div></nav>;
}
