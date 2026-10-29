import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSla, calculateTicketSla, type SlaCalculationInput } from '../src/services/slaService.js';

const hour = 60 * 60 * 1000;
const start = new Date('2026-01-01T00:00:00.000Z');

function input(overrides: Partial<SlaCalculationInput> = {}): SlaCalculationInput {
  return {
    startAt: start,
    targetHours: 8,
    asOf: new Date(start.getTime() + hour),
    atRiskWithinHours: 2,
    timeBasis: 'calendar_hours',
    ...overrides,
  };
}

test('completed SLA is met when completed before its deadline', () => {
  const result = calculateSla(input({
    completedAt: new Date(start.getTime() + 3 * hour),
    asOf: new Date(start.getTime() + 3 * hour),
  }));
  assert.equal(result.status, 'met');
  assert.equal(result.remainingHours, 5);
  assert.equal(result.deadlineAt?.getTime(), start.getTime() + 8 * hour);
});

test('completion exactly at the deadline is met; unresolved deadline equality is breached', () => {
  const completedAtDeadline = calculateSla(input({
    completedAt: new Date(start.getTime() + 8 * hour),
    asOf: new Date(start.getTime() + 8 * hour),
  }));
  assert.equal(completedAtDeadline.status, 'met');
  assert.equal(completedAtDeadline.remainingHours, 0);

  const stillOpenAtDeadline = calculateSla(input({ asOf: new Date(start.getTime() + 8 * hour) }));
  assert.equal(stillOpenAtDeadline.status, 'breached');
});

test('an unresolved SLA is breached when its deadline is reached exactly', () => {
  const result = calculateSla(input({ asOf: new Date(start.getTime() + 8 * hour) }));
  assert.equal(result.status, 'breached');
  assert.equal(result.remainingHours, 0);
});

test('an unresolved SLA is breached after its deadline', () => {
  const result = calculateSla(input({ asOf: new Date(start.getTime() + 9 * hour) }));
  assert.equal(result.status, 'breached');
  assert.equal(result.remainingHours, -1);
});

test('an unresolved SLA is at risk only inside the configured threshold', () => {
  const result = calculateSla(input({ asOf: new Date(start.getTime() + 7 * hour) }));
  assert.equal(result.status, 'at_risk');
});

test('an SLA without a start timestamp is not applicable', () => {
  const result = calculateSla(input({ startAt: null }));
  assert.equal(result.status, 'not_applicable');
  assert.equal(result.deadlineAt, null);
  assert.equal(result.remainingHours, null);
});

test('invalid or negative targets and thresholds are rejected', () => {
  assert.throws(() => calculateSla(input({ targetHours: -1 })), RangeError);
  assert.throws(() => calculateSla(input({ targetHours: Number.NaN })), RangeError);
  assert.throws(() => calculateSla(input({ atRiskWithinHours: -1 })), RangeError);
});

test('explicit pause intervals stop the clock and extend the deadline', () => {
  const result = calculateSla(input({
    asOf: new Date(start.getTime() + 6 * hour),
    pauseIntervals: [{ startAt: new Date(start.getTime() + 2 * hour), endAt: new Date(start.getTime() + 4 * hour) }],
  }));
  assert.equal(result.elapsedHours, 4);
  assert.equal(result.remainingHours, 4);
  assert.equal(result.deadlineAt?.getTime(), start.getTime() + 10 * hour);
  assert.equal(result.status, 'on_track');
});

test('overlapping pauses are merged instead of double-counted', () => {
  const result = calculateSla(input({
    asOf: new Date(start.getTime() + 6 * hour),
    pauseIntervals: [
      { startAt: new Date(start.getTime() + 2 * hour), endAt: new Date(start.getTime() + 5 * hour) },
      { startAt: new Date(start.getTime() + 3 * hour), endAt: new Date(start.getTime() + 4 * hour) },
    ],
  }));
  assert.equal(result.elapsedHours, 3);
  assert.equal(result.deadlineAt?.getTime(), start.getTime() + 11 * hour);
});

test('an unresolved open pause marks the clock paused and leaves deadline unknown', () => {
  const result = calculateSla(input({
    asOf: new Date(start.getTime() + 3 * hour),
    pauseIntervals: [{ startAt: new Date(start.getTime() + 2 * hour) }],
  }));
  assert.equal(result.clockPaused, true);
  assert.equal(result.deadlineAt, null);
  assert.equal(result.elapsedHours, 2);
});

test('a resolved SLA remains met after completion; reopening resumes the original clock', () => {
  const completed = calculateSla(input({
    completedAt: new Date(start.getTime() + 2 * hour),
    asOf: new Date(start.getTime() + 6 * hour),
  }));
  assert.equal(completed.status, 'met');
  assert.equal(completed.elapsedHours, 2);

  const reopened = calculateSla(input({
    completedAt: new Date(start.getTime() + 2 * hour),
    reopenedAt: new Date(start.getTime() + 5 * hour),
    asOf: new Date(start.getTime() + 6 * hour),
  }));
  assert.equal(reopened.status, 'at_risk');
  assert.equal(reopened.elapsedHours, 6);
});

test('repeated resolve and reopen snapshots use the latest event and retain the original start', () => {
  const resolvedAgain = calculateSla(input({
    completedAt: new Date(start.getTime() + 6 * hour),
    reopenedAt: new Date(start.getTime() + 4 * hour),
    asOf: new Date(start.getTime() + 7 * hour),
    atRiskWithinHours: 1,
  }));
  assert.equal(resolvedAgain.status, 'met');
  assert.equal(resolvedAgain.elapsedHours, 6);

  const reopenedAgain = calculateSla(input({
    completedAt: new Date(start.getTime() + 6 * hour),
    reopenedAt: new Date(start.getTime() + 7 * hour),
    asOf: new Date(start.getTime() + 8 * hour),
  }));
  assert.equal(reopenedAgain.status, 'breached');
  assert.equal(reopenedAgain.elapsedHours, 8);
});

test('response and resolution SLAs are evaluated independently', () => {
  const result = calculateTicketSla({
    priority: 'example',
    policy: {
      policyId: 'support',
      version: '2026-01',
      effectiveFrom: start,
      targetsByPriority: { example: { responseTargetHours: 2, resolutionTargetHours: 10, atRiskWithinHours: 1, timeBasis: 'calendar_hours' } },
    },
    createdAt: start,
    firstResponseAt: new Date(start.getTime() + hour),
    asOf: new Date(start.getTime() + 3 * hour),
  });
  assert.deepEqual(result.policy, { policyId: 'support', version: '2026-01' });
  assert.equal(result.response.status, 'met');
  assert.equal(result.resolution.status, 'on_track');
  assert.equal(result.response.deadlineAt?.getTime(), start.getTime() + 2 * hour);
  assert.equal(result.resolution.deadlineAt?.getTime(), start.getTime() + 10 * hour);
});

test('offset timestamps normalize to the same UTC instant and naive strings are rejected', () => {
  const offset = calculateSla(input({
    startAt: '2026-01-01T05:30:00+05:30',
    asOf: '2026-01-01T00:00:00Z',
  }));
  const utc = calculateSla(input({ startAt: '2026-01-01T00:00:00Z', asOf: '2026-01-01T00:00:00Z' }));
  assert.equal(offset.deadlineAt?.getTime(), utc.deadlineAt?.getTime());
  assert.equal(offset.status, utc.status);
  assert.throws(() => calculateSla(input({ startAt: '2026-01-01T00:00:00' })), /explicit timezone/);
});

test('policy version must be effective on the ticket creation date', () => {
  const base = {
    priority: 'example',
    policy: {
      policyId: 'support',
      version: 'v2',
      effectiveFrom: new Date(start.getTime() + hour),
      targetsByPriority: { example: { responseTargetHours: 2, resolutionTargetHours: 10, atRiskWithinHours: 1, timeBasis: 'calendar_hours' as const } },
    },
    createdAt: start,
    asOf: new Date(start.getTime() + 2 * hour),
  };
  assert.throws(() => calculateTicketSla(base), /not effective/);
});

test('business-hour policies are rejected instead of treated as calendar hours', () => {
  assert.throws(() => calculateSla(input({ timeBasis: 'business_hours' })), /not implemented/);
});
