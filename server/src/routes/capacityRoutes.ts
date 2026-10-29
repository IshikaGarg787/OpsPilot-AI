import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { CapacityPlanModel } from '../models/CapacityPlan.js';
import { TicketModel } from '../models/Ticket.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
const planSchema = z.object({
  ticketId: z.string().regex(/^[a-f\d]{24}$/i),
  horizon: z.union([z.literal(7), z.literal(14)]),
  baselineCapacityPerDay: z.number().finite().min(0).max(100000),
  proposedCapacityPerDay: z.number().finite().min(0).max(100000),
  note: z.string().trim().min(3).max(2000),
});

function queueMetrics(forecast: Array<{ forecast: number }>, capacity: number) {
  let backlog = 0; let peakBacklog = 0; let overloadedDays = 0;
  for (const day of forecast) {
    if (day.forecast > capacity) overloadedDays += 1;
    backlog = Math.max(0, backlog + day.forecast - capacity);
    peakBacklog = Math.max(peakBacklog, backlog);
  }
  const averageDemand = forecast.length ? forecast.reduce((sum, day) => sum + day.forecast, 0) / forecast.length : 0;
  return { backlogAtHorizon: backlog, peakBacklog, overloadedDays, clearanceDays: backlog === 0 ? 0 : capacity > averageDemand ? backlog / (capacity - averageDemand) : null };
}

router.get('/', asyncHandler(async (_req, res) => {
  const plans = await CapacityPlanModel.find().sort({ createdAt: -1 }).limit(100).populate('createdBy', 'name').populate('sourceTicketId', 'ticketNumber subject').lean();
  res.json({ success: true, data: { plans: plans.map((plan: any) => {
    const forecast = (plan.forecast ?? []).map((day: any) => ({ forecast: Number(day.forecast) || 0 }));
    const baseline = queueMetrics(forecast, plan.baselineCapacityPerDay);
    const proposed = queueMetrics(forecast, plan.proposedCapacityPerDay);
    return {
      ...plan,
      baselinePeakBacklog: plan.baselinePeakBacklog ?? baseline.peakBacklog,
      proposedPeakBacklog: plan.proposedPeakBacklog ?? proposed.peakBacklog,
      baselineBacklogAtHorizon: plan.baselineBacklogAtHorizon ?? baseline.backlogAtHorizon,
      proposedBacklogAtHorizon: plan.proposedBacklogAtHorizon ?? proposed.backlogAtHorizon,
      baselineClearanceDays: plan.baselineClearanceDays ?? baseline.clearanceDays,
      proposedClearanceDays: plan.proposedClearanceDays ?? proposed.clearanceDays,
      baselineOverloadedDays: plan.baselineOverloadedDays ?? baseline.overloadedDays,
      proposedOverloadedDays: plan.proposedOverloadedDays ?? proposed.overloadedDays,
    };
  }) } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const input = planSchema.parse(req.body);
  const ticket = await TicketModel.findById(input.ticketId);
  if (!ticket?.workloadOutlook || !ticket.workloadOutlook.forecast?.length) throw new HttpError(409, 'Run the ticket decision flow before comparing capacity plans.', 'WORKLOAD_OUTLOOK_REQUIRED');
  if (ticket.workloadOutlook.horizon !== input.horizon || ticket.workloadOutlook.forecast.length !== input.horizon) throw new HttpError(409, 'The selected horizon does not match the saved forecast.', 'FORECAST_HORIZON_MISMATCH');
  const forecast = ticket.workloadOutlook.forecast.map((day: any) => ({ date: day.date, forecast: day.forecast }));
  const demand = forecast.reduce((sum: number, day: { forecast: number }) => sum + day.forecast, 0);
  const baselineCoverage = forecast.reduce((sum: number, day: { forecast: number }) => sum + Math.min(day.forecast, input.baselineCapacityPerDay), 0);
  const proposedCoverage = forecast.reduce((sum: number, day: { forecast: number }) => sum + Math.min(day.forecast, input.proposedCapacityPerDay), 0);
  const baselineMetrics = queueMetrics(forecast, input.baselineCapacityPerDay);
  const proposedMetrics = queueMetrics(forecast, input.proposedCapacityPerDay);
  const plan = await CapacityPlanModel.create({
    createdBy: req.user!._id, sourceTicketId: ticket._id, horizon: input.horizon,
    baselineCapacityPerDay: input.baselineCapacityPerDay, proposedCapacityPerDay: input.proposedCapacityPerDay,
    expectedDemand: demand, baselineCoverage, proposedCoverage,
    baselineUncovered: Math.max(0, demand - baselineCoverage), proposedUncovered: Math.max(0, demand - proposedCoverage),
    coverageImprovement: proposedCoverage - baselineCoverage, note: input.note, forecast,
    baselinePeakBacklog: baselineMetrics.peakBacklog, proposedPeakBacklog: proposedMetrics.peakBacklog,
    baselineBacklogAtHorizon: baselineMetrics.backlogAtHorizon, proposedBacklogAtHorizon: proposedMetrics.backlogAtHorizon,
    baselineClearanceDays: baselineMetrics.clearanceDays, proposedClearanceDays: proposedMetrics.clearanceDays,
    baselineOverloadedDays: baselineMetrics.overloadedDays, proposedOverloadedDays: proposedMetrics.overloadedDays,
  });
  ticket.audit.push({ actorId: req.user!._id, actorName: req.user!.name, actorRole: 'admin', action: 'capacity_plan_saved', details: `Compared ${input.baselineCapacityPerDay} vs ${input.proposedCapacityPerDay} tickets/day across ${input.horizon} days.` } as any);
  await ticket.save();
  res.status(201).json({ success: true, data: { plan }, message: 'Capacity scenario saved.' });
}));

export default router;
