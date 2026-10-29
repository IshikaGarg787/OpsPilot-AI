import test from 'node:test';
import assert from 'node:assert/strict';
import { customerTicketCreateSchema } from '../src/validators/schemas.js';
import {
  buildCustomerActivity,
  customerTicketFilter,
  customerTicketTimeline,
  isCustomerTicketOwner,
  serializeCustomerTicket,
  summarizeCustomerTicketCounts,
} from '../src/services/customerTickets.js';
import { customerPredictionFilter } from '../src/services/customerPredictions.js';

test('customer ticket creation accepts only customer-controlled fields and Assistance category', () => {
  const valid = { subject: 'Cannot access account', description: 'The account page shows an error when I sign in.', category: 'Assistance' };
  assert.deepEqual(customerTicketCreateSchema.parse(valid), valid);
  assert.equal(customerTicketCreateSchema.safeParse({ ...valid, priority: 'Highest' }).success, false);
  assert.equal(customerTicketCreateSchema.safeParse({ ...valid, assignedTo: 'user-2' }).success, false);
  assert.equal(customerTicketCreateSchema.safeParse({ ...valid, category: 'Network' }).success, false);
});

test('customer ticket filter is always scoped to the authenticated owner', () => {
  const filter = customerTicketFilter('owner-1', { search: 'OP-1.*', status: 'open' });
  assert.equal(filter.ownerUserId, 'owner-1');
  assert.equal(filter.status, 'open');
  assert.equal((filter.$or as Array<{ ticketNumber: RegExp }>)[0].ticketNumber.test('OP-1.*'), true);
  assert.equal(isCustomerTicketOwner('owner-1', 'owner-1'), true);
  assert.equal(isCustomerTicketOwner('owner-1', 'owner-2'), false);
});

test('dashboard counts are derived from grouped ticket statuses', () => {
  assert.deepEqual(summarizeCustomerTicketCounts([
    { _id: 'open', count: 2 }, { _id: 'assigned', count: 1 }, { _id: 'in_progress', count: 3 },
    { _id: 'resolved', count: 4 }, { _id: 'closed', count: 1 },
  ]), { total: 11, open: 3, inProgress: 3, resolved: 5 });
});

test('customer serialization excludes operational data, private replies, owner identity, and assignee email', () => {
  const safe = serializeCustomerTicket({
    _id: 'ticket-1', ticketNumber: 'OP-100', ownerUserId: 'owner-1', ownerRole: 'customer', subject: 'Account issue',
    description: 'Cannot open the account page.', category: 'Assistance', priority: 'unknown', project: 'private project', status: 'open',
    assignedTo: { _id: 'it-1', name: 'IT Member', email: 'private@example.com' }, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
    audit: [{ action: 'internal_secret', details: 'private notes', createdAt: new Date('2026-01-02') }],
    aiSignals: { delayRiskProbability: 0.9 }, workloadOutlook: { expectedTickets: 99 }, recommendation: { rationale: 'secret' }, sla: { policyId: 'secret' },
    responses: [
      { _id: 'public', visibility: 'public', authorName: 'Support', authorRole: 'it_team', message: 'We are looking into it.', createdAt: new Date('2026-01-02') },
      { _id: 'internal', visibility: 'internal', authorName: 'Support', authorRole: 'it_team', message: 'Private internal note', createdAt: new Date('2026-01-02') },
    ],
  });
  assert.equal(safe.assignedTo?.name, 'IT Member');
  assert.equal('email' in (safe.assignedTo ?? {}), false);
  assert.equal(safe.responses.length, 1);
  assert.equal(JSON.stringify(safe).includes('Private internal note'), false);
  for (const key of ['ownerUserId', 'aiSignals', 'workloadOutlook', 'recommendation', 'sla', 'audit']) assert.equal(key in safe, false);
});

test('customer timeline uses persisted public events and does not expose private events or invent progress', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const ticket = {
    _id: 'ticket-1', ticketNumber: 'OP-100', subject: 'Account issue', createdAt,
    audit: [
      { _id: 'c', action: 'ticket_created', createdAt },
      { _id: 'a', action: 'ticket_assigned', details: 'internal member details', createdAt: new Date('2026-01-02') },
      { _id: 'i', action: 'response_added', details: 'Internal note added', createdAt: new Date('2026-01-03') },
      { _id: 's', action: 'status_changed', details: 'assigned → in_progress', createdAt: new Date('2026-01-04') },
    ],
  };
  const timeline = customerTicketTimeline(ticket);
  assert.deepEqual(timeline.map(({ kind }) => kind), ['created', 'assigned', 'status']);
  assert.equal(JSON.stringify(timeline).includes('internal member details'), false);
  assert.equal(buildCustomerActivity([ticket]).length, 3);
});

test('customer prediction history is limited to their resolution-time records', () => {
  assert.deepEqual(customerPredictionFilter('customer-1'), { userId: 'customer-1', modelId: 'resolution-time' });
});
