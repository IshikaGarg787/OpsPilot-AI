export type RecommendationCandidate = {
  id: string;
  name: string;
  activeTickets: number;
  skills: string[];
  slaBreaches?: number;
};

export type RecommendationAssessment = {
  action: 'priority_review' | 'standard_queue';
  recommendedPriority: string;
  rationale: string;
  assignee: (Omit<RecommendationCandidate, 'skills'> & { matchingSkills: string[] }) | null;
};

type RecommendationInput = {
  priority: string;
  riskProbability: number;
  riskThreshold: number;
  flaggedForReview: boolean;
  resolutionHours?: number;
  sla?: {
    response: { status: string; remainingHours: number | null };
    resolution: { status: string; remainingHours: number | null; elapsedHours?: number | null };
  } | null;
  historicalEvidence?: Array<{ factor: string; value: string; historicalDelayRate: number; historicalTickets: number }>;
  workload?: { horizon: number; expectedTickets: number; highLoadDays: number };
  candidates?: RecommendationCandidate[];
  issueType?: string;
  project?: string;
};

function suggestPriority(priority: string, needsReview: boolean): string {
  if (!needsReview) return priority;
  const nextPriority: Record<string, string> = { lowest: 'Low', low: 'Medium', medium: 'High' };
  return nextPriority[priority.trim().toLowerCase()] ?? priority;
}

export function recommendAssignee(candidates: RecommendationCandidate[], issueType = '', project = ''): RecommendationAssessment['assignee'] {
  return rankAssignees(candidates, issueType, project)[0] ?? null;
}

export function rankAssignees(candidates: RecommendationCandidate[], issueType = '', project = ''): Array<Omit<RecommendationCandidate, 'skills'> & { matchingSkills: string[]; availability: 'available' | 'unavailable' }> {
  if (!candidates.length) return [];
  const issueTerms = `${issueType} ${project}`.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
  const ranked = candidates.map((candidate) => {
    const matchingSkills = (candidate.skills ?? []).filter((skill) => {
      const normalizedSkill = skill.toLowerCase().trim();
      return normalizedSkill && issueTerms.some((term) => normalizedSkill.includes(term) || term.includes(normalizedSkill));
    });
    const activeTickets = candidate.activeTickets ?? 0;
    return { id: candidate.id, name: candidate.name, activeTickets, slaBreaches: candidate.slaBreaches ?? 0, matchingSkills, availability: activeTickets === 0 ? 'available' as const : 'unavailable' as const };
  });

  const availableExists = ranked.some((candidate) => candidate.availability === 'available');
  ranked.sort((a, b) => {
    if (availableExists && a.availability !== b.availability) return a.availability === 'available' ? -1 : 1;
    // With no available members, minimize unresolved work first; then use skill fit and SLA history.
    if (!availableExists && a.activeTickets !== b.activeTickets) return a.activeTickets - b.activeTickets;
    return b.matchingSkills.length - a.matchingSkills.length || a.slaBreaches - b.slaBreaches || a.activeTickets - b.activeTickets || a.name.localeCompare(b.name);
  });
  return ranked;
}

export function buildRecommendation(input: RecommendationInput): RecommendationAssessment {
  const reasons: string[] = [];
  const responseNeedsReview = ['at_risk', 'breached'].includes(input.sla?.response.status ?? '');
  const resolutionNeedsReview = ['at_risk', 'breached'].includes(input.sla?.resolution.status ?? '');
  const estimatedRemainingHours = typeof input.resolutionHours === 'number'
    ? Math.max(0, input.resolutionHours - (input.sla?.resolution.elapsedHours ?? 0))
    : null;
  const estimateExceedsSla = typeof estimatedRemainingHours === 'number'
    && typeof input.sla?.resolution.remainingHours === 'number'
    && estimatedRemainingHours > input.sla.resolution.remainingHours;
  const needsReview = input.flaggedForReview || responseNeedsReview || resolutionNeedsReview || estimateExceedsSla;

  reasons.push(input.flaggedForReview
    ? `Delay risk ${(input.riskProbability * 100).toFixed(1)}% met or exceeded its ${(input.riskThreshold * 100).toFixed(1)}% review threshold.`
    : `Delay risk ${(input.riskProbability * 100).toFixed(1)}% is below its ${(input.riskThreshold * 100).toFixed(1)}% review threshold.`);
  const strongestEvidence = input.historicalEvidence?.slice(0, 2) ?? [];
  if (strongestEvidence.length) {
    reasons.push(`Historical context: ${strongestEvidence.map((item) => `${item.factor} ${item.value} had a ${(item.historicalDelayRate * 100).toFixed(1)}% delay rate across ${item.historicalTickets} earlier tickets`).join('; ')}.`);
  }
  if (responseNeedsReview || resolutionNeedsReview) {
    const statuses = [
      responseNeedsReview ? `response SLA ${input.sla!.response.status.replace('_', ' ')}` : '',
      resolutionNeedsReview ? `resolution SLA ${input.sla!.resolution.status.replace('_', ' ')}` : '',
    ].filter(Boolean);
    reasons.push(`${statuses.join(' and ')} need attention.`);
  } else if (input.sla) {
    reasons.push('SLA clocks are not currently at risk.');
  }
  if (estimateExceedsSla) {
    reasons.push(`The estimated remaining work time (${estimatedRemainingHours!.toFixed(1)} hours) is longer than the ${(input.sla!.resolution.remainingHours as number).toFixed(1)} hours remaining on the SLA clock.`);
  }

  const assignee = recommendAssignee(input.candidates ?? [], input.issueType, input.project);
  if (assignee) {
    reasons.push(`Suggested teammate: ${assignee.name}, with ${assignee.activeTickets} unresolved ${assignee.activeTickets === 1 ? 'ticket' : 'tickets'}${assignee.matchingSkills.length ? ` and ${assignee.matchingSkills.length} matching ${assignee.matchingSkills.length === 1 ? 'skill' : 'skills'}` : ''}. Availability is preferred; skill fit ranks available members and the lowest unresolved load ranks the team when all are busy. SLA breaches break ties.`);
  } else {
    reasons.push('No available IT teammates were found for an assignment suggestion.');
  }

  if (input.workload) {
    reasons.push(`The ${input.workload.horizon}-day workload outlook estimates ${Math.round(input.workload.expectedTickets)} incoming tickets and ${input.workload.highLoadDays} high-load days; use this for team planning, not as a ticket-level SLA prediction.`);
  }
  reasons.push('The ticket priority and initial assignment are automated at intake. This separate recommendation is decision support and does not change the ticket until reviewed.');

  return {
    action: needsReview ? 'priority_review' : 'standard_queue',
    recommendedPriority: suggestPriority(input.priority, needsReview),
    rationale: reasons.join(' '),
    assignee,
  };
}
