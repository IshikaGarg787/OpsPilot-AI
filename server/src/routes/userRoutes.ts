import { Router } from 'express';
import { requireAdminOwner, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { publicUser, UserModel } from '../models/User.js';
import { preferenceSchema, profileSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

// Owner-only directory; role changes remain unavailable until the IT onboarding policy is approved.
router.get('/', requireRole('admin'), requireAdminOwner, asyncHandler(async (_req, res) => {
  const users = await UserModel.find({}).sort({ createdAt: -1 }).select('name email role themePreference createdAt').lean();
  res.json({ success: true, data: { users: users.map((user) => ({ id: String(user._id), name: user.name, email: user.email, role: user.role === 'user' ? 'customer' : user.role, createdAt: user.createdAt })) } });
}));

router.get('/me', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user!) } });
}));

router.patch('/me', asyncHandler(async (req, res) => {
  const input = profileSchema.parse(req.body);
  req.user!.name = input.name;
  await req.user!.save();
  res.json({ success: true, data: { user: publicUser(req.user!) }, message: 'Profile updated.' });
}));

router.patch('/me/preferences', asyncHandler(async (req, res) => {
  const input = preferenceSchema.parse(req.body);
  req.user!.themePreference = input.themePreference;
  await req.user!.save();
  res.json({ success: true, data: { user: publicUser(req.user!) }, message: 'Preferences saved.' });
}));

export default router;
