import { calculateTicketSla, type SlaPolicyVersion } from './slaService.js';

// Prototype policy in calendar hours. Replace targets and version through a policy store
// once the organization approves its contractual SLAs.
export const prototypeSlaPolicy: SlaPolicyVersion = {
  policyId: 'opspilot-prototype',
  version: '2026-01',
  effectiveFrom: '2020-01-01T00:00:00Z',
  targetsByPriority: {
    highest: { responseTargetHours: 1, resolutionTargetHours: 24, atRiskWithinHours: 4, timeBasis: 'calendar_hours' },
    highest_priority: { responseTargetHours: 1, resolutionTargetHours: 24, atRiskWithinHours: 4, timeBasis: 'calendar_hours' },
    critical: { responseTargetHours: 1, resolutionTargetHours: 24, atRiskWithinHours: 4, timeBasis: 'calendar_hours' },
    urgent: { responseTargetHours: 1, resolutionTargetHours: 24, atRiskWithinHours: 4, timeBasis: 'calendar_hours' },
    high: { responseTargetHours: 4, resolutionTargetHours: 72, atRiskWithinHours: 12, timeBasis: 'calendar_hours' },
    medium: { responseTargetHours: 8, resolutionTargetHours: 168, atRiskWithinHours: 24, timeBasis: 'calendar_hours' },
    low: { responseTargetHours: 24, resolutionTargetHours: 720, atRiskWithinHours: 48, timeBasis: 'calendar_hours' },
    lowest: { responseTargetHours: 48, resolutionTargetHours: 1440, atRiskWithinHours: 72, timeBasis: 'calendar_hours' },
  },
};

function policyPriority(priority: string): string {
  const normalized = priority.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized in prototypeSlaPolicy.targetsByPriority) return normalized;
  if (/critical|urgent|p0|sev0|blocker/.test(normalized)) return 'critical';
  if (/highest|p1|sev1/.test(normalized)) return 'highest';
  if (/high|p2|sev2/.test(normalized)) return 'high';
  if (/medium|normal|p3|sev3/.test(normalized)) return 'medium';
  if (/lowest|trivial|p5/.test(normalized)) return 'lowest';
  if (/low|minor|p4|sev4/.test(normalized)) return 'low';
  throw new RangeError(`No prototype SLA mapping is configured for priority "${priority}".`);
}

export function calculateTicketSlaForRecord(ticket: {
  priority: string; createdAt: Date; status: string; resolutionCompletedAt?: Date | null;
  resolutionReopenedAt?: Date | null; responses?: Array<{ authorRole: string; createdAt: Date }>;
}, asOf = new Date()) {
  let mappedPriority: string;
  try { mappedPriority = policyPriority(ticket.priority); } catch { return null; }
  const firstResponse = ticket.responses?.find((response) => response.authorRole !== 'customer');
  const terminalWithoutTimestamp = ['resolved', 'closed'].includes(ticket.status) && !ticket.resolutionCompletedAt;
  const resolvedAt = ticket.resolutionCompletedAt ?? null;
  const result = calculateTicketSla({
    priority: mappedPriority, policy: prototypeSlaPolicy, createdAt: ticket.createdAt,
    firstResponseAt: firstResponse?.createdAt ?? null, resolvedAt,
    reopenedAt: ticket.resolutionReopenedAt ?? null, asOf,
  });
  if (terminalWithoutTimestamp) result.resolution = { status: 'not_applicable', deadlineAt: null, remainingHours: null, elapsedHours: null, clockPaused: false, timeBasis: 'calendar_hours' };
  return result;
}
