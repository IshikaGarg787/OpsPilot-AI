import { TicketModel } from '../models/Ticket.js';
import { SlaPolicyModel } from '../models/SlaPolicy.js';
import { SlaEventModel } from '../models/SlaEvent.js';

const defaults = [
  { name: 'Critical', priority: 'critical', firstResponseMinutes: 15, resolutionMinutes: 240 },
  { name: 'High', priority: 'high', firstResponseMinutes: 30, resolutionMinutes: 480 },
  { name: 'Medium', priority: 'medium', firstResponseMinutes: 240, resolutionMinutes: 1440 },
  { name: 'Low', priority: 'low', firstResponseMinutes: 480, resolutionMinutes: 2880 },
];

const normalizePriority = (priority: string) => priority.trim().toLowerCase().replace(/[\s-]+/g, '_');

export async function seedDevelopmentSlaPolicies(actorId: unknown) {
  if (process.env.NODE_ENV === 'production') return;
  for (const policy of defaults) {
    const exists = await SlaPolicyModel.exists({ priority: policy.priority });
    if (!exists) await SlaPolicyModel.create({ ...policy, changedBy: actorId, enabled: true });
  }
}

async function eventOnce(data: Record<string, unknown>) {
  const { dedupeKey } = data as { dedupeKey: string };
  try { await SlaEventModel.updateOne({ dedupeKey }, { $setOnInsert: data }, { upsert: true }); }
  catch (error) { if ((error as { code?: number })?.code !== 11000) throw error; }
}

export async function startTicketSla(ticket: any, eligibleAt = ticket.createdAt ?? new Date()) {
  if (ticket.slaSnapshot) return ticket.slaSnapshot;
  const policy: any = await SlaPolicyModel.findOne({ priority: normalizePriority(ticket.priority), enabled: true }).lean();
  if (!policy) return null;
  const startedAt = eligibleAt;
  const snapshot = {
    policyId: policy._id, policyName: policy.name, priority: policy.priority,
    firstResponseStartAt: startedAt,
    firstResponseDeadlineAt: new Date(startedAt.getTime() + policy.firstResponseMinutes * 60_000),
    firstResponseAt: null,
    resolutionStartAt: startedAt,
    resolutionDeadlineAt: new Date(startedAt.getTime() + policy.resolutionMinutes * 60_000),
    resolutionAt: null, firstResponseStatus: 'pending', resolutionStatus: 'on_track',
  };
  ticket.slaSnapshot = snapshot;
  await ticket.save();
  await eventOnce({ kind: 'sla_started', ticketId: ticket._id, ticketNumber: ticket.ticketNumber, policyId: policy._id, message: `SLA started under ${policy.name}; response due ${snapshot.firstResponseDeadlineAt.toISOString()}, resolution due ${snapshot.resolutionDeadlineAt.toISOString()}.`, dedupeKey: `start:${ticket._id}` });
  return snapshot;
}

export async function recordFirstResponse(ticket: any, at = new Date()) {
  if (!ticket.slaSnapshot) return;
  if (at < ticket.slaSnapshot.firstResponseStartAt) return;
  if (!ticket.slaSnapshot.firstResponseAt) {
    ticket.slaSnapshot.firstResponseAt = at;
    ticket.slaSnapshot.firstResponseStatus = at <= ticket.slaSnapshot.firstResponseDeadlineAt ? 'met' : 'breached';
    await ticket.save();
    await eventOnce({ kind: ticket.slaSnapshot.firstResponseStatus === 'met' ? 'response_met' : 'response_breached', ticketId: ticket._id, ticketNumber: ticket.ticketNumber, policyId: ticket.slaSnapshot.policyId, slaType: 'response', message: `First response ${ticket.slaSnapshot.firstResponseStatus}.`, dedupeKey: `response:${ticket._id}` });
  }
}

export async function recordResolution(ticket: any, resolved: boolean, at = new Date()) {
  if (!ticket.slaSnapshot) return;
  if (resolved) {
    if (at < ticket.slaSnapshot.resolutionStartAt) return;
    ticket.slaSnapshot.resolutionAt = at;
    ticket.slaSnapshot.resolutionStatus = at <= ticket.slaSnapshot.resolutionDeadlineAt ? 'met' : 'breached';
    await ticket.save();
    await eventOnce({ kind: ticket.slaSnapshot.resolutionStatus === 'met' ? 'resolution_met' : 'resolution_breached', ticketId: ticket._id, ticketNumber: ticket.ticketNumber, policyId: ticket.slaSnapshot.policyId, slaType: 'resolution', message: `Resolution SLA ${ticket.slaSnapshot.resolutionStatus}.`, dedupeKey: `resolution:${ticket._id}:${at.toISOString()}` });
  } else {
    ticket.slaSnapshot.resolutionAt = null;
    ticket.slaSnapshot.resolutionStatus = at >= ticket.slaSnapshot.resolutionDeadlineAt ? 'breached' : 'on_track';
    await ticket.save();
  }
}

export async function evaluateSlaRecords(asOf = new Date()) {
  await initializeEligibleTicketSlas(asOf);
  const tickets = await TicketModel.find({ slaSnapshot: { $exists: true }, status: { $nin: ['resolved', 'closed'] } });
  for (const ticket of tickets as any[]) {
    const sla = ticket.slaSnapshot;
    for (const type of ['response', 'resolution'] as const) {
      const complete = type === 'response' ? sla.firstResponseAt : sla.resolutionAt;
      if (complete) continue;
      const deadline = type === 'response' ? sla.firstResponseDeadlineAt : sla.resolutionDeadlineAt;
      const start = type === 'response' ? sla.firstResponseStartAt : sla.resolutionStartAt;
      const elapsed = Math.max(0, asOf.getTime() - new Date(start).getTime());
      const duration = new Date(deadline).getTime() - new Date(start).getTime();
      const percent = Math.floor(elapsed / duration * 100);
      for (const threshold of [50, 80, 90]) if (percent >= threshold && asOf < new Date(deadline)) {
        await eventOnce({ kind: 'warning', ticketId: ticket._id, ticketNumber: ticket.ticketNumber, policyId: sla.policyId, slaType: type, threshold, message: `${type} SLA reached ${threshold}% elapsed.`, dedupeKey: `${ticket._id}:${type}:${threshold}` });
      }
      const status = asOf >= new Date(deadline) ? 'breached' : percent >= 80 ? 'at_risk' : 'on_track';
      if (type === 'response') sla.firstResponseStatus = status;
      else sla.resolutionStatus = status;
      if (status === 'breached') await eventOnce({ kind: 'breach', ticketId: ticket._id, ticketNumber: ticket.ticketNumber, policyId: sla.policyId, slaType: type, threshold: 100, message: `${type} SLA breached. Admin review recommended; no assignment was changed automatically.`, dedupeKey: `${ticket._id}:${type}:breach` });
    }
    ticket.markModified('slaSnapshot');
    await ticket.save();
  }
}

export async function initializeEligibleTicketSlas(asOf = new Date()) {
  const policies = await SlaPolicyModel.find({ enabled: true }).select('priority').lean();
  const priorities = policies.map((policy: any) => policy.priority);
  if (!priorities.length) return;
  const eligible = await TicketModel.find({ priority: { $in: priorities.map((priority: string) => new RegExp(`^${priority.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }, status: { $nin: ['resolved', 'closed'] }, slaSnapshot: { $exists: false } });
  for (const ticket of eligible as any[]) {
    const snapshot = await startTicketSla(ticket, asOf);
    if (!snapshot) continue;
    const firstStaffReply = ticket.responses?.find((reply: any) => reply.authorRole !== 'customer' && reply.visibility === 'public' && reply.createdAt >= snapshot.firstResponseStartAt);
    if (firstStaffReply) await recordFirstResponse(ticket, firstStaffReply.createdAt);
  }
}

export async function getSlaOverview() {
  await initializeEligibleTicketSlas();
  const tickets = await TicketModel.find().populate('assignedTo', 'name').select('ticketNumber subject priority status assignedTo slaSnapshot aiSignals.delayRiskProbability aiSignals.delayRiskCategory createdAt').sort({ updatedAt: -1 }).limit(500).lean();
  const events = await SlaEventModel.find().sort({ createdAt: -1 }).limit(200).lean();
  const tracked = tickets.filter((ticket: any) => ticket.slaSnapshot);
  const resolvedRecords = tracked.filter((ticket: any) => ticket.slaSnapshot.resolutionAt);
  const met = tracked.filter((ticket: any) => ticket.slaSnapshot.resolutionStatus === 'met').length;
  const durations = tracked.map((ticket: any) => ticket.slaSnapshot?.resolutionAt ? (new Date(ticket.slaSnapshot.resolutionAt).getTime() - new Date(ticket.slaSnapshot.resolutionStartAt).getTime()) / 3_600_000 : null).filter((v: number | null): v is number => v !== null);
  const responseDurations = tracked.map((ticket: any) => ticket.slaSnapshot?.firstResponseAt ? (new Date(ticket.slaSnapshot.firstResponseAt).getTime() - new Date(ticket.slaSnapshot.firstResponseStartAt).getTime()) / 3_600_000 : null).filter((v: number | null): v is number => v !== null);
  return { metrics: { compliancePercent: resolvedRecords.length ? Math.round(met / resolvedRecords.length * 100) : null, approaching: tracked.filter((t: any) => t.slaSnapshot.firstResponseStatus === 'at_risk' || t.slaSnapshot.resolutionStatus === 'at_risk').length, breached: tracked.filter((t: any) => t.slaSnapshot.firstResponseStatus === 'breached' || t.slaSnapshot.resolutionStatus === 'breached').length, met, averageFirstResponseHours: responseDurations.length ? responseDurations.reduce((a, b) => a + b, 0) / responseDurations.length : null, averageResolutionHours: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null }, tickets, events };
}

export function calculateSlaComplianceTrend(outcomes: Array<{ _id: { day: string; slaType: string }; eligible: number; met: number }>) {
  const trendMap = new Map<string, { date: string; responseEligible: number; responseMet: number; resolutionEligible: number; resolutionMet: number }>();
  for (const row of outcomes) {
    const day = trendMap.get(row._id.day) ?? { date: row._id.day, responseEligible: 0, responseMet: 0, resolutionEligible: 0, resolutionMet: 0 };
    const type = row._id.slaType === 'response' ? 'response' : 'resolution';
    if (type === 'response') { day.responseEligible += row.eligible; day.responseMet += row.met; }
    else { day.resolutionEligible += row.eligible; day.resolutionMet += row.met; }
    trendMap.set(row._id.day, day);
  }
  const trend = [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((row) => ({ ...row, eligible: row.responseEligible + row.resolutionEligible, met: row.responseMet + row.resolutionMet, compliancePercent: row.responseEligible + row.resolutionEligible ? Math.round((row.responseMet + row.resolutionMet) / (row.responseEligible + row.resolutionEligible) * 100) : null }));
  const eligible = outcomes.reduce((sum, row) => sum + row.eligible, 0);
  const met = outcomes.reduce((sum, row) => sum + row.met, 0);
  return { trend, compliancePercent: eligible ? Math.round(met / eligible * 100) : null };
}

/** Admin dashboard aggregates derived only from persisted ticket snapshots and SLA events. */
export async function getOperationsDashboard(input: { from: Date; to: Date; priority?: string; category?: string }) {
  const match: Record<string, unknown> = { createdAt: { $gte: input.from, $lte: input.to } };
  if (input.priority) match.priority = input.priority;
  if (input.category) match.category = input.category;
  const pipeline = [{ $match: match }];
  const eventTicketFilter = input.priority || input.category ? [{ $lookup: { from: 'tickets', localField: 'ticketId', foreignField: '_id', as: 'ticket' } }, { $unwind: '$ticket' }, { $match: { ...(input.priority ? { 'ticket.priority': input.priority } : {}), ...(input.category ? { 'ticket.category': input.category } : {}) } }] : [];
  const [summaryRows, priorityRows, riskRows, workloadRows, attention, events, ticketActivity, outcomes, filterOptions] = await Promise.all([
    TicketModel.aggregate([...pipeline, { $group: { _id: null, total: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ['$status', ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer']] }, 1, 0] } }, activeBreaches: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer']] }, { $or: [{ $eq: ['$slaSnapshot.firstResponseStatus', 'breached'] }, { $eq: ['$slaSnapshot.resolutionStatus', 'breached'] }] }] }, 1, 0] } }, atRisk: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer']] }, { $or: [{ $eq: ['$slaSnapshot.firstResponseStatus', 'at_risk'] }, { $eq: ['$slaSnapshot.resolutionStatus', 'at_risk'] }] }] }, 1, 0] } }, highRisk: { $sum: { $cond: [{ $eq: ['$aiSignals.delayRiskCategory', 'high'] }, 1, 0] } }, averageResolutionHours: { $avg: { $cond: [{ $and: [{ $in: ['$status', ['resolved', 'closed']] }, { $ne: ['$resolutionCompletedAt', null] }] }, { $divide: [{ $subtract: ['$resolutionCompletedAt', '$createdAt'] }, 3600000] }, null] } } } }]),
    TicketModel.aggregate([...pipeline, { $project: { priority: { $ifNull: ['$priority', 'Unknown'] }, obligations: ['$slaSnapshot.firstResponseStatus', '$slaSnapshot.resolutionStatus'] } }, { $unwind: '$obligations' }, { $match: { obligations: { $in: ['met', 'on_track', 'at_risk', 'breached'] } } }, { $group: { _id: { priority: '$priority', status: '$obligations' }, count: { $sum: 1 } } }, { $sort: { '_id.priority': 1 } }]),
    TicketModel.aggregate([...pipeline, { $match: { 'aiSignals.delayRiskCategory': { $in: ['low', 'medium', 'high'] } } }, { $group: { _id: '$aiSignals.delayRiskCategory', count: { $sum: 1 } } }]),
    TicketModel.aggregate([...pipeline, { $match: { status: { $nin: ['resolved', 'closed'] } } }, { $group: { _id: '$assignedTo', count: { $sum: 1 }, overdue: { $sum: { $cond: [{ $or: [{ $and: [{ $ne: ['$slaSnapshot.firstResponseDeadlineAt', null] }, { $lt: ['$slaSnapshot.firstResponseDeadlineAt', new Date()] }, { $ne: ['$slaSnapshot.firstResponseStatus', 'met'] }] }, { $and: [{ $ne: ['$slaSnapshot.resolutionDeadlineAt', null] }, { $lt: ['$slaSnapshot.resolutionDeadlineAt', new Date()] }, { $ne: ['$slaSnapshot.resolutionStatus', 'met'] }] }] }, 1, 0] } } } }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'member' } }, { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } }, { $project: { _id: 0, assigneeId: '$_id', name: { $ifNull: ['$member.name', 'Unassigned'] }, count: 1, overdue: 1 } }, { $sort: { count: -1, name: 1 } }]),
    TicketModel.aggregate([...pipeline, { $match: { status: { $nin: ['resolved', 'closed'] }, $or: [{ 'slaSnapshot.firstResponseStatus': { $in: ['at_risk', 'breached'] } }, { 'slaSnapshot.resolutionStatus': { $in: ['at_risk', 'breached'] } }, { 'aiSignals.delayRiskCategory': 'high' }, { assignedTo: null }] } }, { $addFields: { urgency: { $min: [{ $ifNull: ['$slaSnapshot.firstResponseDeadlineAt', new Date('9999-12-31')] }, { $ifNull: ['$slaSnapshot.resolutionDeadlineAt', new Date('9999-12-31')] }] } } }, { $sort: { urgency: 1, updatedAt: -1 } }, { $limit: 100 }, { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'member' } }, { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } }, { $project: { _id: 1, ticketNumber: 1, subject: 1, priority: 1, category: 1, status: 1, assignee: { $ifNull: ['$member.name', null] }, firstResponseDeadlineAt: '$slaSnapshot.firstResponseDeadlineAt', resolutionDeadlineAt: '$slaSnapshot.resolutionDeadlineAt', firstResponseStatus: '$slaSnapshot.firstResponseStatus', resolutionStatus: '$slaSnapshot.resolutionStatus', delayRiskCategory: '$aiSignals.delayRiskCategory', delayRiskProbability: '$aiSignals.delayRiskProbability', updatedAt: 1 } }]),
    SlaEventModel.aggregate([{ $match: { createdAt: { $gte: input.from, $lte: input.to }, kind: { $in: ['warning', 'breach', 'response_met', 'response_breached', 'resolution_met', 'resolution_breached'] } } }, ...eventTicketFilter, { $sort: { createdAt: -1 } }, { $limit: 30 }, { $project: { kind: 1, ticketId: 1, ticketNumber: 1, slaType: 1, message: 1, createdAt: 1 } }]),
    TicketModel.aggregate([...pipeline, { $unwind: '$audit' }, { $match: { 'audit.createdAt': { $gte: input.from, $lte: input.to }, 'audit.action': { $in: ['status_changed', 'ticket_assigned', 'ticket_created', 'response_added'] } } }, { $sort: { 'audit.createdAt': -1 } }, { $limit: 30 }, { $project: { _id: 0, kind: { $literal: 'ticket_activity' }, ticketId: '$_id', ticketNumber: 1, message: '$audit.action', createdAt: '$audit.createdAt' } }]),
    SlaEventModel.aggregate([{ $match: { createdAt: { $gte: input.from, $lte: input.to }, kind: { $in: ['response_met', 'response_breached', 'resolution_met', 'resolution_breached'] } } }, ...eventTicketFilter, { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, slaType: '$slaType' }, eligible: { $sum: 1 }, met: { $sum: { $cond: [{ $in: ['$kind', ['response_met', 'resolution_met']] }, 1, 0] } } } }, { $sort: { '_id.day': 1 } }]),
    Promise.all([TicketModel.distinct('priority'), TicketModel.distinct('category')]),
  ]);
  const summary = summaryRows[0];
  const compliance = calculateSlaComplianceTrend(outcomes);
  const activity = [...events, ...ticketActivity].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30);
  return { summary: { open: summary?.open ?? 0, compliancePercent: compliance.compliancePercent, activeBreaches: summary?.activeBreaches ?? 0, atRisk: summary?.atRisk ?? 0, highRisk: summary?.highRisk ?? 0, averageResolutionHours: summary?.averageResolutionHours ?? null }, priorityStatus: priorityRows, riskDistribution: riskRows, workload: workloadRows, attention, events: activity, trend: compliance.trend, filterOptions: { priorities: filterOptions[0].filter(Boolean).sort(), categories: filterOptions[1].filter(Boolean).sort() } };
}

export async function auditPolicy(kind: string, policy: any, actorId: unknown) {
  await eventOnce({ kind, policyId: policy._id, actorId, message: `${policy.name} SLA policy ${kind.replace('policy_', '')}.`, dedupeKey: `${kind}:${policy._id}:${policy.updatedAt?.getTime?.() ?? Date.now()}` });
}
