import mongoose, { type InferSchemaType } from 'mongoose';

const responseSchema = new mongoose.Schema({
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorName: { type: String, required: true },
  authorRole: { type: String, enum: ['customer', 'it_team', 'admin'], required: true },
  visibility: { type: String, enum: ['public', 'internal'], default: 'public', required: true },
  message: { type: String, required: true, maxlength: 5000 },
  resolutionNote: { type: String, maxlength: 5000 },
}, { timestamps: true });

const auditSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true },
  actorRole: { type: String, enum: ['customer', 'it_team', 'admin'], required: true },
  action: { type: String, required: true, maxlength: 100 },
  details: { type: String, maxlength: 2000 },
}, { timestamps: true });

const ticketSchema = new mongoose.Schema({
  ticketNumber: { type: String, required: true, unique: true, index: true },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerRole: { type: String, enum: ['customer', 'it_team'], required: true },
  subject: { type: String, required: true, trim: true, minlength: 4, maxlength: 200 },
  description: { type: String, required: true, trim: true, minlength: 8, maxlength: 5000 },
  category: { type: String, required: true, trim: true, maxlength: 100 },
  priority: { type: String, required: true, trim: true, maxlength: 100 },
  project: { type: String, required: true, trim: true, maxlength: 200 },
  status: { type: String, enum: ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer', 'resolved', 'closed'], default: 'open', index: true },
  resolutionCompletedAt: { type: Date },
  resolutionReopenedAt: { type: Date },
  delayExplanation: { type: String, maxlength: 2000 },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  aiSignals: {
    delayRiskProbability: { type: Number, min: 0, max: 1 },
    delayRiskCategory: { type: String, enum: ['low', 'medium', 'high'] },
    flaggedForReview: { type: Boolean },
    reviewThreshold: { type: Number, min: 0, max: 1 },
    targetThresholdHours: { type: Number, min: 0 },
    resolutionHours: { type: Number, min: 0 },
    riskModelVersion: { type: String },
    resolutionModelVersion: { type: String },
    checkedAt: { type: Date },
    unavailableReason: { type: String, maxlength: 200 },
    riskExplanation: {
      summary: String,
      historicalEvidence: [{ _id: false, factor: String, value: String, historicalTickets: Number, historicalDelayRate: Number }],
      evidenceCutoff: String,
      interpretation: String,
    },
    recommendedAssignee: { id: String, name: String, activeTickets: Number },
    recommendedPriority: String,
  },
  workloadOutlook: {
    historyStart: { type: String },
    historyEnd: { type: String },
    historyDays: { type: Number, min: 1 },
    horizon: { type: Number, enum: [7, 14] },
    expectedTickets: { type: Number, min: 0 },
    highLoadDays: { type: Number, min: 0 },
    modelVersion: { type: String },
    forecast: [{ date: String, forecast: Number, planningLow: Number, planningHigh: Number, highLoad: Boolean }],
    generatedAt: { type: Date },
  },
  recommendation: {
    action: { type: String, enum: ['priority_review', 'standard_queue'] },
    state: { type: String, enum: ['pending', 'approved', 'rejected', 'modified'] },
    rationale: { type: String, maxlength: 1000 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decisionNote: { type: String, maxlength: 2000 },
    decidedAt: { type: Date },
  },
  responses: { type: [responseSchema], default: [] },
  audit: { type: [auditSchema], default: [] },
}, { timestamps: true });

ticketSchema.index({ ownerUserId: 1, createdAt: -1 });
ticketSchema.index({ assignedTo: 1, status: 1, updatedAt: -1 });
ticketSchema.index({ status: 1, priority: 1, updatedAt: -1 });

export type Ticket = InferSchemaType<typeof ticketSchema>;
export const TicketModel = mongoose.models.Ticket || mongoose.model<Ticket>('Ticket', ticketSchema);
