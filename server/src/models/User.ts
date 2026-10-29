import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    username: { type: String, trim: true, lowercase: true, match: /^[a-z0-9][a-z0-9_-]{2,31}$/ },
    passwordHash: { type: String, required: true, select: false },
    // Keep the legacy value readable so accounts created before role selection remain usable.
    role: { type: String, enum: ['customer', 'it_team', 'admin', 'user'], default: 'user' },
    themePreference: { type: String, enum: ['light', 'dark', 'system'], default: 'dark' },
  },
  {
    timestamps: true,
    toJSON: { transform: (_doc, ret) => { const output = ret as Record<string, unknown>; delete output.passwordHash; delete output.__v; return output; } },
  },
);

userSchema.index({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export type AppRole = 'customer' | 'it_team' | 'admin';
export const UserModel = mongoose.models.User || mongoose.model<User>('User', userSchema);

export function publicUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role === 'user' ? 'customer' : user.role,
    themePreference: user.themePreference,
  };
}

export function normalizedRole(user: UserDocument): AppRole {
  return user.role === 'user' ? 'customer' : user.role as AppRole;
}
