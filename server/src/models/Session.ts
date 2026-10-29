import mongoose, { type InferSchemaType } from 'mongoose';

const sessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = mongoose.models.Session || mongoose.model<Session>('Session', sessionSchema);
