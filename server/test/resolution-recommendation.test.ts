import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackRecommendation, type ResolutionTicketContext } from '../src/services/resolutionRecommendationService.js';

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

test('analytics workspace access gets concrete least-privilege actions', () => {
  const result = buildFallbackRecommendation({
    ticketNumber: 'OP-101',
    subject: 'Request access to the analytics workspace',
    description: 'The analyst cannot open the shared analytics workspace after joining the project.',
    category: 'Assistance',
    project: 'Analytics',
  });
  assert.equal(result.source, 'troubleshooting_playbook');
  assert.equal(result.title, 'Restore analytics workspace access');
  assert.match(result.steps[0], /data-owner approval/i);
  assert.match(result.steps[2], /least-privilege/i);
  assert.equal('precedent' in result, false);
});
