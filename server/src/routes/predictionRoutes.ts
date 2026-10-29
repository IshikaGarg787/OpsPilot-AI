import { Router } from 'express';
import { requireAdminOwner, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { PredictionModel } from '../models/Prediction.js';
import { databaseStatus } from '../config/database.js';
import { predictDelayRisk, predictResolution, forecastWorkload, MlServiceError } from '../services/mlService.js';
import { listQuerySchema, resolutionPredictionSchema, triagePipelineSchema } from '../validators/schemas.js';
import { z } from 'zod';
import { TicketModel } from '../models/Ticket.js';

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
});

const workloadResponseSchema = z.object({
  model_id: z.string(),
  history_start: z.string(),
  history_end: z.string(),
  history_days: z.number().int().positive(),
  ticket_total: z.number().nonnegative(),
  horizon: z.union([z.literal(7), z.literal(14)]),
  forecast: z.array(z.object({
    date: z.string(),
    forecast: z.number().finite().nonnegative(),
    planning_low: z.number().finite().nonnegative(),
    planning_high: z.number().finite().nonnegative(),
    high_load_flag: z.boolean(),
  })).min(7).max(14),
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
      modelVersion: response.model_version ?? response.artifact_generated_at,
      predictionType: response.prediction_type,
      input: { issueCreated: new Date(input.issue_created), priority: input.issue_priority, issueType: input.issue_type, project: input.issue_proj },
      output: { duration: response.duration, unit: response.unit },
      status: 'success',
    });
    res.status(201).json({ success: true, data: { prediction: serialize(saved), duration: response.duration, unit: response.unit, predictionType: response.prediction_type, modelId: 'resolution-time', modelVersion: response.model_version ?? response.artifact_generated_at }, message: 'Prediction created.' });
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

router.post('/triage', requireRole('admin'), requireAdminOwner, asyncHandler(async (req, res) => {
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
    if (linkedTicket) {
      linkedTicket.aiSignals = {
        delayRiskProbability: risk.risk_probability, delayRiskCategory: risk.risk_category,
        flaggedForReview: risk.flagged_for_review, reviewThreshold: risk.decision_threshold,
        targetThresholdHours: risk.target_threshold_hours, resolutionHours: duration.duration,
        riskModelVersion: risk.model_version, resolutionModelVersion: duration.model_version ?? duration.artifact_generated_at,
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
          action: risk.flagged_for_review ? 'priority_review' : 'standard_queue', state: 'pending',
          rationale: risk.flagged_for_review ? 'The delay-risk model crossed its high-recall review threshold.' : 'The delay-risk model did not cross its review threshold.',
        };
      }
      linkedTicket.audit.push({ actorId: req.user!._id, actorName: req.user!.name, actorRole: 'admin', action: 'ai_decision_flow_completed', details: `Risk, resolution, and ${workload.horizon}-day workload outlook refreshed.` } as any);
      await linkedTicket.save();
    }
    const saved = await PredictionModel.create({
      userId: req.user!._id,
      modelId: 'triage-pipeline',
      modelVersion: `${risk.model_version} | ${duration.model_version ?? duration.artifact_generated_at ?? 'resolution'} | ${workload.model_id}`,
      predictionType: 'integrated_operational_decision',
      input: { issueCreated: new Date(input.issue_created), priority: input.issue_priority, issueType: input.issue_type, project: input.issue_proj, complaint: input.complaint, ...(linkedTicket ? { ticketId: linkedTicket._id } : {}) },
      output: {
        duration: duration.duration,
        unit: duration.unit,
        delayRisk: { probability: risk.risk_probability, category: risk.risk_category, flaggedForReview: risk.flagged_for_review, decisionThreshold: risk.decision_threshold, targetThresholdHours: risk.target_threshold_hours, modelVersion: risk.model_version },
        workload: {
          historyStart: workload.history_start,
          historyEnd: workload.history_end,
          historyDays: workload.history_days,
          horizon: workload.horizon,
          ticketTotal: workload.ticket_total,
          expectedTickets,
          highLoadDays: workload.forecast.filter((day) => day.high_load_flag).length,
          modelVersion: workload.model_id,
          forecast: workload.forecast.map((day) => ({ date: day.date, forecast: day.forecast, planningLow: day.planning_low, planningHigh: day.planning_high, highLoad: day.high_load_flag })),
        },
      },
      status: 'success',
    });
    res.status(201).json({ success: true, data: { prediction: serialize(saved), risk, resolution: duration, workload }, message: 'Ticket decision pipeline completed.' });
  } catch (error) {
    if (error instanceof MlServiceError) throw new HttpError(error.status, error.message, error.code);
    if (error instanceof z.ZodError) throw new HttpError(503, 'A model returned an unexpected response; no pipeline result was saved.', 'ML_INVALID_RESPONSE');
    throw error;
  }
}));

router.get('/', asyncHandler(async (req, res) => {
  requireDatabase();
  const query = listQuerySchema.parse(req.query);
  const filter: Record<string, unknown> = { userId: req.user!._id };
  if (query.modelId) filter.modelId = query.modelId;
  if (query.from || query.to) filter.createdAt = { ...(query.from ? { $gte: new Date(query.from) } : {}), ...(query.to ? { $lte: new Date(query.to) } : {}) };
  const [items, total] = await Promise.all([
    PredictionModel.find(filter).sort({ createdAt: -1 }).skip((query.page - 1) * query.pageSize).limit(query.pageSize).lean(),
    PredictionModel.countDocuments(filter),
  ]);
  res.json({ success: true, data: { items: items.map(serialize), page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  requireDatabase();
  const prediction = await PredictionModel.findOne({ _id: req.params.id, userId: req.user!._id }).lean();
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
