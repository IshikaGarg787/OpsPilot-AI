import crypto from 'node:crypto';
import path from 'node:path';
import { Router, raw } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { TicketModel } from '../models/Ticket.js';
import { TicketAttachmentModel } from '../models/TicketAttachment.js';
import { normalizedRole, UserModel } from '../models/User.js';
import { predictDelayRisk, predictResolution } from '../services/mlService.js';
import { customerTicketCreateSchema, customerTicketListQuerySchema, recommendationDecisionSchema, ticketAssignmentSchema, ticketCreateSchema, ticketResponseSchema, ticketStatusSchema } from '../validators/schemas.js';
import { z } from 'zod';
import { calculateTicketSlaForRecord } from '../services/slaPolicy.js';
import { buildCustomerActivity, customerTicketFilter, CUSTOMER_ESTIMATE_PROJECT, CUSTOMER_TICKET_CATEGORY, CUSTOMER_TICKET_PRIORITY, CUSTOMER_TICKET_PROJECT, isCustomerTicketOwner, serializeCustomerTicket, summarizeCustomerTicketCounts } from '../services/customerTickets.js';

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
    owner: ticket.ownerUserId.toString(), subject: ticket.subject, description: ticket.description,
    category: ticket.category, priority: ticket.priority, project: ticket.project, status: ticket.status,
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
  const users = await UserModel.find({ role: 'it_team' }).sort({ name: 1 }).select('name email skills availability').lean();
  const counts = await TicketModel.aggregate([{ $match: { assignedTo: { $in: users.map((user: any) => user._id) }, status: { $in: ['assigned', 'in_progress'] } } }, { $group: { _id: '$assignedTo', count: { $sum: 1 } } }]);
  const active = new Map(counts.map((row: any) => [String(row._id), row.count]));
  res.json({ success: true, data: { users: users.map((user: any) => ({ id: String(user._id), name: user.name, email: user.email, skills: user.skills ?? [], activeTickets: active.get(String(user._id)) ?? 0, availability: (user.availability === 'unavailable' ? 'unavailable' : (active.get(String(user._id)) ?? 0) > 0 ? 'busy' : 'available') })) } });
}));

router.post('/', requireRole('customer', 'it_team'), asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const customer = role === 'customer';
  const input = customer
    ? { ...customerTicketCreateSchema.parse(req.body), priority: CUSTOMER_TICKET_PRIORITY, project: CUSTOMER_TICKET_PROJECT }
    : ticketCreateSchema.parse(req.body);
  const category = customer ? CUSTOMER_TICKET_CATEGORY : input.category;
  const priority = input.priority;
  const project = input.project;
  const createdAt = new Date();
  const modelInput = { issue_created: createdAt.toISOString(), issue_priority: priority, issue_type: category, issue_proj: customer ? CUSTOMER_ESTIMATE_PROJECT : project };
  const signals: Record<string, unknown> = { checkedAt: new Date() };
  const unavailable: string[] = [];
  try {
    const risk = riskSchema.parse(await predictDelayRisk({ ...modelInput, issue_reporter: 'new-intake' }));
    signals.delayRiskProbability = risk.risk_probability;
    signals.delayRiskCategory = risk.risk_category;
    signals.flaggedForReview = risk.flagged_for_review;
    signals.reviewThreshold = risk.decision_threshold;
    signals.targetThresholdHours = risk.target_threshold_hours;
    signals.riskModelVersion = risk.model_version;
    if (risk.explanation) signals.riskExplanation = risk.explanation;
  } catch {
    unavailable.push('delay risk');
  }
  try {
    const estimate = resolutionSchema.parse(await predictResolution(modelInput));
    signals.resolutionHours = estimate.duration;
    signals.resolutionModelVersion = estimate.model_version;
  } catch {
    unavailable.push('resolution time');
  }
  if (unavailable.length) signals.unavailableReason = `${unavailable.join(' and ')} signal unavailable`;
  const review = signals.flaggedForReview === true;
  const ticketNumber = `OP-${Date.now().toString().slice(-8)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const ticket = new TicketModel({
    ticketNumber, ownerUserId: req.user!._id, ownerRole: role,
    subject: input.subject, description: input.description, category, priority, project,
    status: 'open', aiSignals: signals,
    ...(typeof signals.flaggedForReview === 'boolean' ? { recommendation: {
      action: review ? 'priority_review' : 'standard_queue', state: 'pending',
      rationale: review
        ? `Model score ${(Number(signals.delayRiskProbability) * 100).toFixed(1)}% crossed the ${(Number(signals.reviewThreshold) * 100).toFixed(1)}% review threshold. Review early; the score predicts a historical 30-day delay outcome, not an official SLA breach.`
        : `Model score ${(Number(signals.delayRiskProbability) * 100).toFixed(1)}% is below the ${(Number(signals.reviewThreshold) * 100).toFixed(1)}% review threshold. Continue normal monitoring; this does not guarantee an SLA will be met.`,
    } } : {}),
  });
  addAudit(ticket, req, 'ticket_created', `${role} submitted a ticket`);
  await ticket.save();
  res.status(201).json({ success: true, data: { ticket: await serialize(ticket, role) }, message: unavailable.length ? 'Ticket submitted; one or more model signals are currently unavailable.' : 'Ticket submitted and scored by the available models.' });
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
  res.json({ success: true, data: { ticket: await serialize(ticket, role) } });
}));

router.post('/:ticketId/responses', asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = ticketResponseSchema.parse(req.body);
  const assigned = assignedUserId(ticket) === req.user!._id.toString();
  if (role === 'it_team' && !assigned) throw new HttpError(403, 'IT updates are allowed only on assigned tickets.', 'TICKET_NOT_ASSIGNED');
  const visibility = role === 'customer' ? 'public' : input.visibility;
  ticket.responses.push({ authorId: req.user!._id, authorName: req.user!.name, authorRole: role, visibility, message: input.message, ...(role !== 'customer' && input.resolutionNote ? { resolutionNote: input.resolutionNote } : {}) } as any);
  addAudit(ticket, req, 'response_added', visibility === 'internal' ? 'Internal note added' : 'Public response added');
  await ticket.save();
  res.status(201).json({ success: true, data: { ticket: await serialize(ticket, role) }, message: 'Ticket update added.' });
}));

router.patch('/:ticketId/status', asyncHandler(async (req, res) => {
  const role = normalizedRole(req.user!);
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = ticketStatusSchema.parse(req.body);
  const assigned = assignedUserId(ticket) === req.user!._id.toString();
  if (role !== 'admin' && !(role === 'it_team' && assigned)) throw new HttpError(403, 'Only an admin or the assigned IT teammate can update ticket status.', 'TICKET_NOT_ASSIGNED');
  const previous = ticket.status;
  const estimateAt = typeof ticket.aiSignals?.resolutionHours === 'number' ? ticket.createdAt.getTime() + ticket.aiSignals.resolutionHours * 60 * 60 * 1000 : null;
  const isLate = ['resolved', 'closed'].includes(input.status) && estimateAt !== null && Date.now() > estimateAt;
  if (isLate && !input.delayExplanation?.trim()) throw new HttpError(400, 'This ticket is past its estimated resolution time. Add an explanation before resolving it.', 'DELAY_EXPLANATION_REQUIRED');
  if (input.delayExplanation) ticket.delayExplanation = input.delayExplanation.trim();
  ticket.status = input.status;
  const now = new Date();
  if (input.status === 'resolved' || input.status === 'closed') ticket.resolutionCompletedAt = now;
  else if (previous === 'resolved' || previous === 'closed') ticket.resolutionReopenedAt = now;
  if (input.resolutionNote) ticket.responses.push({ authorId: req.user!._id, authorName: req.user!.name, authorRole: role, visibility: 'public', message: `Status updated to ${input.status.replaceAll('_', ' ')}.`, resolutionNote: input.resolutionNote } as any);
  addAudit(ticket, req, 'status_changed', `${previous} → ${input.status}`);
  await ticket.save();
  res.json({ success: true, data: { ticket: await serialize(ticket, role) }, message: 'Ticket status updated.' });
}));

router.patch('/:ticketId/assignment', requireRole('admin'), asyncHandler(async (req, res) => {
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = ticketAssignmentSchema.parse(req.body);
  const assignee = await UserModel.findOne({ _id: input.assigneeId, role: 'it_team' });
  if (!assignee) throw new HttpError(400, 'Choose an active IT Team account.', 'INVALID_ASSIGNEE');
  const previous = assignedUserId(ticket) ?? 'unassigned';
  if (assignee.availability === 'unavailable' && previous !== assignee._id.toString()) throw new HttpError(409, 'This teammate is unavailable. Choose someone available.', 'ASSIGNEE_UNAVAILABLE');
  const occupied = await TicketModel.exists({ assignedTo: assignee._id, status: { $in: ['assigned', 'in_progress'] }, _id: { $ne: ticket._id } });
  if (occupied && previous !== assignee._id.toString()) throw new HttpError(409, 'This teammate is already occupied with another ticket.', 'ASSIGNEE_OCCUPIED');
  ticket.assignedTo = assignee._id;
  if (ticket.status === 'open' || ticket.status === 'triaged') ticket.status = 'assigned';
  addAudit(ticket, req, 'ticket_assigned', `${previous} → ${assignee.name}`);
  await ticket.save();
  res.json({ success: true, data: { ticket: await serialize(ticket, 'admin') }, message: 'Ticket assigned.' });
}));

router.patch('/:ticketId/priority', requireRole('admin'), asyncHandler(async (req, res) => {
  const ticket = await getAccessibleTicket(String(req.params.ticketId), req.user!);
  const input = z.object({ priority: z.string().trim().min(1).max(100), note: z.string().trim().min(2).max(500) }).parse(req.body);
  const previous = ticket.priority;
  ticket.priority = input.priority;
  addAudit(ticket, req, 'priority_changed', `${previous} → ${input.priority}: ${input.note}`);
  await ticket.save();
  res.json({ success: true, data: { ticket: await serialize(ticket, 'admin') }, message: 'Ticket priority updated.' });
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
