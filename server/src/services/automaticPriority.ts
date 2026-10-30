export type AutomaticPriorityInput = {
  riskProbability?: number;
  riskThreshold?: number;
  riskCategory?: 'low' | 'medium' | 'high';
  resolutionHours?: number;
  workloadHistoryDays?: number;
  workload?: { highLoadDays: number; horizon: number; actualHistoryDays: number };
};

export type AutomaticPriorityDecision = {
  priority: 'Low' | 'Medium' | 'High';
  score: number;
  rationale: string;
};

/** Map the three model signals into a transparent operational priority. */
export function assignAutomaticPriority(input: AutomaticPriorityInput): AutomaticPriorityDecision {
  let score = 0;
  const reasons: string[] = [];
  const hasRisk = typeof input.riskProbability === 'number';
  const hasResolution = typeof input.resolutionHours === 'number';

  if (hasRisk && (input.riskCategory === 'high' || input.riskProbability! >= (input.riskThreshold ?? 1))) {
    score += 2;
    reasons.push(`high delay risk (${(input.riskProbability! * 100).toFixed(0)}%)`);
  } else if (hasRisk && (input.riskCategory === 'medium' || input.riskProbability! >= (input.riskThreshold ?? 1) * 0.8)) {
    score += 1;
    reasons.push(`moderate delay risk (${(input.riskProbability! * 100).toFixed(0)}%)`);
  } else if (hasRisk) {
    reasons.push(`low delay risk (${(input.riskProbability! * 100).toFixed(0)}%)`);
  }

  if (hasResolution && input.resolutionHours! >= 720) {
    score += 2;
    reasons.push(`long resolution estimate (${input.resolutionHours!.toFixed(0)} hours)`);
  } else if (hasResolution && input.resolutionHours! >= 168) {
    score += 1;
    reasons.push(`extended resolution estimate (${input.resolutionHours!.toFixed(0)} hours)`);
  } else if (hasResolution) {
    reasons.push(`resolution estimate ${input.resolutionHours!.toFixed(0)} hours`);
  }

  const workloadIsReliable = input.workload && input.workload.actualHistoryDays >= 60;
  const workloadIsHigh = workloadIsReliable
    && input.workload!.horizon > 0
    && input.workload!.highLoadDays >= Math.ceil(input.workload!.horizon / 2);
  if (workloadIsHigh && score > 0) {
    score += 1;
    reasons.push(`elevated queue forecast (${input.workload!.highLoadDays}/${input.workload!.horizon} high-load days)`);
  } else if (input.workload && !workloadIsReliable) {
    reasons.push('workload forecast excluded because fewer than 60 real history days are available');
  } else if (workloadIsReliable) {
    reasons.push(`queue forecast ${input.workload!.highLoadDays}/${input.workload!.horizon} high-load days`);
  } else if (typeof input.workloadHistoryDays === 'number' && input.workloadHistoryDays < 60) {
    reasons.push(`workload forecast skipped with ${input.workloadHistoryDays} real history days; 60 are required`);
  }

  // With no usable model output, keep the neutral default instead of inventing urgency.
  if (!hasRisk && !hasResolution) {
    return { priority: 'Medium', score: 0, rationale: 'Model signals were unavailable; assigned the neutral Medium priority for later review.' };
  }

  const priority = score >= 2 ? 'High' : score === 0 ? 'Low' : 'Medium';
  return {
    priority,
    score,
    rationale: `Automatically assigned ${priority} from ${reasons.join('; ')}.`,
  };
}
