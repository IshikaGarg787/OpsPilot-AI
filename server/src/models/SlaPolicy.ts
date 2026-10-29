import mongoose from 'mongoose';

const slaPolicySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  priority: { type: String, required: true, trim: true, lowercase: true },
  firstResponseMinutes: { type: Number, required: true, min: 1 },
  resolutionMinutes: { type: Number, required: true, min: 1 },
  enabled: { type: Boolean, default: true, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

slaPolicySchema.index({ priority: 1 }, { unique: true, partialFilterExpression: { enabled: true } });
export const SlaPolicyModel = (mongoose.models.SlaPolicy || mongoose.model('SlaPolicy', slaPolicySchema)) as mongoose.Model<any>;
