import mongoose, { type InferSchemaType } from 'mongoose';

const capacityPlanSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sourceTicketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
  horizon: { type: Number, enum: [7, 14], required: true },
  baselineCapacityPerDay: { type: Number, min: 0, required: true },
  proposedCapacityPerDay: { type: Number, min: 0, required: true },
  expectedDemand: { type: Number, min: 0, required: true },
  baselineCoverage: { type: Number, min: 0, required: true },
  proposedCoverage: { type: Number, min: 0, required: true },
  baselineUncovered: { type: Number, min: 0, required: true },
  proposedUncovered: { type: Number, min: 0, required: true },
  coverageImprovement: { type: Number, required: true },
  baselinePeakBacklog: { type: Number, min: 0, required: true },
  proposedPeakBacklog: { type: Number, min: 0, required: true },
  baselineBacklogAtHorizon: { type: Number, min: 0, required: true },
  proposedBacklogAtHorizon: { type: Number, min: 0, required: true },
  baselineClearanceDays: { type: Number, min: 0, default: null },
  proposedClearanceDays: { type: Number, min: 0, default: null },
  baselineOverloadedDays: { type: Number, min: 0, required: true },
  proposedOverloadedDays: { type: Number, min: 0, required: true },
  note: { type: String, required: true, maxlength: 2000 },
  forecast: [{ _id: false, date: String, forecast: Number }],
}, { timestamps: true });
capacityPlanSchema.index({ createdAt: -1 });
export type CapacityPlan = InferSchemaType<typeof capacityPlanSchema>;
export const CapacityPlanModel = mongoose.models.CapacityPlan || mongoose.model<CapacityPlan>('CapacityPlan', capacityPlanSchema);
