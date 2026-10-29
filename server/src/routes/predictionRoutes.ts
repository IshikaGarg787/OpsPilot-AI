import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { PredictionModel } from '../models/Prediction.js';
import { databaseStatus } from '../config/database.js';
import { predictDelayRisk, predictResolution, forecastWorkload, checkWorkloadForecastHealth, MlServiceError } from '../services/mlService.js';
import { listQuerySchema, resolutionPredictionSchema, triagePipelineSchema, workloadForecastSchema } from '../validators/schemas.js';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { normalizedRole } from '../models/User.js';
import { backfillSavedTicketPredictions } from '../services/ticketPredictionHistory.js';
import { TicketModel } from '../models/Ticket.js';
import { UserModel } from '../models/User.js';
import { calculateTicketSlaForRecord } from '../services/slaPolicy.js';
import { customerPredictionFilter } from '../services/customerPredictions.js';

const router = Router();
router.use(requireAuth);

function requireDatabase() {
  if (!databaseStatus().connected) throw new HttpError(503, 'Prediction history is temporarily unavailable.', 'DATABASE_UNAVAILABLE');
}

const mlResponseSchema = z.object({
  duration: z.number().finite().nonnegative(),
  unit: z.literal('hours'),
  prediction_type: z.literal('point_estimate'),
  model_version: z.string().optional(),
  artifact_generated_at: z.string().optional(),
});

const riskResponseSchema = z.object({
  risk_probability: z.number().finite().min(0).max(1),
  risk_category: z.enum(['low', 'medium', 'high']),
  flagged_for_review: z.boolean(),
  decision_threshold: z.number().finite().min(0).max(1),
  target_threshold_hours: z.number().finite().positive(),
  model_version: z.string(),
  context: z.object({ historical_outcomes_known_before_ticket: z.number().int().nonnegative(), historical_delay_rate: z.number().min(0).max(1).nullable() }).optional(),
  explanation: z.object({ summary: z.string(), historical_evidence: z.array(z.object({ factor: z.string(), value: z.string(), historical_tickets: z.number().int().nonnegative(), historical_delay_rate: z.number().min(0).max(1) })), evidence_cutoff: z.string(), interpretation: z.string() }).optional(),
});

const workloadResponseSchema = z.object({
  model_id: z.string(),
  model_name: z.string(),
  mode: z.string(),
  generated_at: z.string(),
  history_start: z.string(),
  history_end: z.string(),
  history_days: z.number().int().positive(),
  ticket_total: z.number().nonnegative(),
  horizon: z.union([z.literal(7), z.literal(14)]),
  forecast: z.array(z.object({
    date: z.string(),
    weekday: z.string(),
    forecast: z.number().finite().nonnegative(),
    planning_low: z.number().finite().nonnegative(),
    planning_high: z.number().finite().nonnegative(),
    high_load_threshold: z.number().finite().nonnegative(),
    high_load_flag: z.boolean(),
  })).min(7).max(14),
  recent_history: z.array(z.object({ date: z.string(), ticket_count: z.number().finite().nonnegative() })),
  notes: z.array(z.string()),
});

const serialize = (prediction: any) => ({
  id: prediction._id.toString(),
  modelId: prediction.modelId,
  modelVersion: prediction.modelVersion,
  predictionType: prediction.predictionType,
  input: prediction.input,
  output: prediction.output,
  status: prediction.status,
  errorCode: prediction.errorCode,
  createdAt: prediction.createdAt,
});

router.post('/resolution-time', asyncHandler(async (req, res) => {
  requireDatabase();
  const input = resolutionPredictionSchema.parse(req.body);
  try {
    const response = mlResponseSchema.parse(await predictResolution(input));
    const saved = await PredictionModel.create({
      userId: req.user!._id,
      modelId: 'resolution-time',
      modelVersion: response.model_version,
      predictionType: response.prediction_type,
      input: { issueCreated: new Date(input.issue_created), priority: input.issue_priority, issueType: input.issue_type, project: input.issue_proj },
      output: { duration: response.duration, unit: response.unit },
      status: 'success',
    });
    res.status(201).json({ success: true, data: { prediction: serialize(saved), duration: response.duration, unit: response.unit, predictionType: response.prediction_type, modelId: 'resolution-time', modelVersion: response.model_version }, message: 'Prediction created.' });
  } catch (error) {
    const code = error instanceof MlServiceError ? error.code : 'ML_INVALID_RESPONSE';
    await PredictionModel.create({
      userId: req.user!._id,
      modelId: 'resolution-time',
      predictionType: 'point_estimate',
      input: { issueCreated: new Date(input.issue_created), priority: input.issue_priority, issueType: input.issue_type, project: input.issue_proj },
      status: 'failed',
      errorCode: code,
    }).catch(() => undefined);
    throw error instanceof MlServiceError ? error : new HttpError(503, 'The model service returned an invalid response.', code);
  }
}));

router.get('/workload/health', asyncHandler(async (_req, res) => {
  const health = await checkWorkloadForecastHealth();
  res.json({ success: true, data: { ...health.data, available: health.available }, message: health.available ? 'Workload forecast service is ready.' : 'Workload forecast service is unavailable.' });
}));

router.get('/workload/history', requireRole('admin'), asyncHandler(async (_req, res) => {
  requireDatabase();
  const daily = await TicketModel.aggregate([
    { $match: { ownerRole: 'customer' } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, ticket_count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const firstObserved = daily.length ? new Date(`${daily[0]._id}T00:00:00Z`) : null;
  const start = firstObserved && firstObserved <= end ? firstObserved : null;
  const dailyCounts = new Map(daily.map((row: any) => [row._id, row.ticket_count]));
  const records: Array<{ date: string; ticket_count: number }> = [];
  for (let time = start?.getTime(); time !== undefined && time <= end.getTime(); time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    records.push({ date, ticket_count: dailyCounts.get(date) ?? 0 });
  }
  const historyDays = records.length;
  const templateStart = new Date(end.getTime() - 179 * 86400000).toISOString().slice(0, 10);
  res.json({ success: true, data: { records, historyDays, ticketTotal: records.reduce((sum, row) => sum + row.ticket_count, 0), enoughHistory: historyDays >= 120, firstTicketDate: daily[0]?._id ?? null, lastCompleteDate: records.at(-1)?.date ?? null, templateStart, templateEnd: end.toISOString().slice(0, 10) }, message: daily.length ? 'Daily ticket history loaded from customer tickets in this workspace.' : 'No ticket history exists yet; a dated template range is ready for external data.' });
}));

router.post('/workload', asyncHandler(async (req, res) => {
  requireDatabase();
  const input = workloadForecastSchema.parse(req.body);
  try {
    const result = workloadResponseSchema.parse(await forecastWorkload(input.records, input.horizon));
    const forecastRows = result.forecast.map((day) => ({ date: day.date, forecast: day.forecast, planningLow: day.planning_low, planningHigh: day.planning_high, highLoad: day.high_load_flag }));
    const saved = await PredictionModel.create({
      userId: req.user!._id, modelId: 'workload-forecasting', modelVersion: result.model_id, predictionType: 'workload_forecast',
      input: { issueCreated: new Date(), priority: 'Not applicable', issueType: 'Workspace workload', project: 'Incoming ticket volume' },
      output: { workload: { historyStart: result.history_start, historyEnd: result.history_end, historyDays: result.history_days, horizon: result.horizon, ticketTotal: result.ticket_total, expectedTickets: forecastRows.reduce((sum, day) => sum + day.forecast, 0), highLoadDays: forecastRows.filter((day) => day.highLoad).length, modelVersion: result.model_id, source: input.source, forecast: forecastRows } },
      status: 'success',
    });
    res.json({ success: true, data: { ...result, prediction_id: saved._id.toString(), source: input.source }, message: 'Workload forecast generated and saved to prediction history.' });
  } catch (error) {
    if (error instanceof MlServiceError) throw new HttpError(error.status, error.message, error.code);
    if (error instanceof z.ZodError) throw new HttpError(503, 'The workload service returned an invalid response.', 'ML_INVALID_RESPONSE');
    throw error;
  }
}));

router.post('/triage', requireRole('admin'), asyncHandler(async (req, res) => {
  requireDatabase();
  const input = triagePipelineSchema.parse(req.body);
  const linkedTicket = input.ticketId ? await TicketModel.findById(input.ticketId) : null;
  if (input.ticketId && !linkedTicket) throw new HttpError(404, 'Ticket not found.', 'TICKET_NOT_FOUND');
  if (linkedTicket && (linkedTicket.category !== input.issue_type || linkedTicket.priority !== input.issue_priority || linkedTicket.project !== input.issue_proj || linkedTicket.description !== input.complaint || Math.abs(linkedTicket.createdAt.getTime() - Date.parse(input.issue_created)) > 60_000)) {
    throw new HttpError(409, 'Ticket details changed. Reload the ticket before running its decision flow.', 'TICKET_INPUT_MISMATCH');
  }
  const ticket = {
    issue_created: new Date(input.issue_created).toISOString(),
    issue_priority: input.issue_priority,
    issue_type: input.issue_type,
    issue_proj: input.issue_proj,
  };
  try {
    // Keep the decision order explicit: risk triage, resolution estimate, then forward workload.
    const risk = riskResponseSchema.parse(await predictDelayRisk({ ...ticket, issue_reporter: 'new-intake' }));
    const duration = mlResponseSchema.parse(await predictResolution(ticket));
    const workload = workloadResponseSchema.parse(await forecastWorkload(input.workload_records, input.horizon));
    const expectedTickets = workload.forecast.reduce((total, day) => total + day.forecast, 0);
    const ticketSla = linkedTicket ? calculateTicketSlaForRecord(linkedTicket) : null;
    const slaNeedsReview = Boolean(ticketSla && [ticketSla.response.status, ticketSla.resolution.status].some((status) => status === 'at_risk' || status === 'breached'));
    const activeMembers = await UserModel.find({ role: 'it_team', availability: { $ne: 'unavailable' } }).select('name email skills availability').sort({ name: 1 }).lean();
    const memberLoads = await TicketModel.aggregate([
      { $match: { status: { $in: ['assigned', 'in_progress'] }, assignedTo: { $ne: null }, ...(linkedTicket ? { _id: { $ne: linkedTicket._id } } : {}) } },
      { $group: { _id: '$assignedTo', activeTickets: { $sum: 1 } } },
    ]);
    const loadByMember = new Map(memberLoads.map((item: any) => [String(item._id), item.activeTickets as number]));
    const issueTerms = `${input.issue_type} ${input.issue_proj}`.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 3);
    const freeMembers = activeMembers.filter((member: any) => (loadByMember.get(String(member._id)) ?? 0) === 0);
    const skillFit = (member: any) => (member.skills ?? []).reduce((score: number, skill: string) => score + (issueTerms.some((term) => skill.toLowerCase().includes(term) || term.includes(skill.toLowerCase())) ? 1 : 0), 0);
    const assignmentRecommendation = freeMembers.length
      ? [...freeMembers].sort((a: any, b: any) => skillFit(b) - skillFit(a) || a.name.localeCompare(b.name))[0]
      : null;
    const recommendReview = risk.flagged_for_review || slaNeedsReview;
    const recommendedPriority = recommendReview && /^(low|lowest|medium)$/i.test(input.issue_priority.trim())
      ? ({ lowest: 'Low', low: 'Medium', medium: 'High' }[input.issue_priority.trim().toLowerCase()] ?? input.issue_priority)
      : input.issue_priority;
    const riskExplanation = risk.explanation ? {
      summary: risk.explanation.summary,
      historicalEvidence: risk.explanation.historical_evidence,
      evidenceCutoff: risk.explanation.evidence_cutoff,
      interpretation: risk.explanation.interpretation,
    } : undefined;
    if (linkedTicket) {
      linkedTicket.aiSignals = {
        delayRiskProbability: risk.risk_probability, delayRiskCategory: risk.risk_category,
        flaggedForReview: risk.flagged_for_review, reviewThreshold: risk.decision_threshold,
        targetThresholdHours: risk.target_threshold_hours, resolutionHours: duration.duration,
        riskModelVersion: risk.model_version, resolutionModelVersion: duration.model_version,
        ...(riskExplanation ? { riskExplanation } : {}),
        ...(assignmentRecommendation ? { recommendedAssignee: { id: String(assignmentRecommendation._id), name: assignmentRecommendation.name, activeTickets: loadByMember.get(String(assignmentRecommendation._id)) ?? 0 } } : {}),
        recommendedPriority,
        checkedAt: new Date(),
      };
      linkedTicket.workloadOutlook = {
        historyStart: workload.history_start, historyEnd: workload.history_end, historyDays: workload.history_days,
        horizon: workload.horizon, expectedTickets, highLoadDays: workload.forecast.filter((day) => day.high_load_flag).length,
        modelVersion: workload.model_id,
        forecast: workload.forecast.map((day) => ({ date: day.date, forecast: day.forecast, planningLow: day.planning_low, planningHigh: day.planning_high, highLoad: day.high_load_flag })),
        generatedAt: new Date(),
      };
      if (!linkedTicket.recommendation?.state || linkedTicket.recommendation.state === 'pending') {
        linkedTicket.recommendation = {
          action: recommendReview ? 'priority_review' : 'standard_queue', state: 'pending',
          rationale: `${risk.flagged_for_review ? `Risk ${Math.round(risk.risk_probability * 100)}% crossed the ${Math.round(risk.decision_threshold * 100)}% review threshold` : `Risk ${Math.round(risk.risk_probability * 100)}% stayed below the ${Math.round(risk.decision_threshold * 100)}% review threshold`}.${slaNeedsReview ? ` SLA status: response ${ticketSla!.response.status}, resolution ${ticketSla!.resolution.status}.` : ''} ${riskExplanation?.historicalEvidence.map((item) => `${item.factor} ${item.value}: ${Math.round(item.historical_delay_rate * 100)}% delayed across ${item.historical_tickets} historical tickets`).join('; ') || `${risk.context?.historical_outcomes_known_before_ticket ?? 0} historical outcomes were known before this ticket`}. Suggested priority: ${recommendedPriority}.${assignmentRecommendation ? ` Lowest-load available assignee: ${assignmentRecommendation.name} (${loadByMember.get(String(assignmentRecommendation._id)) ?? 0} active tickets).` : ' No IT Team members are available for assignment.'} Delay risk and SLA clocks have different definitions.`,
        };
      }
      linkedTicket.audit.push({ actorId: req.user!._id, actorName: req.user!.name, actorRole: 'admin', action: 'ai_decision_flow_completed', details: `Risk, resolution, and ${workload.horizon}-day workload outlook refreshed.` } as any);
      await linkedTicket.save();
    }
    const saved = await PredictionModel.create({
      userId: req.user!._id,
      modelId: 'triage-pipeline',
      modelVersion: `${risk.model_version} | ${duration.model_version ?? 'resolution'} | ${workload.model_id}`,
      predictionType: 'integrated_operational_decision',
      input: { issueCreated: new Date(input.issue_created), priority: input.issue_priority, issueType: input.issue_type, project: input.issue_proj, complaint: input.complaint, ...(linkedTicket ? { ticketId: linkedTicket._id } : {}) },
      output: {
        duration: duration.duration,
        unit: duration.unit,
        delayRisk: { probability: risk.risk_probability, category: risk.risk_category, flaggedForReview: risk.flagged_for_review, decisionThreshold: risk.decision_threshold, targetThresholdHours: risk.target_threshold_hours, modelVersion: risk.model_version, ...(riskExplanation ? { explanation: riskExplanation } : {}) },
        workload: {
          historyStart: workload.history_start,
          historyEnd: workload.history_end,
          historyDays: workload.history_days,
          horizon: workload.horizon,
          ticketTotal: workload.ticket_total,
          expectedTickets,
          highLoadDays: workload.forecast.filter((day) => day.high_load_flag).length,
          modelVersion: workload.model_id,
          source: input.workload_source,
          forecast: workload.forecast.map((day) => ({ date: day.date, forecast: day.forecast, planningLow: day.planning_low, planningHigh: day.planning_high, highLoad: day.high_load_flag })),
        },
      },
      status: 'success',
    });
    res.status(201).json({ success: true, data: { prediction: serialize(saved), risk, resolution: duration, workload, recommendation: { recommendedPriority, assignee: assignmentRecommendation ? { id: String(assignmentRecommendation._id), name: assignmentRecommendation.name, activeTickets: loadByMember.get(String(assignmentRecommendation._id)) ?? 0 } : null }, sla: ticketSla }, message: 'Ticket decision pipeline completed.' });
  } catch (error) {
    if (error instanceof MlServiceError) throw new HttpError(error.status, error.message, error.code);
    if (error instanceof z.ZodError) throw new HttpError(503, 'A model returned an unexpected response; no pipeline result was saved.', 'ML_INVALID_RESPONSE');
    throw error;
  }
}));

router.get('/', asyncHandler(async (req, res) => {
  requireDatabase();
  await backfillSavedTicketPredictions(req.user!);
  const query = listQuerySchema.parse(req.query);
  const role = normalizedRole(req.user!);
  const customer = role === 'customer';
  const filter: Record<string, unknown> = role === 'admin' ? {} : customer ? customerPredictionFilter(req.user!._id) : { userId: req.user!._id };
  if (query.modelId && (!customer || query.modelId === 'resolution-time')) filter.modelId = query.modelId;
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
  const [items, total] = await Promise.all([
    PredictionModel.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
    PredictionModel.countDocuments(filter),
  ]);
  res.json({ success: true, data: { items: items.map(serialize), page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  requireDatabase();
  const role = normalizedRole(req.user!);
  const filter = role === 'admin'
    ? { _id: req.params.id }
    : role === 'customer'
      ? { _id: req.params.id, ...customerPredictionFilter(req.user!._id) }
      : { _id: req.params.id, userId: req.user!._id };
  const prediction = await PredictionModel.findOne(filter).lean();
  if (!prediction) throw new HttpError(404, 'Prediction not found.', 'PREDICTION_NOT_FOUND');
  res.json({ success: true, data: { prediction: serialize(prediction) } });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  requireDatabase();
  const deleted = await PredictionModel.deleteOne({ _id: req.params.id, userId: req.user!._id });
  if (!deleted.deletedCount) throw new HttpError(404, 'Prediction not found.', 'PREDICTION_NOT_FOUND');
  res.json({ success: true, data: null, message: 'Prediction removed.' });
}));

export default router;
