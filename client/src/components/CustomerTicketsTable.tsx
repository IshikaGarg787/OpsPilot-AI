import { ArrowLeft, ArrowRight, RefreshCw, Search, Ticket as TicketIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api';
import type { CustomerTicketPage, TicketStatus } from '../types';
import { Card, EmptyState, ErrorState, LoadingState } from './ui';

const statusOptions: Array<{ value: TicketStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_customer', label: 'Waiting on you' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const statusText = (status: TicketStatus) => statusOptions.find((item) => item.value === status)?.label ?? status;
const statusClass = (status: TicketStatus) => `ticket-status ticket-status-${status}`;
const formatDate = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function CustomerTicketsTable({ pageSize = 10, showViewAll = false }: { pageSize?: number; showViewAll?: boolean }) {
  const [data, setData] = useState<CustomerTicketPage | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TicketStatus | ''>('');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.tickets.customerList({ page, pageSize, search, ...(status ? { status } : {}) })
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : 'Your tickets are unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, pageSize, retry, search, status]);

  function updateSearch(value: string) { setSearch(value); setPage(1); }
  function updateStatus(value: TicketStatus | '') { setStatus(value); setPage(1); }

  if (error && !data) return <ErrorState message={error} onRetry={() => setRetry((value) => value + 1)} />;

  return <Card className="customer-ticket-card" title="My tickets" action={showViewAll ? <Link className="card-link" to="/app/tickets">View all tickets <ArrowRight size={14} /></Link> : undefined}>
    <div className="customer-ticket-toolbar">
      <div className="customer-ticket-filters">
        <label className="customer-ticket-search"><Search size={16} /><input aria-label="Search my tickets" type="search" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search ticket ID or subject" /></label>
        <label className="customer-ticket-status-filter"><span className="sr-only">Filter by status</span><select aria-label="Filter tickets by status" value={status} onChange={(event) => updateStatus(event.target.value as TicketStatus | '')}><option value="">All statuses</option>{statusOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label>
      </div>
      <div className="customer-ticket-count"><strong>{data?.total ?? 0}</strong><span> tickets</span><button className="button button-ghost button-small" type="button" onClick={() => setRetry((value) => value + 1)} aria-label="Refresh tickets"><RefreshCw size={14} /> Refresh</button></div>
    </div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    {loading && !data ? <LoadingState label="Loading your tickets" /> : data?.tickets.length ? <>
      <div className="table-scroll"><table className="data-table customer-ticket-table"><thead><tr><th>Ticket ID</th><th>Subject</th><th>Category</th><th>Priority</th><th>Assigned IT member</th><th>Status</th><th>Created</th><th>Last updated</th><th>Action</th></tr></thead>
        <tbody>{data.tickets.map((ticket) => <tr key={ticket.id}>
          <td><Link className="customer-ticket-id" to={`/app/tickets/${ticket.id}`}>{ticket.ticketNumber}</Link></td>
          <td className="customer-ticket-subject">{ticket.subject}</td>
          <td>{ticket.category}</td>
          <td>{ticket.priority === 'unknown' ? 'Pending admin review' : <span className={`priority-chip priority-${ticket.priority.toLowerCase().replaceAll(' ', '-')}`}>{ticket.priority}</span>}</td>
          <td>{ticket.assignedTo?.name ?? 'Not assigned yet'}</td>
          <td><span className={statusClass(ticket.status)}>{statusText(ticket.status)}</span></td>
          <td>{formatDate(ticket.createdAt)}</td>
          <td>{formatDate(ticket.updatedAt)}</td>
          <td><Link className="button button-ghost button-small" to={`/app/tickets/${ticket.id}`}>View details <ArrowRight size={14} /></Link></td>
        </tr>)}</tbody>
      </table></div>
      {data.pages > 1 && <div className="pagination customer-ticket-pagination"><button className="button button-ghost button-small" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={14} /> Previous</button><span>Page {data.page} of {data.pages}</span><button className="button button-ghost button-small" disabled={page >= data.pages || loading} onClick={() => setPage((value) => value + 1)}>Next <ArrowRight size={14} /></button></div>}
    </> : <EmptyState title={data?.total ? 'No tickets match these filters' : 'No tickets yet'} description={data?.total ? 'Try another search or status filter.' : 'Raise a ticket and follow its progress here.'} action={data?.total ? <button className="button button-secondary" onClick={() => { updateSearch(''); updateStatus(''); }}>Clear filters</button> : <Link className="button button-secondary" to="/app/tickets/new"><TicketIcon size={15} /> Raise your first ticket</Link>} />}
  </Card>;
}
