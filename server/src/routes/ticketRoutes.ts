import crypto from 'node:crypto';
import path from 'node:path';
import { Router, raw } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { TicketModel } from '../models/Ticket.js';
import { TicketAttachmentModel } from '../models/TicketAttachment.js';
import { PredictionModel } from '../models/Prediction.js';
import { normalizedRole, UserModel } from '../models/User.js';
import { forecastWorkload, predictDelayRisk, predictResolution } from '../services/mlService.js';
import { customerTicketCreateSchema, customerTicketListQuerySchema, recommendationDecisionSchema, ticketAssignmentSchema, ticketCreateSchema, ticketResponseSchema, ticketStatusSchema } from '../validators/schemas.js';
import { z } from 'zod';
import { calculateTicketSlaForRecord } from '../services/slaPolicy.js';
import { recordFirstResponse, recordResolution, startTicketSla } from '../services/slaManagementService.js';
import { buildCustomerActivity, customerTicketFilter, CUSTOMER_ESTIMATE_PROJECT, CUSTOMER_TICKET_CATEGORY, CUSTOMER_TICKET_PROJECT, isCustomerTicketOwner, serializeCustomerTicket, summarizeCustomerTicketCounts } from '../services/customerTickets.js';
import { buildQueueWorkloadHistory } from '../services/queueWorkloadHistory.js';
import { assignAutomaticPriority } from '../services/automaticPriority.js';
import { recommendResolution } from '../services/resolutionRecommendationService.js';
import { rankAssignees, recommendAssignee } from '../services/recommendationEngine.js';

const router = Router();
router.use(requireAuth);

const riskSchema = z.object({
  risk_probability: z.number().finite().min(0).max(1),
  risk_category: z.enum(['low', 'medium', 'high']),
  flagged_for_review: z.boolean(),
  decision_threshold: z.number().finite().min(0).max(1),
  target_threshold_hours: z.number().finite().positive(),
  model_version: z.string(),
  explanation: z.object({ summary: z.string(), historical_evidence: z.array(z.object({ factor: z.string(), value: z.string(), historical_tickets: z.number().int().nonnegative(), historical_delay_rate: z.number().min(0).max(1) })), evidence_cutoff: z.string(), interpretation: z.string() }).optional(),
});
const resolutionSchema = z.object({ duration: z.number().finite().nonnegative(), unit: z.literal('hours'), model_version: z.string().optional(), artifact_generated_at: z.string().optional() });
const ticketWorkloadSchema = z.object({
  model_id: z.string(), history_start: z.string(), history_end: z.string(), history_days: z.number().int().positive(), ticket_total: z.number().nonnegative(), horizon: z.union([z.literal(7), z.literal(14)]),
  forecast: z.array(z.object({ date: z.string(), forecast: z.number().finite().nonnegative(), planning_low: z.number().finite().nonnegative(), planning_high: z.number().finite().nonnegative(), high_load_flag: z.boolean() })).min(7).max(14),
});
const allowedMimeTypes = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv']);
const maxAttachmentBytes = 3 * 1024 * 1024;
const maxTicketAttachmentBytes = 8 * 1024 * 1024;

function addAudit(ticket: any, req: any, action: string, details?: string) {
  ticket.audit.push({ actorId: req.user!._id, actorName: req.user!.name, actorRole: normalizedRole(req.user!), action, details });
}

export function assignedUserId(ticket: any): string | null {
  const assigned = ticket?.assignedTo;
  if (!assigned) return null;
  if (typeof assigned === 'string') return assigned;
  const identifier = assigned._id ?? assigned.id ?? assigned;
  const value = identifier?.toString?.();
  return value && value !== '[object Object]' ? value : null;
}

async function getAccessibleTicket(id: string, user: NonNullable<Express.Request['user']>) {
  const role = normalizedRole(user);
  const ticket = await TicketModel.findById(id).populate('assignedTo', 'name email role');
  if (!ticket) throw new HttpError(404, 'Ticket not found.', 'TICKET_NOT_FOUND');
  const owner = isCustomerTicketOwner(ticket.ownerUserId, user._id);
  const assigned = assignedUserId(ticket) === user._id.toString();
  if (role === 'admin' || owner || (role === 'it_team' && assigned)) return ticket;
  throw new HttpError(404, 'Ticket not found.', 'TICKET_NOT_FOUND');
}

async function serialize(ticket: any, role: string, includeDetails = true) {
  const attachments = includeDetails
    ? await TicketAttachmentModel.find({ ticketId: ticket._id }).select('-data').sort({ createdAt: 1 }).lean()
    : [];
  if (role === 'customer') return serializeCustomerTicket(ticket, attachments);
  return {
    id: ticket._id.toString(), ticketNumber: ticket.ticketNumber, ownerRole: ticket.ownerRole,
    owner: ticket.ownerUserId.toString(), subject: ticket.subject, description: ticket.description, inputLanguage: ticket.inputLanguage ?? 'auto',
    category: ticket.category, priority: ticket.priority, prioritySource: ticket.prioritySource ?? 'legacy', project: ticket.project, status: ticket.status,
    assignedTo: ticket.assignedTo && typeof ticket.assignedTo !== 'string' ? { id: ticket.assignedTo._id.toString(), name: ticket.assignedTo.name, email: ticket.assignedTo.email } : ticket.assignedTo,
    aiSignals: ticket.aiSignals, workloadOutlook: ticket.workloadOutlook, recommendation: ticket.recommendation,
    sla: calculateTicketSlaForRecord(ticket),
    estimatedResolutionAt: typeof ticket.aiSignals?.resolutionHours === 'number' ? new Date(new Date(ticket.createdAt).getTime() + ticket.aiSignals.resolutionHours * 60 * 60 * 1000) : null,
    delayExplanation: role === 'admin' ? ticket.delayExplanation : undefined,
    responses: ticket.responses.filter((reply: any) => role !== 'customer' || reply.visibility === 'public'),
    audit: role === 'admin' ? ticket.audit : undefined,
    attachments: attachments.map((item: any) => ({ id: String(item._id), fileName: item.fileName, mimeType: item.mimeType, size: item.size, createdAt: item.createdAt })),
    createdAt: ticket.createdAt, updatedAt: ticket.updatedAt,
  };
}

router.get('/assignees', requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await UserModel.find({ role: 'it_team', setupPending: { $ne: true } }).sort({ name: 1 }).select('name email skills').lean();
  const ticketId = typeof _req.query.ticketId === 'string' ? _req.query.ticketId : '';
  let issueType = '';
  let project = '';
  if (ticketId) {
    if (!/^[a-f\d]{24}$/i.test(ticketId)) throw new HttpError(400, 'Choose a valid ticket.', 'INVALID_TICKET_ID');
    const ticket: any = await TicketModel.findById(ticketId).select('category project subject description ownerRole').lean();
    if (!ticket) throw new HttpError(404, 'Ticket not found.', 'TICKET_NOT_FOUND');
    if (ticket.ownerRole !== 'customer') throw new HttpError(400, 'Assignment recommendations are for customer raised tickets.', 'NOT_CUSTOMER_TICKET');
    issueType = `${ticket.category} ${ticket.subject} ${ticket.description}`;
    project = ticket.project;
  }
  const metrics = users.length ? await TicketModel.aggregate([
    { $match: { assignedTo: { $in: users.map((user: any) => user._id) } } },
    { $group: {
      _id: '$assignedTo',
      unresolvedTickets: { $sum: { $cond: [{ $in: ['$status', ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer']] }, 1, 0] } },
      slaBreaches: { $sum: { $add: [
        { $cond: [{ $eq: ['$slaSnapshot.firstResponseStatus', 'breached'] }, 1, 0] },
        { $cond: [{ $eq: ['$slaSnapshot.resolutionStatus', 'breached'] }, 1, 0] },
      ] } },
    } },
  ]) : [];
  const byMember = new Map(metrics.map((metric: any) => [String(metric._id), metric]));
  const candidates = users.map((user: any) => {
    const metric: any = byMember.get(String(user._id)) ?? {};
    return { id: String(user._id), name: user.name, email: user.email, skills: user.skills ?? [], activeTickets: metric.unresolvedTickets ?? 0, slaBreaches: metric.slaBreaches ?? 0 };
  });
  const ranked = rankAssignees(candidates, issueType, project);
  res.json({ success: true, data: { users: ranked.map((member, index) => ({
    ...member,
    email: candidates.find((candidate) => candidate.id === member.id)?.email ?? '',
    rank: index + 1,
    recommended: index === 0,
  })) } });
}));

router.post('/', requireRole('customer', 'it_team'), asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const customer = role === 'customer';
  const input = customer
    ? { ...customerTicketCreateSchema.parse(req.body), project: CUSTOMER_TICKET_PROJECT }
    : ticketCreateSchema.parse(req.body);
  const category = customer ? CUSTOMER_TICKET_CATEGORY : input.category;
  // Existing risk and resolution models require a priority feature. Use a neutral
  // internal baseline, then assign the ticket's actual priority from model results.
  const modelPriority = 'Medium';
  const project = input.project;
  const createdAt = new Date();
  const modelInput = { issue_created: createdAt.toISOString(), issue_priority: modelPriority, issue_type: category, issue_proj: customer ? CUSTOMER_ESTIMATE_PROJECT : project };
  const signals: Record<string, unknown> = { checkedAt: new Date() };
  const unavailable: string[] = [];
  const workloadNotes: string[] = [];
  let workloadHistoryDays = 0;
  let workloadInput: Array<{ date: string; ticket_count: number }> = [];
  try {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const historyStart = new Date(todayUtc.getTime() - 119 * 86400000);
    const [firstTicket, daily] = await Promise.all([
      TicketModel.findOne().sort({ createdAt: 1 }).select('createdAt'),
      TicketModel.aggregate([
        { $match: { createdAt: { $gte: historyStart, $lt: new Date(todayUtc.getTime() + 86400000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, ticket_count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    const history = buildQueueWorkloadHistory(daily, firstTicket?.createdAt ?? null, now);
    workloadHistoryDays = history.actualDays;
    if (history.actualDays >= 60) workloadInput = history.records.map(({ date, ticket_count }) => ({ date, ticket_count }));
    else workloadNotes.push('workload forecast skipped: fewer than 60 real ticket-history days');
  } catch {
    workloadNotes.push('workload history could not be loaded');
  }

  const [riskResult, resolutionResult, workloadResult] = await Promise.allSettled([
    predictDelayRisk({ ...modelInput, issue_reporter: 'new-intake' }).then((result) => riskSchema.parse(result)),
    predictResolution(modelInput).then((result) => resolutionSchema.parse(result)),
    workloadInput.length ? forecastWorkload(workloadInput, 7, 45_000).then((result) => ticketWorkloadSchema.parse(result)) : Promise.resolve(null),
  ]);

  const risk = riskResult.status === 'fulfilled' ? riskResult.value : null;
  if (risk) {
    signals.delayRiskProbability = risk.risk_probability;
    signals.delayRiskCategory = risk.risk_category;
    signals.flaggedForReview = risk.flagged_for_review;
    signals.reviewThreshold = risk.decision_threshold;
    signals.targetThresholdHours = risk.target_threshold_hours;
    signals.riskModelVersion = risk.model_version;
    if (risk.explanation) signals.riskExplanation = {
      summary: risk.explanation.summary,
      historicalEvidence: risk.explanation.historical_evidence.map((item) => ({ factor: item.factor, value: item.value, historicalTickets: item.historical_tickets, historicalDelayRate: item.historical_delay_rate })),
      evidenceCutoff: risk.explanation.evidence_cutoff,
      interpretation: risk.explanation.interpretation,
    };
  } else unavailable.push('delay risk');

  const estimate = resolutionResult.status === 'fulfilled' ? resolutionResult.value : null;
  if (estimate) {
    signals.resolutionHours = estimate.duration;
    signals.resolutionModelVersion = estimate.model_version;
  } else unavailable.push('resolution time');

  const workload = workloadResult.status === 'fulfilled' ? workloadResult.value : null;
  if (workload) {
    const highLoadDays = workload.forecast.filter((day) => day.high_load_flag).length;
    signals.workloadModelVersion = workload.model_id;
    signals.workloadHighLoadDays = highLoadDays;
    signals.workloadHorizon = workload.horizon;
    signals.workloadActualHistoryDays = workloadHistoryDays;
  } else if (workloadInput.length) unavailable.push('workload forecast');

  const automaticPriority = assignAutomaticPriority({
    ...(risk ? { riskProbability: risk.risk_probability, riskThreshold: risk.decision_threshold, riskCategory: risk.risk_category } : {}),
    ...(estimate ? { resolutionHours: estimate.duration } : {}),
    ...(workloadInput.length ? {} : { workloadHistoryDays }),
    ...(workload ? { workload: { highLoadDays: workload.forecast.filter((day) => day.high_load_flag).length, horizon: workload.horizon, actualHistoryDays: workloadHistoryDays } } : {}),
  });
  const priority = automaticPriority.priority;
  signals.recommendedPriority = priority;
  signals.autoPriorityScore = automaticPriority.score;
  signals.autoPriorityRationale = automaticPriority.rationale;
  if (unavailable.length || workloadNotes.length) signals.unavailableReason = [...unavailable, ...workloadNotes].join('; ').slice(0, 200);
  let autoAssignee: { id: string; name: string; activeTickets: number; matchingSkills: string[] } | null = null;
  let autoAssigneeModel: any = null;
  try {
    const team = await UserModel.find({ role: 'it_team', setupPending: { $ne: true } }).select('name skills').sort({ name: 1 }).lean();
    const loads = team.length ? await TicketModel.aggregate([
      { $match: { assignedTo: { $in: team.map((member: any) => member._id) }, status: { $in: ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer'] } } },
      { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
    ]) : [];
    const active = new Map(loads.map((row: any) => [String(row._id), row.count as number]));
    const candidates = team.map((member: any) => ({ id: String(member._id), name: member.name, skills: member.skills ?? [], activeTickets: active.get(String(member._id)) ?? 0 }));
    autoAssignee = recommendAssignee(candidates, category, project);
    if (autoAssignee) autoAssigneeModel = team.find((member: any) => String(member._id) === autoAssignee!.id) ?? null;
    if (autoAssignee) signals.recommendedAssignee = autoAssignee;
  } catch {
    // Keep intake available if team-load lookup fails; Admin can use the fallback suggestion control.
  }
  const review = signals.flaggedForReview === true;
  const ticketNumber = `OP-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const ticket = new TicketModel({
    ticketNumber, ownerUserId: req.user!._id, ownerRole: role,
    subject: input.subject, description: input.description, inputLanguage: input.inputLanguage, category, priority, prioritySource: 'auto', project,
    status: autoAssigneeModel ? 'assigned' : 'open', aiSignals: signals,
    ...(autoAssigneeModel ? { assignedTo: autoAssigneeModel._id } : {}),
    ...(workload ? { workloadOutlook: {
      historyStart: workload.history_start, historyEnd: workload.history_end, historyDays: workload.history_days,
      actualHistoryDays: workloadHistoryDays,
      horizon: workload.horizon, expectedTickets: workload.forecast.reduce((sum, day) => sum + day.forecast, 0),
      highLoadDays: workload.forecast.filter((day) => day.high_load_flag).length, modelVersion: workload.model_id,
      forecast: workload.forecast.map((day) => ({ date: day.date, forecast: day.forecast, planningLow: day.planning_low, planningHigh: day.planning_high, highLoad: day.high_load_flag })),
      generatedAt: new Date(),
    } } : {}),
    ...(typeof signals.flaggedForReview === 'boolean' ? { recommendation: {
      action: review ? 'priority_review' : 'standard_queue', state: 'pending',
      rationale: review
        ? `Model score ${(Number(signals.delayRiskProbability) * 100).toFixed(1)}% crossed the ${(Number(signals.reviewThreshold) * 100).toFixed(1)}% review threshold. Review early; the score predicts a historical 30-day delay outcome, not an official SLA breach.`
        : `Model score ${(Number(signals.delayRiskProbability) * 100).toFixed(1)}% is below the ${(Number(signals.reviewThreshold) * 100).toFixed(1)}% review threshold. Continue normal monitoring; this does not guarantee an SLA will be met.`,
    } } : {}),
  });
  addAudit(ticket, req, 'ticket_created', `${role} submitted a ticket`);
  addAudit(ticket, req, 'priority_auto_assigned', `${priority}: ${automaticPriority.rationale}`);
  if (autoAssigneeModel && autoAssignee) addAudit(ticket, req, 'ticket_assigned', `automatic: unassigned → ${autoAssignee.name}`);
  await ticket.save();
  const predictionInput = { issueCreated: createdAt, priority: modelPriority, issueType: category, project, complaint: input.description, ticketId: ticket._id };
  const historyRuns = [
    PredictionModel.create({ userId: req.user!._id, modelId: 'operational-risk', modelVersion: signals.riskModelVersion, predictionType: 'delay_risk_classification', input: predictionInput, output: typeof signals.delayRiskProbability === 'number' ? { delayRisk: { probability: signals.delayRiskProbability, category: signals.delayRiskCategory, flaggedForReview: signals.flaggedForReview, decisionThreshold: signals.reviewThreshold, targetThresholdHours: signals.targetThresholdHours, modelVersion: signals.riskModelVersion, ...(signals.riskExplanation ? { explanation: signals.riskExplanation } : {}) } } : undefined, status: typeof signals.delayRiskProbability === 'number' ? 'success' : 'failed', ...(typeof signals.delayRiskProbability === 'number' ? {} : { errorCode: 'MODEL_UNAVAILABLE' }) }),
    PredictionModel.create({ userId: req.user!._id, modelId: 'resolution-time', modelVersion: signals.resolutionModelVersion, predictionType: 'point_estimate', input: predictionInput, output: typeof signals.resolutionHours === 'number' ? { duration: signals.resolutionHours, unit: 'hours' } : undefined, status: typeof signals.resolutionHours === 'number' ? 'success' : 'failed', ...(typeof signals.resolutionHours === 'number' ? {} : { errorCode: 'MODEL_UNAVAILABLE' }) }),
    ...(workload ? [PredictionModel.create({
      userId: req.user!._id, modelId: 'workload-forecasting', modelVersion: workload.model_id, predictionType: 'workload_forecast',
      input: { ...predictionInput, issueType: 'Automatic ticket priority' },
      output: { workload: {
        historyStart: workload.history_start, historyEnd: workload.history_end, historyDays: workload.history_days,
        horizon: workload.horizon, ticketTotal: workload.ticket_total,
        expectedTickets: workload.forecast.reduce((sum, day) => sum + day.forecast, 0),
        highLoadDays: signals.workloadHighLoadDays, modelVersion: workload.model_id, source: 'queue_history',
        forecast: workload.forecast.map((day) => ({ date: day.date, forecast: day.forecast, planningLow: day.planning_low, planningHigh: day.planning_high, highLoad: day.high_load_flag })),
      } },
      status: 'success',
    })] : []),
  ];
  await Promise.allSettled(historyRuns);
  await startTicketSla(ticket);
  const scoringSummary = workload
    ? 'delay-risk, resolution-time, and workload models'
    : `available ticket models${workloadNotes.length ? '; workload forecast skipped because reliable history was unavailable' : ''}`;
  res.status(201).json({ success: true, data: { ticket: await serialize(ticket, role) }, message: `Ticket submitted with automatic ${priority} priority from ${scoringSummary}.` });
}));

router.get('/customer/dashboard', requireRole('customer'), asyncHandler(async (req, res) => {
  const filter = customerTicketFilter(req.user!._id);
  const [groups, recentTickets] = await Promise.all([
    TicketModel.aggregate<{ _id: string; count: number }>([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    TicketModel.find(filter).select('ticketNumber subject status createdAt updatedAt audit responses')
      .sort({ updatedAt: -1 }).limit(100).lean(),
  ]);
  res.json({
    success: true,
    data: { counts: summarizeCustomerTicketCounts(groups), activity: buildCustomerActivity(recentTickets) },
  });
}));

router.get('/customer', requireRole('customer'), asyncHandler(async (req, res) => {
  const query = customerTicketListQuerySchema.parse(req.query);
  const filter = customerTicketFilter(req.user!._id, query);
  const skip = (query.page - 1) * query.pageSize;
  const [total, tickets] = await Promise.all([
    TicketModel.countDocuments(filter),
    TicketModel.find(filter).populate('assignedTo', 'name').sort({ updatedAt: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  res.json({
    success: true,
    data: {
      tickets: await Promise.all(tickets.map((ticket) => serialize(ticket, 'customer', false))),
      page: query.page,
      pageSize: query.pageSize,
      total,
      pages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const filter = role === 'admin' ? {} : role === 'it_team' ? { $or: [{ ownerUserId: req.user!._id }, { assignedTo: req.user!._id }] } : { ownerUserId: req.user!._id };
  const tickets = await TicketModel.find(filter).populate('assignedTo', 'name email role').sort({ updatedAt: -1 }).limit(200).lean();
  res.json({ success: true, data: { tickets: await Promise.all(tickets.map((ticket) => serialize(ticket, role))) } });
}));

router.get('/:ticketId', asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  let shouldSave = false;
  if (role === 'admin') {
    if (ticket.status === 'open') {
      const previous = ticket.status;
      ticket.status = 'triaged';
      shouldSave = true;
      addAudit(ticket, req, 'status_changed', `${previous} → ${ticket.status}`);
    }
  }
  if ((role === 'admin' || role === 'it_team') && !ticket.audit.some((entry: any) => entry.action === 'ticket_viewed')) {
    addAudit(ticket, req, 'ticket_viewed', 'Support opened the ticket');
    shouldSave = true;
  }
  if (shouldSave) await ticket.save();
  res.json({ success: true, data: { ticket: await serialize(ticket, role) } });
}));

router.post('/:ticketId/resolution-recommendation', requireRole('it_team'), asyncHandler(async (req, res) => {
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  if (assignedUserId(ticket) !== req.user!._id.toString()) {
    throw new HttpError(403, 'Resolution guidance is available to the IT teammate assigned to this ticket.', 'TICKET_NOT_ASSIGNED');
  }
  if (['resolved', 'closed'].includes(ticket.status)) {
    throw new HttpError(409, 'This ticket is already complete. Review its saved resolution notes instead.', 'TICKET_ALREADY_COMPLETE');
  }
  const recommendation = await recommendResolution({
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    description: ticket.description,
    category: ticket.category,
    project: ticket.project,
  });
  res.json({ success: true, data: { recommendation }, message: 'Ticket-specific resolution guidance prepared.' });
}));

router.post('/:ticketId/responses', asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = ticketResponseSchema.parse(req.body);
  const assigned = assignedUserId(ticket) === req.user!._id.toString();
  const adminManagedInternalIssue = ticket.ownerRole === 'it_team';
  if (role === 'it_team' && (!assigned || adminManagedInternalIssue)) throw new HttpError(403, adminManagedInternalIssue ? 'Internal IT requests are handled by an admin.' : 'IT updates are allowed only on assigned tickets.', adminManagedInternalIssue ? 'INTERNAL_ISSUE_ADMIN_HANDLED' : 'TICKET_NOT_ASSIGNED');
  const visibility = role === 'customer' ? 'public' : input.visibility;
  if (input.workflowAction && role === 'customer') throw new HttpError(403, 'Only support staff can change ticket workflow.', 'ROLE_FORBIDDEN');
  if (input.workflowAction && visibility !== 'public') throw new HttpError(400, 'Workflow actions need a customer-visible update.', 'WORKFLOW_UPDATE_MUST_BE_PUBLIC');
  if (input.workflowAction === 'resolve' && !input.resolutionNote?.trim()) throw new HttpError(400, 'Add a resolution note before resolving this ticket.', 'RESOLUTION_NOTE_REQUIRED');
  const previous = ticket.status;
  const now = new Date();
  const resolving = input.workflowAction === 'resolve';
  const estimateAt = typeof ticket.aiSignals?.resolutionHours === 'number' ? ticket.createdAt.getTime() + ticket.aiSignals.resolutionHours * 60 * 60 * 1000 : null;
  const isLate = resolving && estimateAt !== null && now.getTime() > estimateAt;
  if (isLate && !input.delayExplanation?.trim()) throw new HttpError(400, 'This ticket is past its estimated resolution time. Add an explanation before resolving it.', 'DELAY_EXPLANATION_REQUIRED');
  ticket.responses.push({ authorId: req.user!._id, authorName: req.user!.name, authorRole: role, visibility, message: input.message, ...(role !== 'customer' && input.resolutionNote ? { resolutionNote: input.resolutionNote } : {}) } as any);
  addAudit(ticket, req, 'response_added', visibility === 'internal' ? 'Internal note added' : 'Public response added');
  if (role === 'customer' && previous === 'waiting_customer') {
    ticket.status = assignedUserId(ticket) ? 'in_progress' : 'open';
    addAudit(ticket, req, 'status_changed', `${previous} → ${ticket.status}`);
  } else if (role !== 'customer') {
    const nextStatus = resolving ? 'resolved'
      : input.workflowAction === 'waiting_customer' ? 'waiting_customer'
      : previous === 'waiting_customer' || ['open', 'triaged', 'assigned'].includes(previous) ? 'in_progress'
      : previous;
    if (input.delayExplanation?.trim()) ticket.delayExplanation = input.delayExplanation.trim();
    if (nextStatus !== previous) {
      ticket.status = nextStatus;
      if (nextStatus === 'resolved') ticket.resolutionCompletedAt = now;
      else if (['resolved', 'closed'].includes(previous)) ticket.resolutionReopenedAt = now;
      addAudit(ticket, req, 'status_changed', `${previous} → ${nextStatus}`);
    }
  }
  await ticket.save();
  if (role !== 'customer' && visibility === 'public') await recordFirstResponse(ticket);
  if (role !== 'customer' && resolving && previous !== 'resolved' && previous !== 'closed') await recordResolution(ticket, true, now);
  else if (role !== 'customer' && ['resolved', 'closed'].includes(previous) && ticket.status !== previous) await recordResolution(ticket, false, now);
  res.status(201).json({ success: true, data: { ticket: await serialize(ticket, role) }, message: 'Ticket update added.' });
}));

router.patch('/:ticketId/status', asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = ticketStatusSchema.parse(req.body);
  const assigned = assignedUserId(ticket) === req.user!._id.toString();
  const adminManagedInternalIssue = ticket.ownerRole === 'it_team';
  if (role !== 'admin' && !(role === 'it_team' && assigned && !adminManagedInternalIssue)) throw new HttpError(403, adminManagedInternalIssue ? 'Internal IT requests are handled by an admin.' : 'Only an admin or the assigned IT teammate can update ticket status.', adminManagedInternalIssue ? 'INTERNAL_ISSUE_ADMIN_HANDLED' : 'TICKET_NOT_ASSIGNED');
  const previous = ticket.status;
  const estimateAt = typeof ticket.aiSignals?.resolutionHours === 'number' ? ticket.createdAt.getTime() + ticket.aiSignals.resolutionHours * 60 * 60 * 1000 : null;
  const isLate = ['resolved', 'closed'].includes(input.status) && estimateAt !== null && Date.now() > estimateAt;
  if (isLate && !input.delayExplanation?.trim()) throw new HttpError(400, 'This ticket is past its estimated resolution time. Add an explanation before resolving it.', 'DELAY_EXPLANATION_REQUIRED');
  if (input.delayExplanation) ticket.delayExplanation = input.delayExplanation.trim();
  ticket.status = input.status;
  const now = new Date();
  if (role === 'it_team' && input.status === 'in_progress' && previous !== 'in_progress') addAudit(ticket, req, 'work_started', 'IT teammate started work on the ticket.');
  if (input.status === 'resolved' || input.status === 'closed') ticket.resolutionCompletedAt = now;
  else if (previous === 'resolved' || previous === 'closed') ticket.resolutionReopenedAt = now;
  if (input.resolutionNote) ticket.responses.push({ authorId: req.user!._id, authorName: req.user!.name, authorRole: role, visibility: 'public', message: `Status updated to ${input.status.replaceAll('_', ' ')}.`, resolutionNote: input.resolutionNote } as any);
  addAudit(ticket, req, 'status_changed', `${previous} → ${input.status}`);
  await ticket.save();
  if ((input.status === 'resolved' || input.status === 'closed') && previous !== 'resolved' && previous !== 'closed') await recordResolution(ticket, true, now);
  else if (previous === 'resolved' || previous === 'closed') await recordResolution(ticket, false, now);
  res.json({ success: true, data: { ticket: await serialize(ticket, role) }, message: 'Ticket status updated.' });
}));

router.patch('/:ticketId/assignment', requireRole('admin'), asyncHandler(async (req, res) => {
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  if (ticket.ownerRole === 'it_team') throw new HttpError(409, 'Internal IT requests are handled by an admin and cannot be assigned to an IT teammate.', 'INTERNAL_ISSUE_ADMIN_HANDLED');
  const input = ticketAssignmentSchema.parse(req.body);
  const assignee = await UserModel.findOne({ _id: input.assigneeId, role: 'it_team', setupPending: { $ne: true } });
  if (!assignee) throw new HttpError(400, 'Choose an active IT Team account.', 'INVALID_ASSIGNEE');
  const previous = assignedUserId(ticket) ?? 'unassigned';
  ticket.assignedTo = assignee._id;
  if (ticket.status === 'open' || ticket.status === 'triaged') ticket.status = 'assigned';
  addAudit(ticket, req, 'ticket_assigned', `${previous} → ${assignee.name}`);
  await ticket.save();
  res.json({ success: true, data: { ticket: await serialize(ticket, 'admin') }, message: 'Ticket assigned.' });
}));

router.post('/:ticketId/recommendation-decision', requireRole('admin'), asyncHandler(async (req, res) => {
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = recommendationDecisionSchema.parse(req.body);
  if (!ticket.recommendation?.action) throw new HttpError(409, 'There is no model recommendation to review.', 'RECOMMENDATION_UNAVAILABLE');
  const previous = ticket.recommendation.action;
  ticket.recommendation.state = input.decision;
  ticket.recommendation.action = input.action ?? previous;
  ticket.recommendation.decidedBy = req.user!._id;
  ticket.recommendation.decisionNote = input.note;
  ticket.recommendation.decidedAt = new Date();
  addAudit(ticket, req, `recommendation_${input.decision}`, `${previous} → ${ticket.recommendation.action}: ${input.note}`);
  await ticket.save();
  res.json({ success: true, data: { ticket: await serialize(ticket, 'admin') }, message: 'Recommendation decision recorded.' });
}));

router.post('/:ticketId/attachments', raw({ type: (req) => allowedMimeTypes.has(req.headers['content-type']?.split(';')[0] ?? ''), limit: maxAttachmentBytes }), asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  if (!(role === 'admin' || ticket.ownerUserId.toString() === req.user!._id.toString())) throw new HttpError(403, 'Only the ticket owner or an admin can attach files.', 'ATTACHMENT_FORBIDDEN');
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, 'Choose a non-empty attachment.', 'EMPTY_ATTACHMENT');
  if (!allowedMimeTypes.has(req.headers['content-type']?.split(';')[0] ?? '')) throw new HttpError(415, 'Use PDF, PNG, JPEG, plain text, or CSV attachments.', 'UNSUPPORTED_ATTACHMENT');
  const current = await TicketAttachmentModel.aggregate([{ $match: { ticketId: ticket._id } }, { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }]);
  if ((current[0]?.count ?? 0) >= 5 || (current[0]?.bytes ?? 0) + req.body.length > maxTicketAttachmentBytes) throw new HttpError(413, 'A ticket can hold up to five files and 8 MB total.', 'ATTACHMENT_LIMIT');
  const rawName = String(req.headers['x-file-name'] ?? 'attachment').replace(/[\r\n]/g, '');
  let fileName = path.basename(rawName);
  try { fileName = decodeURIComponent(fileName); } catch { /* retain the safe encoded name */ }
  fileName = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 180) || 'attachment';
  const attachment = await TicketAttachmentModel.create({ ticketId: ticket._id, uploadedBy: req.user!._id, fileName, mimeType: req.headers['content-type']?.split(';')[0], size: req.body.length, data: req.body });
  addAudit(ticket, req, 'attachment_added', fileName);
  await ticket.save();
  res.status(201).json({ success: true, data: { attachment: { id: attachment._id.toString(), fileName, mimeType: attachment.mimeType, size: attachment.size } }, message: 'Attachment uploaded.' });
}));

router.get('/:ticketId/attachments/:attachmentId', asyncHandler(async (req, res) => {
  await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const attachment = await TicketAttachmentModel.findOne({ _id: String(req.params.attachmentId), ticketId: String(req.params.ticketId) }).select('+data');
  if (!attachment) throw new HttpError(404, 'Attachment not found.', 'ATTACHMENT_NOT_FOUND');
  res.setHeader('content-type', attachment.mimeType);
  res.setHeader('content-length', attachment.size);
  res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`);
  res.setHeader('x-content-type-options', 'nosniff');
  res.send(attachment.data);
}));

export default router;
