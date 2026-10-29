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

export async function auditPolicy(kind: string, policy: any, actorId: unknown) {
  await eventOnce({ kind, policyId: policy._id, actorId, message: `${policy.name} SLA policy ${kind.replace('policy_', '')}.`, dedupeKey: `${kind}:${policy._id}:${policy.updatedAt?.getTime?.() ?? Date.now()}` });
}
