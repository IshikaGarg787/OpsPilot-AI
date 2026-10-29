import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { TicketModel } from '../src/models/Ticket.js';
import { SlaEventModel } from '../src/models/SlaEvent.js';
import { SlaPolicyModel } from '../src/models/SlaPolicy.js';
import { UserModel } from '../src/models/User.js';

const prefix = 'DEMO-OPS-';
const mode = process.argv[2] ?? '--seed';
const fixtures = [
  ['01', 'Cannot access account after password reset', 'critical', 'Assistance', 'breached', 'open', 'high'],
  ['02', 'Payment reconciliation page is unavailable', 'high', 'Service', 'breached', 'in_progress', 'high'],
  ['03', 'Monthly report export is delayed', 'medium', 'Bug', 'risk', 'assigned', 'medium'],
  ['04', 'Need help updating organization details', 'low', 'Assistance', 'track', 'open', 'low'],
  ['05', 'Critical alert notifications are not delivered', 'critical', 'Bug', 'breached', 'in_progress', 'high'],
  ['06', 'Request access to the analytics workspace', 'medium', 'Assistance', 'track', 'triaged', 'low'],
  ['07', 'Service request remains in queue', 'high', 'Service', 'risk', 'assigned', 'medium'],
  ['08', 'Dashboard table takes too long to load', 'low', 'Bug', 'track', 'in_progress', 'low'],
  ['09', 'Restore export access for finance team', 'critical', 'Service', 'met', 'resolved', 'low'],
  ['10', 'Fix incorrect user role shown in profile', 'high', 'Bug', 'late', 'resolved', 'medium'],
  ['11', 'Enable support portal for new department', 'medium', 'Assistance', 'met', 'closed', 'low'],
  ['12', 'Correct notification preferences', 'low', 'Bug', 'met', 'resolved', 'low'],
  ['13', 'Investigate repeated session timeout', 'high', 'Assistance', 'risk', 'open', 'high'],
  ['14', 'Restore access to archived records', 'medium', 'Service', 'breached', 'in_progress', 'high'],
  ['15', 'Update service contact details', 'low', 'Assistance', 'track', 'assigned', 'low'],
  ['16', 'Investigate intermittent API errors', 'critical', 'Bug', 'breached', 'open', 'high'],
] as const;

function ensureSafeTarget() {
  if (env.nodeEnv === 'production') throw new Error('Refusing to seed data while NODE_ENV is production.');
  if (mongoose.connection.name !== 'test') throw new Error(`Refusing to seed database "${mongoose.connection.name}". This helper is restricted to the verified development database "test".`);
  if (mode !== '--seed' && mode !== '--remove') throw new Error('Use --seed or --remove.');
}

async function main() {
  await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 8000 });
  ensureSafeTarget();
  if (mode === '--remove') {
    const [tickets, events] = await Promise.all([
      TicketModel.deleteMany({ ticketNumber: { $regex: `^${prefix}` } }),
      SlaEventModel.deleteMany({ ticketNumber: { $regex: `^${prefix}` } }),
    ]);
    console.log(JSON.stringify({ database: mongoose.connection.name, removedTickets: tickets.deletedCount, removedEvents: events.deletedCount }));
    return;
  }

  const [customer, admin, members, policies] = await Promise.all([
    UserModel.findOne({ role: 'customer' }).select('_id name').lean(),
    UserModel.findOne({ role: 'admin' }).select('_id name').lean(),
    UserModel.find({ role: 'it_team' }).select('_id name').sort({ createdAt: 1 }).lean(),
    SlaPolicyModel.find({ enabled: true }).select('_id name priority firstResponseMinutes resolutionMinutes').lean(),
  ]) as [any, any, any[], any[]];
  if (!customer || !admin || !members.length) throw new Error('Seed requires an existing customer, Admin, and IT member. It will not create users.');
  const policyByPriority = new Map(policies.map((policy: any) => [policy.priority, policy]));
  const now = new Date();
  let inserted = 0;

  for (let index = 0; index < fixtures.length; index += 1) {
    const [sequence, subject, priority, category, outcome, status, risk] = fixtures[index];
    const ticketNumber = `${prefix}${sequence}`;
    const policy: any = policyByPriority.get(priority);
    if (!policy) throw new Error(`No enabled SLA policy exists for ${priority}; seed stopped without creating any user or policy records.`);
    const member = index % 5 === 3 ? null : members[index % members.length];
    const durationMs = policy.resolutionMinutes * 60_000;
    const ageMs = outcome === 'track' ? (0.5 + index % 5) * 3_600_000
      : outcome === 'risk' ? durationMs * 0.85
        : outcome === 'breached' ? durationMs * (1.2 + (index % 3) * 0.4)
          : outcome === 'late' ? durationMs + 10 * 3_600_000
            : durationMs * (0.55 + (index % 4) * 0.04);
    const createdAt = new Date(now.getTime() - ageMs);
    const firstResponseDeadlineAt = new Date(createdAt.getTime() + policy.firstResponseMinutes * 60_000);
    const resolutionDeadlineAt = new Date(createdAt.getTime() + policy.resolutionMinutes * 60_000);
    const firstResponseAt = new Date(createdAt.getTime() + Math.min(5, Math.max(1, Math.floor(policy.firstResponseMinutes / 3))) * 60_000);
    const completionHours = outcome === 'late' ? Math.ceil(policy.resolutionMinutes / 60) + 8 : Math.max(1, Math.floor(policy.resolutionMinutes / 120));
    const resolutionAt = ['met', 'late'].includes(outcome) ? new Date(createdAt.getTime() + completionHours * 3_600_000) : null;
    const responseStatus = outcome === 'breached' && index % 2 === 0 ? 'breached' : 'met';
    const resolutionStatus = outcome === 'breached' ? 'breached' : outcome === 'risk' ? 'at_risk' : outcome === 'track' ? 'on_track' : outcome === 'late' ? 'breached' : 'met';
    const latest = resolutionAt ?? (resolutionStatus === 'breached' ? new Date(Math.min(now.getTime(), resolutionDeadlineAt.getTime() + 60_000)) : createdAt);
    const ticket = {
      ticketNumber, ownerUserId: customer._id, ownerRole: 'customer', subject,
      description: `DEMO DATA ONLY — seeded for dashboard visual review. ${subject}.`,
      category, priority, project: 'DEMO Operations Dashboard', status,
      assignedTo: member?._id ?? null,
      resolutionCompletedAt: resolutionAt,
      slaSnapshot: {
        policyId: policy._id, policyName: policy.name, priority: policy.priority,
        firstResponseStartAt: createdAt, firstResponseDeadlineAt,
        firstResponseAt: responseStatus === 'met' ? firstResponseAt : null,
        resolutionStartAt: createdAt, resolutionDeadlineAt, resolutionAt,
        firstResponseStatus: responseStatus, resolutionStatus,
      },
      aiSignals: { delayRiskProbability: risk === 'high' ? 0.88 : risk === 'medium' ? 0.57 : 0.18, delayRiskCategory: risk, flaggedForReview: risk === 'high', riskModelVersion: 'demo-only' },
      responses: [],
      audit: [{ actorId: admin._id, actorName: admin.name, actorRole: 'admin', action: 'ticket_created', details: 'DEMO DATA ONLY — seeded for dashboard visual review.', createdAt }],
      createdAt, updatedAt: latest,
    };
    const result = await TicketModel.collection.updateOne({ ticketNumber }, { $setOnInsert: ticket }, { upsert: true });
    if (result.upsertedCount) inserted += 1;
    const saved: any = await TicketModel.findOne({ ticketNumber }).select('_id').lean();
    const eventSpecs = [
      ...(responseStatus === 'met' || responseStatus === 'breached' ? [{ kind: responseStatus === 'met' ? 'response_met' : 'response_breached', slaType: 'response', at: responseStatus === 'met' ? firstResponseAt : new Date(Math.min(now.getTime(), firstResponseDeadlineAt.getTime() + 60_000)) }] : []),
      ...(resolutionAt ? [{ kind: resolutionStatus === 'met' ? 'resolution_met' : 'resolution_breached', slaType: 'resolution', at: resolutionAt }] : []),
      ...(resolutionStatus === 'breached' && !resolutionAt ? [{ kind: 'breach', slaType: 'resolution', at: latest }] : []),
      ...(resolutionStatus === 'at_risk' ? [{ kind: 'warning', slaType: 'resolution', at: latest }] : []),
    ];
    for (const event of eventSpecs) {
      const dedupeKey = `demo-ops:${ticketNumber}:${event.kind}:${event.slaType}`;
      await SlaEventModel.collection.updateOne({ dedupeKey }, { $setOnInsert: { kind: event.kind, ticketId: saved._id, ticketNumber, policyId: policy._id, actorId: admin._id, slaType: event.slaType, message: `DEMO DATA ONLY — ${event.slaType} SLA ${event.kind.replaceAll('_', ' ')}.`, dedupeKey, createdAt: event.at, updatedAt: event.at } }, { upsert: true });
    }
  }
  const total = await TicketModel.countDocuments({ ticketNumber: { $regex: `^${prefix}` } });
  console.log(JSON.stringify({ database: mongoose.connection.name, inserted, totalDemoTickets: total, note: 'Every seeded record is tagged DEMO DATA ONLY and can be removed with --remove.' }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : 'Dashboard seed operation failed.'); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
