export type CustomerTicketStatus = 'open' | 'triaged' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';

const OPEN_STATUSES = new Set<CustomerTicketStatus>(['open', 'triaged', 'assigned', 'waiting_customer']);
const RESOLVED_STATUSES = new Set<CustomerTicketStatus>(['resolved', 'closed']);
const CUSTOMER_VISIBLE_STATUSES = new Set<CustomerTicketStatus>([
  'open', 'triaged', 'assigned', 'in_progress', 'waiting_customer', 'resolved', 'closed',
]);

export const CUSTOMER_TICKET_CATEGORY = 'Assistance';
export const CUSTOMER_TICKET_PROJECT = 'Not specified';
// The current resolution artifact requires an issue_proj value and has no unknown bucket.
// This is its most common historical project category; it is used for scoring only.
export const CUSTOMER_ESTIMATE_PROJECT = 'C06hg2xcu';

export function isCustomerTicketOwner(ticketOwnerId: unknown, userId: unknown): boolean {
  return String(ticketOwnerId) === String(userId);
}

export type CustomerTicketCounts = {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
};

export type CustomerTicketEvent = {
  id: string;
  kind: 'created' | 'assigned' | 'status' | 'resolved' | 'closed' | 'reply';
  label: string;
  status?: CustomerTicketStatus;
  createdAt: string;
};

export function customerTicketFilter(ownerUserId: unknown, filters: { status?: CustomerTicketStatus; search?: string } = {}) {
  const query: Record<string, unknown> = { ownerUserId };
  if (filters.status) query.status = filters.status;
  const search = filters.search?.trim();
  if (search) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(safeSearch, 'i');
    query.$or = [{ ticketNumber: expression }, { subject: expression }, { category: expression }];
  }
  return query;
}

export function summarizeCustomerTicketCounts(groups: Array<{ _id: string; count: number }>): CustomerTicketCounts {
  const counts = new Map(groups.map(({ _id, count }) => [_id, count]));
  const sum = (statuses: Set<CustomerTicketStatus>) => [...statuses].reduce((total, status) => total + (counts.get(status) ?? 0), 0);
  return {
    total: groups.reduce((total, group) => total + group.count, 0),
    open: sum(OPEN_STATUSES),
    inProgress: counts.get('in_progress') ?? 0,
    resolved: sum(RESOLVED_STATUSES),
  };
}

function isoDate(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function customerTicketTimeline(ticket: any): CustomerTicketEvent[] {
  const ticketId = String(ticket._id ?? ticket.id ?? 'ticket');
  const events: CustomerTicketEvent[] = [];
  const audit = Array.isArray(ticket.audit) ? ticket.audit : [];

  audit.forEach((entry: any, index: number) => {
    const createdAt = isoDate(entry.createdAt);
    if (!createdAt) return;
    const id = String(entry._id ?? `${ticketId}:audit:${index}`);
    if (entry.action === 'ticket_created') {
      events.push({ id, kind: 'created', label: 'Ticket created', createdAt });
      return;
    }
    if (entry.action === 'ticket_assigned') {
      events.push({ id, kind: 'assigned', label: 'Ticket assigned to an IT member', createdAt });
      return;
    }
    if (entry.action === 'response_added' && entry.details === 'Public response added') {
      events.push({ id, kind: 'reply', label: 'Support sent a customer-visible update', createdAt });
      return;
    }
    if (entry.action !== 'status_changed') return;

    const nextStatus = String(entry.details ?? '').match(/→\s*(open|triaged|assigned|in_progress|waiting_customer|resolved|closed)\s*$/i)?.[1]?.toLowerCase() as CustomerTicketStatus | undefined;
    if (!nextStatus || !CUSTOMER_VISIBLE_STATUSES.has(nextStatus)) return;
    const kind = nextStatus === 'resolved' ? 'resolved' : nextStatus === 'closed' ? 'closed' : 'status';
    const label = kind === 'resolved' ? 'Ticket resolved' : kind === 'closed' ? 'Ticket closed' : `Status updated to ${nextStatus.replaceAll('_', ' ')}`;
    events.push({ id, kind, label, status: nextStatus, createdAt });
  });

  if (!events.some((event) => event.kind === 'created')) {
    const createdAt = isoDate(ticket.createdAt);
    if (createdAt) events.push({ id: `${ticketId}:created`, kind: 'created', label: 'Ticket created', createdAt });
  }

  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function buildCustomerActivity(tickets: any[], limit = 20) {
  return tickets.flatMap((ticket) => customerTicketTimeline(ticket).map((event) => ({
    ...event,
    ticketId: String(ticket._id ?? ticket.id),
    ticketNumber: String(ticket.ticketNumber),
    subject: String(ticket.subject),
  }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

export function serializeCustomerTicket(ticket: any, attachments: Array<Record<string, unknown>> = []) {
  const publicResponses = (Array.isArray(ticket.responses) ? ticket.responses : [])
    .filter((response: any) => response.visibility === 'public')
    .map((response: any) => ({
      _id: String(response._id),
      authorName: String(response.authorName),
      authorRole: response.authorRole,
      visibility: 'public' as const,
      message: String(response.message),
      ...(response.resolutionNote ? { resolutionNote: String(response.resolutionNote) } : {}),
      createdAt: response.createdAt,
    }));
  const assigned = ticket.assignedTo;
  const assignedTo = assigned && typeof assigned === 'object' && assigned.name
    ? { id: String(assigned._id ?? assigned.id), name: String(assigned.name) }
    : null;

  return {
    id: String(ticket._id ?? ticket.id),
    ticketNumber: String(ticket.ticketNumber),
    ownerRole: ticket.ownerRole,
    subject: String(ticket.subject),
    description: String(ticket.description),
    inputLanguage: String(ticket.inputLanguage ?? 'auto'),
    category: String(ticket.category),
    priority: String(ticket.priority),
    prioritySource: String(ticket.prioritySource ?? 'legacy'),
    project: CUSTOMER_TICKET_PROJECT,
    status: ticket.status as CustomerTicketStatus,
    assignedTo,
    responses: publicResponses,
    resolutionSummary: [...publicResponses].reverse().find((response) => response.resolutionNote)?.resolutionNote ?? null,
    customerTimeline: customerTicketTimeline(ticket),
    attachments,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}
