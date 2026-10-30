import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, Download, FileUp, Lightbulb, ListChecks, MessageSquareText, Paperclip, Play, Plus, RefreshCw, ShieldAlert, Sparkles, Ticket as TicketIcon } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, LoadingState, Notice, PageIntro } from '../components/ui';
import { CustomerTicketsTable } from '../components/CustomerTicketsTable';
import { api, ApiError } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import type { ModelMetadata, ResolutionRecommendation, Ticket, TicketStatus } from '../types';

const statusText = (status: TicketStatus) => status.replaceAll('_', ' ');
const hoursText = (hours?: number | null) => hours == null ? 'Unavailable' : hours > 24 ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hours / 24)} days` : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(hours)} hours`;
const slaRemainingText = (hours?: number | null) => hours == null ? 'No deadline available' : hours < 0 ? `${hoursText(Math.abs(hours))} overdue` : `${hoursText(hours)} remaining`;
const statusClass = (status: TicketStatus) => `ticket-status ticket-status-${status}`;

function localResolutionFallback(ticket: Ticket): ResolutionRecommendation {
  const issue = `${ticket.category} ${ticket.subject} ${ticket.description}`.toLowerCase();
  if (/analytics|workspace|data portal|reporting workspace/.test(issue) && /access|permission|role|grant|entitlement|cannot open|can't open|unable to open/.test(issue)) return {
    source: 'troubleshooting_playbook', title: 'Restore analytics workspace access',
    summary: 'Check the user’s workspace membership and approved role, then correct only the missing entitlement.',
    steps: [
      'Confirm the requester’s account, the exact analytics workspace, and the role they need; check that the request has data-owner approval.',
      'Check the account is active and compare its workspace group or role with a teammate who has the approved access.',
      'If the approved group is missing, add the user to that group or provision the requested least-privilege role; do not grant workspace-admin access as a shortcut.',
      'Have the user sign out and back in to refresh SSO. If membership is already correct, inspect the workspace authorization or provisioning event at the reported time.',
    ],
    verification: 'Have the user sign back in, open the workspace, and confirm the requested content is available with only the approved permissions.',
    escalation: 'If approval is missing, the role conflicts with policy, or provisioning fails, send the request and authorization event details to the workspace owner.',
  };
  if (/api|service|bug|error|crash|software|application|browser|exception/.test(issue)) return {
    source: 'troubleshooting_playbook', title: 'Trace the API error safely',
    summary: 'Capture one failing request and narrow down whether the fault is in the client, API, or a downstream service.',
    steps: [
      'Record the endpoint, time, request or correlation ID, status code, and whether other users are affected.',
      'Check API health and logs for the same timestamp; follow the first failing dependency in the request path.',
      'Compare with a known working request and review recent deployments or configuration changes.',
      'Reproduce in a safe environment before changing production settings; do not retry non-idempotent requests blindly.',
    ],
    verification: 'Repeat the original request and confirm the expected response, then check error rates for the affected endpoint.',
    escalation: 'If multiple users or production traffic are affected, escalate with timestamps, request IDs, status codes, and the first failing dependency.',
  };
  if (/network|connection|connectivity|vpn|dns|wifi|wi-fi|internet/.test(issue)) return {
    source: 'troubleshooting_playbook', title: 'Isolate the connection issue',
    summary: 'Determine whether one device, network, or multiple users are affected before changing configuration.',
    steps: ['Record affected users, devices, location, connection type, and start time.', 'Check service health and whether other approved services are reachable.', 'Compare with a known-working device or approved network without changing security settings.', 'Capture the exact error and relevant DNS, VPN, or connection diagnostics.'],
    verification: 'Ask the affected user to repeat the original workflow and confirm the connection remains stable.',
    escalation: 'Escalate with the affected scope, timestamps, exact error, and diagnostics if more than one user is affected or the issue persists.',
  };
  if (/access|login|log in|permission|account|authentication|sign in|sso/.test(issue)) return {
    source: 'troubleshooting_playbook', title: 'Check account access safely',
    summary: 'Confirm which service and permission are failing before making account changes.',
    steps: ['Confirm the affected user, service, exact error, and when access last worked.', 'Check that the account is active and has the expected team or role membership.', 'Review sign-in or authorization logs and keep any request ID.', 'Test with an approved least-privilege account; never ask for or share passwords.'],
    verification: 'Have the user repeat the original sign-in or workflow and confirm the expected access.',
    escalation: 'Escalate with the user ID, service, timestamp, and log or request ID if access remains blocked.',
  };
  return {
    source: 'troubleshooting_playbook', title: 'Start with a safe diagnostic checklist',
    summary: 'Gather enough evidence to narrow the cause before changing a system.',
    steps: ['Confirm the affected service, user or device, business impact, and start time.', 'Record the exact reproduction steps and complete error or request ID.', 'Check service health and recent changes, then compare a known-working environment.', 'Try only an approved, reversible diagnostic step and record the outcome.'],
    verification: 'Confirm the original issue is resolved with the affected user and check related service health.',
    escalation: 'If the issue persists or a step could affect production, stop and escalate with timestamps, exact errors, and checks already completed.',
  };
}

export function TicketListPage() {
  const { user } = useAuth();
  return user?.role === 'customer' ? <CustomerTicketListPage /> : <StaffTicketListPage />;
}

function CustomerTicketListPage() {
  const location = useLocation();
  const created = (location.state as { ticketCreated?: boolean } | null)?.ticketCreated;
  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="Customer support"
        title="My tickets"
        description="Search your requests and follow their status, assignment and updates."
        action={<Link className="button button-primary" to="/app/tickets/new"><Plus size={16} /> Raise a ticket</Link>}
      />
      {created && <Notice variant="success">Ticket submitted successfully. You can follow its progress here.</Notice>}
      <CustomerTicketsTable />
    </div>
  );
}

function StaffTicketListPage() {
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [customerQueuePage, setCustomerQueuePage] = useState(1);
  const [itQueuePage, setItQueuePage] = useState(1);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyMessage, setHistoryMessage] = useState('');

  async function load() {
    setError('');
    try {
      setTickets((await api.tickets.list()).tickets);
      setCustomerQueuePage(1);
      setItQueuePage(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Tickets are unavailable.');
    }
  }

  async function downloadQueueHistory() {
    setHistoryBusy(true);
    setHistoryMessage('');
    try {
      const history = await api.predictions.queueWorkloadHistory();
      const csv = ['date,ticket_count,source', ...history.records.map(({ date, ticket_count, data_source }) => `${date},${ticket_count},${data_source}`)].join('\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'opspilot-queue-workload-history.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      setHistoryMessage(`CSV ready: ${history.actualTicketCount} actual queue tickets and ${history.syntheticDays} simulated bootstrap days. It refreshes from the queue each time you download.`);
    } catch (err) {
      setHistoryMessage(err instanceof Error ? err.message : 'Could not prepare the queue history CSV.');
    } finally { setHistoryBusy(false); }
  }

  useEffect(() => { void load(); }, []);

  if (error) {
    return (
      <div className="page-stack">
        <PageIntro eyebrow={admin ? 'Operations desk' : 'Your support'} title={admin ? 'Ticket queue' : 'My tickets'} description="View ticket status, updates, and available AI signals." />
        <ErrorState message={error} onRetry={() => void load()} />
      </div>
    );
  }

  if (!tickets) {
    return (
      <div className="page-stack">
        <PageIntro eyebrow={admin ? 'Operations desk' : 'Your support'} title={admin ? 'Ticket queue' : 'My tickets'} description="View ticket status, updates, and available AI signals." />
        <LoadingState label="Loading tickets" />
      </div>
    );
  }

  const priorityOptions = [...new Set(tickets.map((ticket) => ticket.priority))].sort();
  const visibleTickets = admin && priorityFilter ? tickets.filter((ticket) => ticket.priority === priorityFilter) : tickets;
  const customerQueue = visibleTickets.filter((ticket) => ticket.ownerRole === 'customer');
  const itQueue = visibleTickets.filter((ticket) => ticket.ownerRole === 'it_team');
  const ticketRows = (items: Ticket[], page = 1, onPage?: (page: number) => void) => {
    const pageSize = 2;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const pageItems = onPage ? items.slice((page - 1) * pageSize, page * pageSize) : items;
    return <>
    {pageItems.length ? <div className="ticket-list">
    {pageItems.map((ticket) => (
      <Link className="ticket-row" to={`/app/tickets/${ticket.id}`} key={ticket.id}>
        <span className="ticket-row-icon"><TicketIcon size={18} /></span>
        <span className="ticket-row-main">
          <span className="ticket-number">{ticket.ticketNumber} · {ticket.category}</span>
          <strong>{ticket.subject}</strong>
          {user?.role === 'it_team' && <span className="ticket-origin-tag">{ticket.ownerRole === 'it_team' ? (ticket.owner === user.id ? 'Raised by me' : 'Admin handled') : 'Assigned to me'}</span>}
          <small>{ticket.priority} priority · Updated {new Date(ticket.updatedAt).toLocaleString()}</small>
        </span>
        <span className={`ticket-row-status ${statusClass(ticket.status)}`}>{statusText(ticket.status)}</span>
        <span className="ticket-row-ai">
          {admin && ticket.recommendation?.action ? (
            <><ShieldAlert size={15} /> {ticket.recommendation.action === 'priority_review' ? 'Review early' : 'Standard queue'} · {ticket.recommendation.state === 'pending' ? 'awaiting review' : ticket.recommendation.state?.replaceAll('_', ' ') ?? 'not reviewed'}</>
          ) : ticket.aiSignals?.delayRiskProbability != null ? (
            <><ShieldAlert size={15} /> {(ticket.aiSignals.delayRiskProbability * 100).toFixed(0)}% risk</>
          ) : <span>AI pending</span>}
        </span>
        <ArrowRight className="ticket-row-arrow" size={17} />
      </Link>
    ))}
  </div> : <EmptyState title={priorityFilter ? 'No tickets at this priority' : 'No tickets yet'} description={priorityFilter ? 'Change the priority filter to see more tickets in this queue.' : 'New tickets from this group will appear here.'} />}
    {onPage && pageCount > 1 && <nav className="ticket-queue-pagination" aria-label="Ticket queue pagination"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, items.length)} of {items.length}</span><div><button className="button button-secondary button-small" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ArrowLeft size={14} /> Previous</button><span>Page {page} of {pageCount}</span><button className="button button-secondary button-small" type="button" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next <ArrowRight size={14} /></button></div></nav>}
    </>;
  };

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow={admin ? 'Central operations' : user?.role === 'it_team' ? 'IT team workspace' : 'Customer workspace'}
        title={admin ? 'Ticket queue' : 'My tickets'}
        description={admin ? 'Review, assign, and manage tickets across the workspace.' : user?.role === 'it_team' ? 'Track issues you submitted and work assigned to you.' : 'Track your requests and read the latest support response.'}
        action={admin ? <button className="button button-secondary" type="button" onClick={() => void downloadQueueHistory()} disabled={historyBusy}><Download size={15} /> {historyBusy ? 'Preparing CSV…' : 'Download workload CSV'}</button> : <Link className="button button-primary" to="/app/tickets/new"><Plus size={16} /> Raise a ticket</Link>}
      />
      {admin && historyMessage && <Notice variant={historyMessage.startsWith('CSV ready:') ? 'success' : 'warning'}>{historyMessage}</Notice>}
      {admin && (
        <div className="ticket-admin-links">
          <Link to="/app/recommendations">Review recommendations <ArrowRight size={15} /></Link>
          <Link to="/app/models">Model health <ArrowRight size={15} /></Link>
        </div>
      )}
      {admin ? <>
        <div className="ticket-list-toolbar">
          <div><strong>{visibleTickets.length}</strong><span> tickets across both queues</span></div>
          <label className="field ticket-queue-priority-filter"><span>Priority</span><select value={priorityFilter} onChange={(event) => { setPriorityFilter(event.target.value); setCustomerQueuePage(1); setItQueuePage(1); }}><option value="">All priorities</option>{priorityOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <button className="button button-ghost button-small" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button>
        </div>
        <div className="ticket-admin-queues">
          <Card className="ticket-list-card ticket-admin-queue-card" title="Customer tickets" action={<span className="ticket-queue-count">{customerQueue.length} total</span>}>
            <p className="ticket-queue-caption">Requests submitted from customer accounts</p>
            {ticketRows(customerQueue, customerQueuePage, setCustomerQueuePage)}
          </Card>
          <Card className="ticket-list-card ticket-admin-queue-card" title="IT Team tickets" action={<span className="ticket-queue-count">{itQueue.length} total</span>}>
            <p className="ticket-queue-caption">Internal issues raised by IT members</p>
            {ticketRows(itQueue, itQueuePage, setItQueuePage)}
          </Card>
        </div>
      </> : <Card className="ticket-list-card">
        <div className="ticket-list-toolbar"><div><strong>{visibleTickets.length}</strong><span> tickets in your workspace</span></div><button className="button button-ghost button-small" onClick={() => void load()}><RefreshCw size={14} /> Refresh</button></div>
        {ticketRows(visibleTickets)}
      </Card>}
    </div>
  );
}

export function TicketCreatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const customer = user?.role === 'customer';
  const [metadata, setMetadata] = useState<ModelMetadata | null>(null);
  const [metadataHint, setMetadataHint] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [inputLanguage, setInputLanguage] = useState<NonNullable<Ticket['inputLanguage']>>('auto');
  const [category, setCategory] = useState(customer ? 'Assistance' : '');
  const [project, setProject] = useState(customer ? 'Not specified' : '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (customer) return;
    api.models.metadata().then((next) => {
      setMetadata(next);
      setCategory(next.fields.issue_type?.options[0] ?? '');
      setProject(next.fields.issue_proj?.options[0] ?? '');
    }).catch(() => setMetadataHint('Model fields are unavailable; enter the ticket category and project manually. Priority is assigned automatically.'));
  }, [customer]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    let createdTicketId = '';
    try {
      const { ticket } = customer
        ? await api.tickets.createCustomer({ subject, description, inputLanguage, category: 'Assistance' })
        : await api.tickets.create({ subject, description, inputLanguage, category, project });
      createdTicketId = ticket.id;
      for (const file of files) await api.tickets.uploadAttachment(ticket.id, file);
      navigate(`/app/tickets/${ticket.id}`, { replace: true, state: customer ? { ticketCreated: true } : undefined });
    } catch (err) {
      if (createdTicketId) navigate(`/app/tickets/${createdTicketId}`, { replace: true, state: { attachmentUploadFailed: true } });
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'The ticket could not be submitted.');
    } finally {
      setBusy(false);
    }
  }

  const options = (field?: { options: string[] }) => field?.options?.length;

  return (
    <div className="page-stack">
      <PageIntro eyebrow={user?.role === 'it_team' ? 'Internal support intake' : 'Customer support intake'} title="Raise a ticket" description={user?.role === 'it_team' ? 'Report a hardware, software, network, access, or infrastructure issue.' : 'Tell the support team what happened. You can follow replies and status changes here.'} />
      {metadataHint && <Notice variant="warning">{metadataHint}</Notice>}
      <form className="ticket-create-grid" onSubmit={submit}>
        <Card title="Ticket details">
          <label className="field">
            <span>Subject <i>*</i></span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={4} maxLength={200} placeholder="संक्षेप में समस्या लिखें / Summarize the issue" />
          </label>
          <label className="field">
            <span>Description <i>*</i></span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} required minLength={8} maxLength={5000} rows={7} placeholder="Hindi, English, ya Hinglish mein problem batayein. Kya hua, kis par asar hai, aur kab se?" />
          </label>
          <label className="field">
            <span>Input language</span>
            <select value={inputLanguage} onChange={(e) => setInputLanguage(e.target.value as NonNullable<Ticket['inputLanguage']>)}>
              <option value="auto">Auto / Mixed (Hindi, English, Hinglish)</option>
              <option value="hindi">Hindi (हिन्दी)</option>
              <option value="english">English</option>
              <option value="hinglish">Hinglish (हिन्दी + English)</option>
            </select>
            <small className="field-help">Aap dono fields mein Hindi, English, ya Hinglish likh sakte hain. Text original form mein save hoga.</small>
          </label>
          <div className="form-grid-two">
            <label className="field">
              <span>Category <i>*</i></span>
              {customer ? <input value="Assistance" readOnly /> : options(metadata?.fields.issue_type) ? (
                <select value={category} onChange={(e) => setCategory(e.target.value)} required>
                  {metadata!.fields.issue_type.options.map((item) => <option key={item}>{item}</option>)}
                </select>
              ) : <input value={category} onChange={(e) => setCategory(e.target.value)} required placeholder="e.g. access issue" />}
            </label>
          </div>
          {customer ? (
            <Notice variant="info">Priority will be assigned automatically from the available model signals. &ldquo;Project / service&rdquo; is an internal model field, so it is omitted here.</Notice>
          ) : (
            <>
              <label className="field">
                <span>Project / service <i>*</i></span>
                {options(metadata?.fields.issue_proj) ? (
                  <select value={project} onChange={(e) => setProject(e.target.value)} required>
                    {metadata!.fields.issue_proj.options.map((item) => <option key={item}>{item}</option>)}
                  </select>
                ) : <input value={project} onChange={(e) => setProject(e.target.value)} required placeholder="Project or service name" />}
              </label>
              <Notice variant="info">Priority is evaluated automatically from delay risk, estimated resolution time, and available workload history.</Notice>
            </>
          )}
        </Card>
        <Card title="Attachments and submission">
          <p className="card-subtitle">Attach up to five PDF, PNG, JPEG, text, or CSV files; 3 MB each and 8 MB total.</p>
          <label className="ticket-file-drop">
            <FileUp size={20} />
            <span>Choose supporting files</span>
            <small>Logs, screenshots, or documents</small>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,application/pdf,image/png,image/jpeg,text/plain,text/csv" multiple onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              const bytes = selected.reduce((total, file) => total + file.size, 0);
              if (selected.length > 5 || selected.some((file) => file.size > 3 * 1024 * 1024) || bytes > 8 * 1024 * 1024) {
                setError('Choose at most five supported files, 3 MB each and 8 MB total.');
              } else {
                setFiles(selected);
                setError('');
              }
            }} />
          </label>
          {files.length > 0 && (
            <ul className="ticket-file-list">
              {files.map((file) => <li key={`${file.name}-${file.size}`}><Paperclip size={14} />{file.name}<small>{(file.size / 1024).toFixed(0)} KB</small></li>)}
            </ul>
          )}
          <Notice variant="warning"><strong>Privacy reminder.</strong> Do not attach passwords, access tokens, or payment details.</Notice>
          {error && <div className="form-error" role="alert"><AlertTriangle size={16} />{error}</div>}
          <button className="button button-primary button-full ticket-submit" type="submit" disabled={busy || !subject || !description || (!customer && (!category || !project))}>
            {busy ? <><span className="button-spinner" /> Scoring available models and assigning priority…</> : <><TicketIcon size={16} /> Submit ticket</>}
          </button>
          {!customer && <small className="field-help">Available models score the creation-time fields. Complaint text stays as context for the support team.</small>}
        </Card>
      </form>
    </div>
  );
}

export function TicketDetailPage() {
  const { ticketId = '' } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const itTeam = user?.role === 'it_team';
  const customer = user?.role === 'customer';

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [assignees, setAssignees] = useState<Array<{ id: string; name: string; email: string; skills: string[]; activeTickets: number; slaBreaches: number; matchingSkills: string[]; availability: 'available' | 'unavailable'; rank: number; recommended: boolean }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [delayExplanation, setDelayExplanation] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  const [workflowAction, setWorkflowAction] = useState<'waiting_customer' | 'resolve' | ''>('');
  const [status, setStatus] = useState<TicketStatus>('open');
  const [adminNote, setAdminNote] = useState('');
  const [recommendationAction, setRecommendationAction] = useState<'priority_review' | 'standard_queue'>('priority_review');
  const [resolutionRecommendation, setResolutionRecommendation] = useState<ResolutionRecommendation | null>(null);
  const [resolutionRecommendationBusy, setResolutionRecommendationBusy] = useState(false);
  const [resolutionRecommendationError, setResolutionRecommendationError] = useState('');

  async function load() {
    setError('');
    try {
      const next = (await api.tickets.get(ticketId)).ticket;
      setTicket(next);
      setStatus(next.status);
      setRecommendationAction(next.recommendation?.action ?? 'priority_review');
      if (admin) {
        const team = (await api.tickets.assignees(next.ownerRole === 'customer' ? ticketId : undefined)).users;
        setAssignees(team);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'This ticket is unavailable.');
    }
  }

  useEffect(() => {
    setTicket(null);
    setResolutionRecommendation(null);
    setResolutionRecommendationError('');
    void load();
  }, [ticketId, admin]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The ticket update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api.tickets.respond(ticketId, {
        message,
        visibility: admin || itTeam ? visibility : 'public',
        ...(resolutionNote ? { resolutionNote } : {}),
        ...(workflowAction ? { workflowAction } : {}),
        ...(workflowAction === 'resolve' && estimatePassed && delayExplanation.trim() ? { delayExplanation: delayExplanation.trim() } : {}),
      });
      setMessage('');
      setResolutionNote('');
      setDelayExplanation('');
      setWorkflowAction('');
    });
  }

  async function getResolutionRecommendation() {
    setResolutionRecommendationBusy(true);
    setResolutionRecommendationError('');
    setResolutionRecommendation(localResolutionFallback(ticket!));
    try {
      const result = await api.tickets.resolutionRecommendation(ticketId);
      setResolutionRecommendation(result.recommendation);
    } catch {
      setResolutionRecommendationError('Could not check your resolved ticket history. Showing an issue-matched checklist you can use now.');
    } finally {
      setResolutionRecommendationBusy(false);
    }
  }

  async function download(id: string, fileName: string) {
    try {
      const blob = await api.tickets.downloadAttachment(ticketId, id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download attachment.');
    }
  }

  if (error && !ticket) return <><PageIntro eyebrow="Ticket" title="Ticket details" description="Ticket access is scoped to your role." /><ErrorState message={error} onRetry={() => void load()} /></>;
  if (!ticket) return <><PageIntro eyebrow="Ticket" title="Ticket details" description="Loading ticket context and model signals." /><LoadingState label="Loading ticket" /></>;

  const assignedToCurrentUser = ticket.assignedTo?.id === user?.id;
  const ownRaisedTicket = itTeam && ticket.ownerRole === 'it_team' && ticket.owner === user?.id;
  const adminManagedInternalIssue = ticket.ownerRole === 'it_team';
  const canManageAsIT = itTeam && assignedToCurrentUser && !adminManagedInternalIssue;
  const canUpdateStatus = admin || canManageAsIT;
  const estimatePassed = !!ticket.estimatedResolutionAt && Date.now() > new Date(ticket.estimatedResolutionAt).getTime();
  const inputLanguageLabel = ({ auto: 'Mixed / auto', hindi: 'Hindi', english: 'English', hinglish: 'Hinglish' } as const)[ticket.inputLanguage ?? 'auto'];
  const suggestedAssignee = assignees[0] ?? ticket.aiSignals?.recommendedAssignee ?? null;
  const hasAvailableAssignee = assignees.some((member) => member.availability === 'available');

  return (
    <div className="page-stack ticket-page-wrapper">
      <PageIntro
        eyebrow={`${ticket.ticketNumber} · ${ticket.ownerRole === 'it_team' ? 'IT Team' : 'Customer'} ticket`}
        title={ticket.subject}
        description={`${ticket.category}${customer ? '' : ` · ${ticket.project}`} · Created ${new Date(ticket.createdAt).toLocaleString()}`}
        action={canManageAsIT && ['assigned', 'triaged'].includes(ticket.status)
          ? <button type="button" className="button button-primary" disabled={busy} onClick={() => void run(() => api.tickets.updateStatus(ticket.id, { status: 'in_progress' }))}><Play size={15} /> Start work</button>
          : <span className={statusClass(ticket.status)}>{statusText(ticket.status)}</span>}
      />

      {itTeam && adminManagedInternalIssue && <Notice variant="info"><strong>{ownRaisedTicket ? 'Raised by you.' : 'Admin-handled internal issue.'}</strong> The admin team manages its status and resolution. You can follow updates here.</Notice>}

      {customer && (location.state as { ticketCreated?: boolean } | null)?.ticketCreated && (
        <Notice variant="success">Ticket submitted successfully. Your support team will keep you updated.</Notice>
      )}
      {customer && (
        <Card title="Estimated resolution time">
          <div className="ticket-ai-signal"><span><Clock3 size={15} /> Estimated time to solve this ticket</span><strong>{hoursText(ticket.estimatedResolutionHours)}</strong></div>
          <small className="field-help">Based on available historical resolution data.</small>
        </Card>
      )}

      {(location.state as { attachmentUploadFailed?: boolean } | null)?.attachmentUploadFailed && (
        <Notice variant="warning">Ticket created successfully, but an attachment could not be uploaded. You can retry by raising a new ticket with the file.</Notice>
      )}
      {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}

      {/* Ticket conversation and role-specific admin controls */}
      <div className={`ticket-detail-layout ${customer ? 'customer-ticket-detail-layout' : ''}`}>
        <div className="ticket-detail-main">
          {!customer && (
            <div className="ticket-signal-column ticket-signal-context">
              {itTeam ? (
                <Card title="Resolution outlook & SLA" className="ticket-team-summary-card">
                  <div className="ticket-team-summary-grid">
                    <div className="ticket-team-summary-item"><span><Clock3 size={15} /> Estimated resolution</span><strong>{hoursText(ticket.aiSignals?.resolutionHours)}</strong><small>{ticket.estimatedResolutionAt ? `Model estimate · ${new Date(ticket.estimatedResolutionAt).toLocaleString()}` : 'No estimate returned'}</small></div>
                    <div className="ticket-team-summary-item"><span><ShieldAlert size={15} /> Delay risk</span><strong>{ticket.aiSignals?.delayRiskProbability == null ? 'Unavailable' : `${(ticket.aiSignals.delayRiskProbability * 100).toFixed(1)}% · ${ticket.aiSignals.delayRiskCategory}`}</strong><small>{ticket.aiSignals?.flaggedForReview ? 'Flagged for review' : ticket.aiSignals?.unavailableReason ?? 'Historical classifier output'}</small></div>
                    <div className="ticket-team-summary-item"><span>First response SLA</span><strong>{ticket.sla?.response.status.replaceAll('_', ' ') ?? 'No SLA mapping'}</strong><small>{slaRemainingText(ticket.sla?.response.remainingHours)} · due {ticket.sla?.response.deadlineAt ? new Date(ticket.sla.response.deadlineAt).toLocaleString() : '—'}</small></div>
                    <div className="ticket-team-summary-item"><span>Resolution SLA</span><strong>{ticket.sla?.resolution.status.replaceAll('_', ' ') ?? 'No SLA mapping'}</strong><small>{slaRemainingText(ticket.sla?.resolution.remainingHours)} · due {ticket.sla?.resolution.deadlineAt ? new Date(ticket.sla.resolution.deadlineAt).toLocaleString() : '—'}</small></div>
                  </div>
                  <small className="field-help">The AI duration is an estimate. SLA time remaining is the service target.</small>
                  {ticket.aiSignals?.riskExplanation && <details className="ticket-risk-details"><summary>Why this delay-risk score?</summary><p>{ticket.aiSignals.riskExplanation.summary}</p>{ticket.aiSignals.riskExplanation.interpretation && <small>{ticket.aiSignals.riskExplanation.interpretation}</small>}</details>}
                </Card>
              ) : (
                <>
<Card title="Service-level clocks" className="ticket-clock-card">
            <div className="ticket-ai-signal">
              <span>First response</span>
              <strong className="signal-status-strong">{ticket.sla?.response.status.replaceAll('_', ' ') ?? 'No SLA mapping'}</strong>
              <small>{ticket.sla?.response.remainingHours == null ? 'No remaining-time estimate' : `${ticket.sla.response.remainingHours.toFixed(1)} hours remaining`} · due {ticket.sla?.response.deadlineAt ? new Date(ticket.sla.response.deadlineAt).toLocaleString() : '—'}</small>
            </div>
            <div className="ticket-ai-signal">
              <span>Resolution</span>
              <strong className="signal-status-strong">{ticket.sla?.resolution.status.replaceAll('_', ' ') ?? 'No SLA mapping'}</strong>
              <small>{ticket.sla?.resolution.remainingHours == null ? 'No remaining-time estimate' : `${ticket.sla.resolution.remainingHours.toFixed(1)} hours remaining`} · due {ticket.sla?.resolution.deadlineAt ? new Date(ticket.sla.resolution.deadlineAt).toLocaleString() : '—'}</small>
            </div>
            <div className="ticket-ai-note">
              {ticket.sla ? `Policy ${ticket.sla.policy.policyId} · ${ticket.sla.policy.version} · calendar hours.` : 'No SLA target configured.'}
            </div>
          </Card>

          {!itTeam && ticket.workloadOutlook && (
            <Card title="Workload outlook" className="ticket-workload-card">
              <div className="ticket-ai-signal">
                <span><ShieldAlert size={16} /> Forecast horizon</span>
                <strong>{ticket.workloadOutlook.horizon} days · {ticket.workloadOutlook.expectedTickets?.toFixed(0)} tickets</strong>
                <small>{ticket.workloadOutlook.highLoadDays} high-load days · based on {ticket.workloadOutlook.historyDays} days of history</small>
              </div>
              <small className="field-help">{ticket.workloadOutlook.historyStart} to {ticket.workloadOutlook.historyEnd} · {ticket.workloadOutlook.actualHistoryDays ?? ticket.workloadOutlook.historyDays} real history days · refreshed {ticket.workloadOutlook.generatedAt ? new Date(ticket.workloadOutlook.generatedAt).toLocaleString() : 'recently'}</small>
            </Card>
          )}
                </>
              )}
          </div>
          )}

          {!admin && !(itTeam && ticket.description.trim().startsWith('DEMO DATA ONLY')) && <Card title="Complaint">
            <div className="ticket-description">{ticket.description}</div>
            <div className="ticket-meta-row">
              <span className={`context-chip priority-chip priority-${ticket.priority.toLowerCase().replaceAll(' ', '-')}`}>{customer && ticket.priority === 'unknown' ? 'Priority pending support review' : `${ticket.priority} priority`}</span>
              <span className="context-chip">{ticket.category}</span>
              <span className="context-chip">Input: {inputLanguageLabel}</span>
              {customer && <span className="context-chip">{ticket.assignedTo ? `Assigned to ${ticket.assignedTo.name}` : 'Not assigned yet'}</span>}
            </div>
            {ticket.attachments.length > 0 && (
              <div className="ticket-attachments">
                <h3><Paperclip size={15} /> Attachments</h3>
                {ticket.attachments.map((file) => (
                  <button key={file.id} className="attachment-link" onClick={() => void download(file.id, file.fileName)}>
                    {file.fileName}<small>{(file.size / 1024).toFixed(0)} KB</small>
                  </button>
                ))}
              </div>
            )}
          </Card>}

          {canManageAsIT && !['resolved', 'closed'].includes(ticket.status) && (
            <Card title="Resolution recommendation" className="ticket-resolution-recommendation">
              <p className="ticket-guidance-intro">Get a safe troubleshooting path for this ticket. OpsPilot checks your resolved IT tickets for a similar case first; if none fits, it uses a checklist matched to the issue.</p>
              {!resolutionRecommendation && (
                <button className="button button-secondary" type="button" onClick={() => void getResolutionRecommendation()} disabled={resolutionRecommendationBusy}>
                  {resolutionRecommendationBusy ? <><span className="button-spinner" /> Preparing guidance…</> : <><Lightbulb size={16} /> Get resolution recommendation</>}
                </button>
              )}
              {resolutionRecommendationError && <Notice variant="warning">{resolutionRecommendationError}</Notice>}
              {resolutionRecommendation && (
                <div className="ticket-guidance-result">
                  <div className="ticket-guidance-title"><ListChecks size={18} /><div><span className="eyebrow">Based on this ticket</span><h3>{resolutionRecommendation.title}</h3></div></div>
                  <p>{resolutionRecommendation.summary}</p>
                  <ul className="ticket-guidance-steps">{resolutionRecommendation.steps.map((step, index) => <li key={`${index}-${step}`}><span aria-hidden="true">•</span><p>{step}</p></li>)}</ul>
                  <div className="ticket-guidance-checks"><div><strong>Verify</strong><p>{resolutionRecommendation.verification}</p></div><div><strong>Escalate when</strong><p>{resolutionRecommendation.escalation}</p></div></div>
                  <div className="ticket-guidance-footer"><small>Guidance only—check the current environment and follow your team’s change process. No ticket or system changes are made by this recommendation.</small><button type="button" className="button button-ghost button-small" onClick={() => void getResolutionRecommendation()} disabled={resolutionRecommendationBusy}><RefreshCw size={14} /> Refresh</button></div>
                </div>
              )}
            </Card>
          )}

          {customer && (
            <Card title="Progress timeline">
              <ol className="customer-timeline">
                {(ticket.customerTimeline ?? []).map((event) => (
                  <li key={event.id}>
                    <span className="customer-timeline-dot" />
                    <div>
                      <strong>{event.label}</strong>
                      <time>{new Date(event.createdAt).toLocaleString()}</time>
                    </div>
                  </li>
                ))}
              </ol>
              {ticket.resolutionSummary && (
                <div className="customer-resolution-summary">
                  <strong>Resolution summary</strong>
                  <p>{ticket.resolutionSummary}</p>
                </div>
              )}
              <p className="customer-updated-at">Last updated {new Date(ticket.updatedAt).toLocaleString()}</p>
            </Card>
          )}

          <Card title={customer ? 'Customer-visible updates' : 'Conversation and resolution notes'}>
            <div className="ticket-conversation">
              {ticket.responses.length ? (
                ticket.responses.map((reply) => (
                  <article className={`ticket-reply ${reply.authorRole === 'customer' ? 'reply-customer' : 'reply-staff'}`} key={reply._id}>
                    <header>
                      <strong>{reply.authorName}</strong>
                      <span>{reply.authorRole.replace('_', ' ')}{customer ? '' : ` · ${reply.visibility}`}</span>
                      <time>{new Date(reply.createdAt).toLocaleString()}</time>
                    </header>
                    <p>{reply.message}</p>
                    {reply.resolutionNote && (
                      <div className="resolution-note">
                        <strong>Resolution note</strong>
                        <p>{reply.resolutionNote}</p>
                      </div>
                    )}
                  </article>
                ))
              ) : (
                <EmptyState title="No updates yet" description="Messages and status changes will appear here." />
              )}
            </div>

            {(!itTeam || canManageAsIT) ? <form className="ticket-reply-form" onSubmit={submitReply}>
              <label className="field">
                <span>Add an update</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={5000} required placeholder="Write an update for this ticket…" />
              </label>
              {(admin || canManageAsIT) && (
                <>
                <div className="form-grid-two">
                  <label className="field">
                    <span>Visibility</span>
                    <select value={visibility} onChange={(e) => { setVisibility(e.target.value as 'public' | 'internal'); if (e.target.value === 'internal') setWorkflowAction(''); }}>
                      <option value="public">Customer-visible reply</option>
                      <option value="internal">Internal note</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Resolution note {workflowAction === 'resolve' && <i>*</i>}</span>
                    <input value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} maxLength={5000} required={workflowAction === 'resolve'} placeholder={workflowAction === 'resolve' ? 'Summarize the fix' : 'Work completed or next step'} />
                  </label>
                </div>
                <label className="check-row ticket-workflow-option"><input type="checkbox" checked={workflowAction === 'waiting_customer'} disabled={visibility !== 'public'} onChange={(event) => setWorkflowAction(event.target.checked ? 'waiting_customer' : '')} /><span>Request information from the customer and set status to waiting on customer.</span></label>
                <label className="check-row ticket-workflow-option"><input type="checkbox" checked={workflowAction === 'resolve'} disabled={visibility !== 'public'} onChange={(event) => setWorkflowAction(event.target.checked ? 'resolve' : '')} /><span>Mark this ticket resolved after sending the update.</span></label>
                {workflowAction === 'resolve' && estimatePassed && <label className="field"><span>Why was this ticket late? <i>*</i></span><textarea value={delayExplanation} onChange={(event) => setDelayExplanation(event.target.value)} maxLength={2000} rows={3} required placeholder="Explain the blocker or delay" /></label>}
                </>
              )}
              <button className="button button-primary" disabled={busy || !message.trim() || (workflowAction === 'resolve' && (!resolutionNote.trim() || (estimatePassed && !delayExplanation.trim())))}>
                <MessageSquareText size={15} /> Add update
              </button>
            </form> : <Notice variant="info">This ticket was raised by you. The admin team manages its status and resolution.</Notice>}
          </Card>

          {admin && ticket.audit && (
            <Card title="Audit history" className="ticket-audit-card-horizontal">
              <div className="ticket-audit-list">
                {ticket.audit.slice().reverse().map((entry) => (
                  <div key={entry._id}>
                    <strong>{entry.action.replaceAll('_', ' ')}</strong>
                    <span>{entry.actorName} · {new Date(entry.createdAt).toLocaleString()}</span>
                    {entry.details && <small>{entry.details}</small>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* Admin controls remain grouped in the ticket action panel. */}
        {!customer && (
          <aside className="ticket-detail-side ticket-action-panel">
            <div className="ticket-signal-column ticket-signal-decision">
              {!itTeam && <>
<Card title="AI signals" className="ticket-signals-card">
            <div className="ticket-ai-signal">
              <span><ShieldAlert size={16} /> Delay risk</span>
              <strong>{ticket.aiSignals?.delayRiskProbability == null ? 'Unavailable' : `${(ticket.aiSignals.delayRiskProbability * 100).toFixed(1)}% · ${ticket.aiSignals.delayRiskCategory}`}</strong>
              <small>{ticket.aiSignals?.flaggedForReview ? `Review flag · threshold ${((ticket.aiSignals.reviewThreshold ?? 0) * 100).toFixed(1)}%` : ticket.aiSignals?.unavailableReason ?? 'Historical classifier output'}</small>
            </div>
            <div className="ticket-ai-signal">
              <span><Clock3 size={16} /> Resolution estimate</span>
              <strong>{hoursText(ticket.aiSignals?.resolutionHours)}</strong>
              <small>
                {ticket.aiSignals?.resolutionModelVersion ? 'Model estimate · planning reference only' : ticket.aiSignals?.unavailableReason ?? 'No estimate returned'}
                {ticket.estimatedResolutionAt ? ` · estimated by ${new Date(ticket.estimatedResolutionAt).toLocaleString()}` : ''}
              </small>
            </div>
            {ticket.aiSignals?.riskExplanation && (
              <div className="ticket-ai-note risk-breakdown-card">
                <div className="risk-breakdown-header">
                  <Sparkles size={14} />
                  <strong>Why this score?</strong>
                </div>
                <p>{ticket.aiSignals.riskExplanation.summary}</p>
                {ticket.aiSignals.riskExplanation.historicalEvidence && ticket.aiSignals.riskExplanation.historicalEvidence.length > 0 && (
                  <div className="risk-evidence-grid">
                    {ticket.aiSignals.riskExplanation.historicalEvidence.map((item: any, idx: number) => {
                      const rateVal = item.historicalDelayRate ?? item.historical_delay_rate;
                      const countVal = item.historicalTickets ?? item.historical_tickets;
                      const hasRate = rateVal != null && !isNaN(Number(rateVal));
                      const rateFormatted = hasRate ? `${(Number(rateVal) * 100).toFixed(1)}% delayed` : 'Cohort match';
                      const countFormatted = countVal != null && !isNaN(Number(countVal)) ? `in ${countVal} earlier tickets` : '';
                      return (
                        <div key={`${item.factor || 'factor'}-${idx}`} className="risk-evidence-pill">
                          <span className="risk-factor-name">{item.factor} · {item.value}</span>
                          <span className="risk-factor-stat">{rateFormatted}{countFormatted ? ` · ${countFormatted}` : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {ticket.aiSignals.riskExplanation.interpretation && (
                  <small className="risk-interpretation-text">{ticket.aiSignals.riskExplanation.interpretation}</small>
                )}
              </div>
            )}
            <div className="ticket-ai-note">Delay risk predicts historical delay; SLA clocks use separate policy targets.</div>
          </Card>
              </>}

{canUpdateStatus && (
                        <Card title="Correct status if needed" className="action-card-highlight ticket-work-status-card">
                          <details className="ticket-status-correction">
                            <summary>Fix an incorrect status</summary>
                          <label className="field">
                            <span>Set correct status</span>
                            <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
                              {(['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as TicketStatus[]).map((value) => (
                                <option key={value} value={value}>{statusText(value)}</option>
                              ))}
                            </select>
                          </label>
                          {status === 'resolved' && (
                            <label className="field">
                              <span>Resolution note</span>
                              <input value={resolutionNote} onChange={(e) => setResolutionNote(e.target.value)} placeholder="Summarize the fix" />
                            </label>
                          )}
                          {status === 'resolved' && estimatePassed && (
                            <label className="field">
                              <span>Why was this ticket late? <i>*</i></span>
                              <textarea value={delayExplanation} onChange={(e) => setDelayExplanation(e.target.value)} maxLength={2000} rows={3} required placeholder="Explain the blocker or delay" />
                            </label>
                          )}
                          <button
                            className="button button-primary button-full"
                            disabled={busy || status === ticket.status || (status === 'resolved' && estimatePassed && !delayExplanation.trim())}
                            onClick={() => void run(() => api.tickets.updateStatus(ticket.id, {
                              status,
                              ...(status === 'resolved' && resolutionNote ? { resolutionNote } : {}),
                              ...(status === 'resolved' && estimatePassed ? { delayExplanation } : {}),
                            }))}
                          >
                            Update status
                          </button>
                            </details>
                          {ticket.delayExplanation && admin && (
                            <div className="ticket-ai-note">
                              <strong>Late resolution explanation</strong>
                              <p>{ticket.delayExplanation}</p>
                            </div>
                          )}
                        </Card>
                      )}
          </div>

            {admin && (
              <Card title="Admin controls" className="action-card-admin">
                {ticket.ownerRole === 'customer' && assignees.length > 0 && (
                  <div className="assignment-recommendations">
                    <div className="assignment-recommendations-heading"><span className="eyebrow">Recommended IT members</span><small>{hasAvailableAssignee ? 'Available members are ranked first, then skill match and SLA record.' : 'Everyone has unresolved work; the smallest queue is ranked first, then skill match and SLA record.'}</small></div>
                    <div className="assignment-recommendation-list">
                      {assignees.slice(0, 3).map((person) => <article className={`assignment-recommendation ${person.recommended ? 'top-recommendation' : ''}`} key={person.id}>
                        <div className="assignment-recommendation-main"><span className="assignment-rank">{person.recommended ? 'Best match' : `#${person.rank}`}</span><strong>{person.name}</strong><span className={`role-badge role-${person.availability}`}>{person.availability}</span></div>
                        <p>{person.activeTickets} unresolved · {person.slaBreaches} SLA breaches · {person.matchingSkills.length ? `Skills: ${person.matchingSkills.join(', ')}` : 'No matching skill recorded'}</p>
                        {ticket.assignedTo?.id !== person.id && <button className="button button-secondary button-small" type="button" disabled={busy} onClick={() => void run(() => api.tickets.assign(ticket.id, person.id))}>{person.recommended ? 'Assign recommended member' : 'Assign this member'}</button>}
                        {ticket.assignedTo?.id === person.id && <span className="neutral-pill">Currently assigned</span>}
                      </article>)}
                    </div>
                  </div>
                )}
                {ticket.ownerRole !== 'it_team' && <label className="field">
                  <span>Assigned IT teammate</span>
                  <select
                    value={ticket.assignedTo?.id ?? ''}
                    onChange={(e) => { if (e.target.value) void run(() => api.tickets.assign(ticket.id, e.target.value)); }}
                  >
                    <option value="">Unassigned</option>
                    {assignees.map((person) => (
                      <option key={person.id} value={person.id} disabled={hasAvailableAssignee && person.availability === 'unavailable' && person.id !== ticket.assignedTo?.id}>
                        #{person.rank} {person.name} · {person.availability} · {person.activeTickets} unresolved · {person.slaBreaches} SLA breaches · {person.matchingSkills.join(', ') || 'no matching skill'}
                      </option>
                    ))}
                  </select>
                </label>}
                <div className="recommendation-review">
                  <span className="eyebrow">Model-assigned priority</span>
                  <strong>{ticket.priority}</strong>
                  <small>{ticket.aiSignals?.autoPriorityRationale ?? 'Priority is evaluated automatically from the available risk, resolution, and workload model signals.'}</small>
                </div>
                <div className="recommendation-review">
                  <span className="eyebrow">Decision support recommendation</span>
                  <strong>{ticket.recommendation?.action === 'priority_review' ? 'Review early' : ticket.recommendation?.action === 'standard_queue' ? 'Standard queue' : 'No recommendation'}</strong>
                  <small>The ticket priority is assigned automatically at creation. This separate assignment/action recommendation still needs admin review.</small>
                  <small>{ticket.recommendation?.rationale ?? 'A risk model score is required before a recommendation can be reviewed.'}</small>
                  {ticket.recommendation?.state === 'pending' ? (
                    <>
                      <label className="field">
                        <span>Adjust proposed action</span>
                        <select value={recommendationAction} onChange={(e) => setRecommendationAction(e.target.value as 'priority_review' | 'standard_queue')}>
                          <option value="priority_review">Review early</option>
                          <option value="standard_queue">Standard queue</option>
                        </select>
                      </label>
                      <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} placeholder="Decision note required" rows={2} />
                      <div className="recommendation-actions">
                        <button className="button button-primary button-small" disabled={busy || adminNote.trim().length < 2} onClick={() => void run(() => api.tickets.decideRecommendation(ticket.id, { decision: 'approved', note: adminNote }))}>Approve</button>
                        <button className="button button-ghost button-small" disabled={busy || adminNote.trim().length < 2} onClick={() => void run(() => api.tickets.decideRecommendation(ticket.id, { decision: 'rejected', note: adminNote }))}>Reject</button>
                        <button className="button button-secondary button-small" disabled={busy || adminNote.trim().length < 2} onClick={() => void run(() => api.tickets.decideRecommendation(ticket.id, { decision: 'modified', action: recommendationAction, note: adminNote }))}>Save change</button>
                      </div>
                    </>
                  ) : ticket.recommendation?.state ? (
                    <span className="neutral-pill">{ticket.recommendation.state}</span>
                  ) : null}
                </div>
                <Link className="button button-ghost button-full" to="/app/triage" state={{ ticket }}>
                  Run full workload decision flow <ArrowRight size={15} />
                </Link>
                <Link className="button button-secondary button-full" to="/app/recommendations" state={{ ticketId: ticket.id }}>
                  Open in Recommendation Engine <ArrowRight size={15} />
                </Link>
              </Card>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
