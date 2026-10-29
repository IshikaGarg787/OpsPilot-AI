import { PredictionModel } from '../models/Prediction.js';
import { TicketModel } from '../models/Ticket.js';
import type { UserDocument } from '../models/User.js';
import { normalizedRole } from '../models/User.js';

const inFlight = new Map<string, Promise<void>>();
const backfilled = new Set<string>();

/** Idempotently exposes existing ticket intake scores in the user's prediction history. */
export async function backfillSavedTicketPredictions(user: UserDocument): Promise<void> {
  const key = normalizedRole(user) === 'admin' ? 'workspace' : user._id.toString();
  if (backfilled.has(key)) return;
  const lock = 'ticket-prediction-history-backfill';
  const existing = inFlight.get(lock);
  if (existing) { await existing; return backfillSavedTicketPredictions(user); }
  const task = writeSavedTicketPredictions(user);
  inFlight.set(lock, task);
  try { await task; backfilled.add(key); } finally { inFlight.delete(lock); }
}

async function writeSavedTicketPredictions(user: UserDocument) {
  const filter = normalizedRole(user) === 'admin' ? {} : { ownerUserId: user._id };
  const tickets = await TicketModel.find({ ...filter, aiSignals: { $exists: true } }).select('ownerUserId createdAt priority category project description aiSignals').limit(10000).lean();
  const writes: Promise<unknown>[] = [];
  for (const ticket of tickets as any[]) {
    const input = { issueCreated: ticket.createdAt, priority: ticket.priority, issueType: ticket.category, project: ticket.project, complaint: ticket.description, ticketId: ticket._id };
    const risk = ticket.aiSignals?.delayRiskProbability;
    if (typeof risk === 'number') {
      writes.push(PredictionModel.updateOne(
        { userId: ticket.ownerUserId, modelId: 'operational-risk', 'input.ticketId': ticket._id },
        { $setOnInsert: { userId: ticket.ownerUserId, modelId: 'operational-risk', modelVersion: ticket.aiSignals.riskModelVersion, predictionType: 'delay_risk_classification', input, output: { delayRisk: { probability: risk, category: ticket.aiSignals.delayRiskCategory, flaggedForReview: ticket.aiSignals.flaggedForReview, decisionThreshold: ticket.aiSignals.reviewThreshold, targetThresholdHours: ticket.aiSignals.targetThresholdHours, modelVersion: ticket.aiSignals.riskModelVersion, ...(ticket.aiSignals.riskExplanation ? { explanation: ticket.aiSignals.riskExplanation } : {}) } }, status: 'success' } },
        { upsert: true },
      ));
    }
    const duration = ticket.aiSignals?.resolutionHours;
    if (typeof duration === 'number') {
      writes.push(PredictionModel.updateOne(
        { userId: ticket.ownerUserId, modelId: 'resolution-time', 'input.ticketId': ticket._id },
        { $setOnInsert: { userId: ticket.ownerUserId, modelId: 'resolution-time', modelVersion: ticket.aiSignals.resolutionModelVersion, predictionType: 'point_estimate', input, output: { duration, unit: 'hours' }, status: 'success' } },
        { upsert: true },
      ));
    }
  }
  await Promise.all(writes);
}
