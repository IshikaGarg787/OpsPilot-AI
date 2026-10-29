const HOUR_MS = 60 * 60 * 1000;

export type SlaTimeBasis = 'calendar_hours' | 'business_hours';
export type SlaStatus = 'not_applicable' | 'on_track' | 'at_risk' | 'breached' | 'met';

export interface SlaPauseInterval {
  startAt: Date | string;
  /** An omitted end means the pause continues through the evaluation timestamp. */
  endAt?: Date | string;
}

export interface SlaPolicyTargets {
  responseTargetHours: number;
  resolutionTargetHours: number;
  timeBasis: SlaTimeBasis;
  /** Required threshold; no business threshold is assumed by the service. */
  atRiskWithinHours: number;
}

export type SlaPolicyByPriority = Record<string, SlaPolicyTargets>;

/** Immutable, versioned policy contract supplied by a future policy store/configuration source. */
export interface SlaPolicyVersion {
  policyId: string;
  version: string;
  effectiveFrom: Date | string;
  /** Exclusive upper bound. Omit for a currently active version. */
  effectiveUntil?: Date | string | null;
  targetsByPriority: SlaPolicyByPriority;
}

export interface SlaCalculationInput {
  startAt?: Date | string | null;
  targetHours: number;
  /** Clock snapshot. Callers should inject this for deterministic calculations. */
  asOf: Date | string;
  /** Completion timestamp for a response or the latest resolution event. */
  completedAt?: Date | string | null;
  /** If later than completedAt, the item is active again and its original clock continues. */
  reopenedAt?: Date | string | null;
  pauseIntervals?: SlaPauseInterval[];
  atRiskWithinHours: number;
  timeBasis: SlaTimeBasis;
}

export interface SlaCalculation {
  status: SlaStatus;
  deadlineAt: Date | null;
  remainingHours: number | null;
  elapsedHours: number | null;
  clockPaused: boolean;
  timeBasis: SlaTimeBasis;
}

export interface TicketSlaInput {
  priority: string;
  policy: SlaPolicyVersion;
  createdAt?: Date | string | null;
  firstResponseAt?: Date | string | null;
  resolvedAt?: Date | string | null;
  reopenedAt?: Date | string | null;
  responsePauseIntervals?: SlaPauseInterval[];
  resolutionPauseIntervals?: SlaPauseInterval[];
  asOf: Date | string;
}

export interface TicketSlaResult {
  policy: { policyId: string; version: string };
  response: SlaCalculation;
  resolution: SlaCalculation;
}

function timestamp(value: Date | string, label: string): number {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new TypeError(`${label} must include an explicit timezone (Z or ±HH:MM).`);
  }
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${label} must be a valid timestamp.`);
  return milliseconds;
}

function validateHours(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite, non-negative number of hours.`);
  }
}

function assertCalendarBasis(timeBasis: SlaTimeBasis): void {
  if (timeBasis !== 'calendar_hours') {
    throw new RangeError('Business-hour SLA calculations are not implemented; use calendar_hours.');
  }
}

function pausedMilliseconds(
  startMs: number,
  endMs: number,
  intervals: SlaPauseInterval[],
): number {
  const clipped = intervals.map((interval) => {
    const intervalStart = timestamp(interval.startAt, 'Pause start');
    const intervalEnd = interval.endAt === undefined ? endMs : timestamp(interval.endAt, 'Pause end');
    if (intervalEnd < intervalStart) throw new RangeError('Pause end must not precede pause start.');
    return [Math.max(startMs, intervalStart), Math.min(endMs, intervalEnd)] as const;
  }).filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);

  let total = 0;
  let currentStart: number | undefined;
  let currentEnd = 0;
  for (const [start, end] of clipped) {
    if (currentStart === undefined) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  if (currentStart !== undefined) total += currentEnd - currentStart;
  return total;
}

function isPausedAt(asOfMs: number, intervals: SlaPauseInterval[]): boolean {
  return intervals.some((interval) => {
    const start = timestamp(interval.startAt, 'Pause start');
    const end = interval.endAt === undefined ? Number.POSITIVE_INFINITY : timestamp(interval.endAt, 'Pause end');
    if (end < start) throw new RangeError('Pause end must not precede pause start.');
    return start <= asOfMs && asOfMs < end;
  });
}

function deadlineMilliseconds(startMs: number, targetMs: number, asOfMs: number, intervals: SlaPauseInterval[]): number | null {
  // An active open pause has no known end, so its future deadline cannot be stated yet.
  if (intervals.some((interval) => interval.endAt === undefined && timestamp(interval.startAt, 'Pause start') <= asOfMs)) {
    return null;
  }
  let deadline = startMs + targetMs;
  for (let iteration = 0; iteration <= intervals.length; iteration += 1) {
    const adjusted = startMs + targetMs + pausedMilliseconds(startMs, deadline, intervals);
    if (adjusted === deadline) break;
    deadline = adjusted;
  }
  return deadline;
}

export function calculateSla(input: SlaCalculationInput): SlaCalculation {
  validateHours(input.targetHours, 'SLA target');
  validateHours(input.atRiskWithinHours, 'At-risk threshold');
  assertCalendarBasis(input.timeBasis);
  const asOfMs = timestamp(input.asOf, 'Evaluation timestamp');
  const intervals = input.pauseIntervals ?? [];
  const startMs = input.startAt == null ? null : timestamp(input.startAt, 'SLA start');

  // Validate provided pause intervals even when there is no applicable start.
  for (const interval of intervals) {
    const start = timestamp(interval.startAt, 'Pause start');
    if (start > asOfMs) throw new RangeError('Pause start must not be after the evaluation timestamp.');
    if (interval.endAt !== undefined && timestamp(interval.endAt, 'Pause end') < start) {
      throw new RangeError('Pause end must not precede pause start.');
    }
  }

  if (startMs === null || startMs > asOfMs) {
    return { status: 'not_applicable', deadlineAt: null, remainingHours: null, elapsedHours: null, clockPaused: false, timeBasis: input.timeBasis };
  }

  const completionMs = input.completedAt == null ? null : timestamp(input.completedAt, 'Completion timestamp');
  const reopenedMs = input.reopenedAt == null ? null : timestamp(input.reopenedAt, 'Reopen timestamp');
  if (completionMs !== null && completionMs < startMs) throw new RangeError('Completion timestamp must not precede SLA start.');
  if (reopenedMs !== null && reopenedMs < startMs) throw new RangeError('Reopen timestamp must not precede SLA start.');

  const completed = completionMs !== null && completionMs <= asOfMs &&
    (reopenedMs === null || reopenedMs > asOfMs || completionMs > reopenedMs);
  const endpointMs = completed ? completionMs! : asOfMs;
  const pausedMs = pausedMilliseconds(startMs, endpointMs, intervals);
  const elapsedMs = Math.max(0, endpointMs - startMs - pausedMs);
  const elapsedHours = elapsedMs / HOUR_MS;
  const targetMs = input.targetHours * HOUR_MS;
  const deadlineMs = deadlineMilliseconds(startMs, targetMs, asOfMs, intervals);
  const deadlineAt = deadlineMs === null ? null : new Date(deadlineMs);
  const remainingHours = (targetMs - elapsedMs) / HOUR_MS;
  const status: SlaStatus = completed
    ? (elapsedMs <= targetMs ? 'met' : 'breached')
    : remainingHours <= 0
      ? 'breached'
      : remainingHours <= input.atRiskWithinHours
        ? 'at_risk'
        : 'on_track';

  return {
    status,
    deadlineAt,
    remainingHours,
    elapsedHours,
    clockPaused: !completed && isPausedAt(asOfMs, intervals),
    timeBasis: input.timeBasis,
  };
}

export function getSlaTargets(policyByPriority: SlaPolicyByPriority, priority: string): SlaPolicyTargets {
  const targets = policyByPriority[priority];
  if (!targets) throw new RangeError(`No SLA policy is configured for priority "${priority}".`);
  validateHours(targets.responseTargetHours, 'Response target');
  validateHours(targets.resolutionTargetHours, 'Resolution target');
  validateHours(targets.atRiskWithinHours, 'At-risk threshold');
  assertCalendarBasis(targets.timeBasis);
  return targets;
}

/** Calculates response and resolution targets independently from the same ticket creation time. */
export function calculateTicketSla(input: TicketSlaInput): TicketSlaResult {
  if (!input.policy.policyId.trim() || !input.policy.version.trim()) {
    throw new TypeError('SLA policy ID and version are required.');
  }
  const effectiveFromMs = timestamp(input.policy.effectiveFrom, 'Policy effective-from timestamp');
  const effectiveUntilMs = input.policy.effectiveUntil == null
    ? null
    : timestamp(input.policy.effectiveUntil, 'Policy effective-until timestamp');
  if (effectiveUntilMs !== null && effectiveUntilMs <= effectiveFromMs) {
    throw new RangeError('Policy effective-until must be later than effective-from.');
  }
  if (input.createdAt != null) {
    const createdAtMs = timestamp(input.createdAt, 'Ticket creation timestamp');
    if (createdAtMs < effectiveFromMs || (effectiveUntilMs !== null && createdAtMs >= effectiveUntilMs)) {
      throw new RangeError('The supplied SLA policy version was not effective when the ticket was created.');
    }
  }
  const targets = getSlaTargets(input.policy.targetsByPriority, input.priority);
  return {
    policy: { policyId: input.policy.policyId, version: input.policy.version },
    response: calculateSla({
      startAt: input.createdAt,
      targetHours: targets.responseTargetHours,
      completedAt: input.firstResponseAt,
      pauseIntervals: input.responsePauseIntervals,
      atRiskWithinHours: targets.atRiskWithinHours,
      timeBasis: targets.timeBasis,
      asOf: input.asOf,
    }),
    resolution: calculateSla({
      startAt: input.createdAt,
      targetHours: targets.resolutionTargetHours,
      completedAt: input.resolvedAt,
      reopenedAt: input.reopenedAt,
      pauseIntervals: input.resolutionPauseIntervals,
      atRiskWithinHours: targets.atRiskWithinHours,
      timeBasis: targets.timeBasis,
      asOf: input.asOf,
    }),
  };
}
