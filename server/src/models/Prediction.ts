import mongoose, { type InferSchemaType } from 'mongoose';

const predictionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    modelId: { type: String, required: true, index: true },
    modelVersion: { type: String },
    predictionType: { type: String, required: true },
    input: {
      issueCreated: { type: Date, required: true },
      priority: { type: String, required: true },
      issueType: { type: String, required: true },
      project: { type: String, required: true },
      complaint: { type: String, trim: true, maxlength: 3000 },
      ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' },
    },
    output: {
      duration: { type: Number, min: 0 },
      unit: { type: String, enum: ['hours'], default: 'hours' },
      delayRisk: {
        probability: { type: Number, min: 0, max: 1 },
        category: { type: String, enum: ['low', 'medium', 'high'] },
        flaggedForReview: { type: Boolean },
        decisionThreshold: { type: Number, min: 0, max: 1 },
        targetThresholdHours: { type: Number, min: 0 },
        modelVersion: { type: String },
        explanation: {
          summary: String,
          historicalEvidence: [{ _id: false, factor: String, value: String, historicalTickets: Number, historicalDelayRate: Number }],
          evidenceCutoff: String,
          interpretation: String,
        },
      },
      workload: {
        historyStart: { type: String },
        historyEnd: { type: String },
        historyDays: { type: Number, min: 0 },
        horizon: { type: Number, enum: [7, 14] },
        ticketTotal: { type: Number, min: 0 },
        expectedTickets: { type: Number, min: 0 },
        highLoadDays: { type: Number, min: 0 },
        modelVersion: { type: String },
        source: { type: String, enum: ['workspace_ticket_history', 'uploaded_csv', 'queue_history', 'triage'] },
        forecast: [{
          _id: false,
          date: { type: String, required: true },
          forecast: { type: Number, required: true, min: 0 },
          planningLow: { type: Number, required: true, min: 0 },
          planningHigh: { type: Number, required: true, min: 0 },
          highLoad: { type: Boolean, required: true },
        }],
      },
    },
    status: { type: String, enum: ['success', 'failed'], required: true, index: true },
    errorCode: { type: String },
  },
  { timestamps: true },
);

predictionSchema.index({ userId: 1, createdAt: -1 });
predictionSchema.index({ userId: 1, modelId: 1, createdAt: -1 });
export type Prediction = InferSchemaType<typeof predictionSchema>;
export const PredictionModel = mongoose.models.Prediction || mongoose.model<Prediction>('Prediction', predictionSchema);
