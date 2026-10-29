import mongoose from 'mongoose';

const slaEventSchema = new mongoose.Schema({
  kind: { type: String, enum: ['policy_created', 'policy_updated', 'policy_enabled', 'policy_disabled', 'sla_started', 'response_met', 'response_breached', 'resolution_met', 'resolution_breached', 'warning', 'breach'], required: true },
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', default: null, index: true },
  ticketNumber: { type: String, default: null },
  policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'SlaPolicy', default: null },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  slaType: { type: String, enum: ['response', 'resolution'], default: null },
  threshold: { type: Number, default: null },
  message: { type: String, required: true, maxlength: 500 },
  dedupeKey: { type: String, required: true, unique: true },
}, { timestamps: true });

slaEventSchema.index({ createdAt: -1 });
export const SlaEventModel = mongoose.models.SlaEvent || mongoose.model('SlaEvent', slaEventSchema);
