import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackRecommendation, buildResolutionRecommendation, type ResolutionTicketContext } from '../src/services/resolutionRecommendationService.js';

const currentTicket: ResolutionTicketContext = {
  ticketNumber: 'OP-100',
  subject: 'VPN login fails for remote user',
  description: 'Remote user gets an authentication error when connecting to the company VPN.',
  category: 'Network access',
  project: 'VPN',
};

test('fallback recommendation selects a relevant network troubleshooting checklist', () => {
  const result = buildFallbackRecommendation(currentTicket);
  assert.equal(result.source, 'troubleshooting_playbook');
  assert.equal(result.title, 'Isolate the connection issue');
  assert.ok(result.steps.length >= 3);
  assert.match(result.escalation, /escalate/i);
});

test('recommendation uses a sufficiently similar resolved ticket as a lead', () => {
  const result = buildResolutionRecommendation(currentTicket, [{
    ticketNumber: 'OP-042', subject: currentTicket.subject, description: 'Authentication error connecting to company VPN.',
    category: 'Network access', project: 'VPN', responses: [{ resolutionNote: 'Re-synced account permissions after confirming the VPN group.' }],
  }]);
  assert.equal(result.source, 'similar_resolved_ticket');
  assert.equal(result.precedent?.ticketNumber, 'OP-042');
  assert.match(result.precedent?.resolution ?? '', /Re-synced account permissions/);
});

test('recommendation ignores unrelated history and falls back to a playbook', () => {
  const result = buildResolutionRecommendation(currentTicket, [{
    ticketNumber: 'OP-043', subject: 'Printer paper jam', description: 'Office printer has a paper jam.',
    category: 'Hardware', project: 'Printer fleet', responses: [{ resolutionNote: 'Opened the printer tray and removed the jam.' }],
  }]);
  assert.equal(result.source, 'troubleshooting_playbook');
  assert.equal(result.title, 'Isolate the connection issue');
});

test('similar-ticket evidence redacts credentials and contact details', () => {
  const result = buildResolutionRecommendation(currentTicket, [{
    ticketNumber: 'OP-044', subject: currentTicket.subject, description: currentTicket.description,
    category: currentTicket.category, project: currentTicket.project,
    responses: [{ resolutionNote: 'Reset token: abc-secret-123 and contact user@example.com.' }],
  }]);
  assert.equal(result.source, 'similar_resolved_ticket');
  assert.doesNotMatch(result.precedent?.resolution ?? '', /abc-secret-123|user@example\.com/);
  assert.match(result.precedent?.resolution ?? '', /redacted|\[email\]/);
});
