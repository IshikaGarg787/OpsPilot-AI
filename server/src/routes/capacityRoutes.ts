import { Router } from 'express';
import { z } from 'zod';
import { requireAdminOwner, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { CapacityPlanModel } from '../models/CapacityPlan.js';
import { TicketModel } from '../models/Ticket.js';

const router = Router();
router.use(requireAuth, requireRole('admin'), requireAdminOwner);
const planSchema = z.object({
  ticketId: z.string().regex(/^[a-f\d]{24}$/i),
  horizon: z.union([z.literal(7), z.literal(14)]),
  baselineCapacityPerDay: z.number().finite().min(0).max(100000),
  proposedCapacityPerDay: z.number().finite().min(0).max(100000),
  note: z.string().trim().min(3).max(2000),
});

router.get('/', asyncHandler(async (_req, res) => {
  const plans = await CapacityPlanModel.find().sort({ createdAt: -1 }).limit(100).populate('createdBy', 'name').populate('sourceTicketId', 'ticketNumber subject').lean();
  res.json({ success: true, data: { plans } });
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
  const plan = await CapacityPlanModel.create({
    createdBy: req.user!._id, sourceTicketId: ticket._id, horizon: input.horizon,
    baselineCapacityPerDay: input.baselineCapacityPerDay, proposedCapacityPerDay: input.proposedCapacityPerDay,
    expectedDemand: demand, baselineCoverage, proposedCoverage,
    baselineUncovered: Math.max(0, demand - baselineCoverage), proposedUncovered: Math.max(0, demand - proposedCoverage),
    coverageImprovement: proposedCoverage - baselineCoverage, note: input.note, forecast,
  });
  ticket.audit.push({ actorId: req.user!._id, actorName: req.user!.name, actorRole: 'admin', action: 'capacity_plan_saved', details: `Compared ${input.baselineCapacityPerDay} vs ${input.proposedCapacityPerDay} tickets/day across ${input.horizon} days.` } as any);
  await ticket.save();
  res.status(201).json({ success: true, data: { plan }, message: 'Capacity scenario saved.' });
}));

export default router;
