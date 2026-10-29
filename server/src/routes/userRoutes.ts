import { Router } from 'express';
import { requireAdminOwner, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { publicUser, UserModel } from '../models/User.js';
import { preferenceSchema, profileSchema, userRoleSchema } from '../validators/schemas.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await UserModel.find({}).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: { users: users.map((user: any) => ({ id: String(user._id), name: user.name, email: user.email, role: user.role === 'user' ? 'customer' : user.role, createdAt: user.createdAt })) } });
}));

router.patch('/:userId/role', requireAdminOwner, asyncHandler(async (req, res) => {
  const input = userRoleSchema.parse(req.body);
  const target = await UserModel.findById(req.params.userId);
  if (!target) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  if (target.role === 'admin') throw new HttpError(400, 'The fixed workspace owner role is managed only by the provisioning command.', 'OWNER_ROLE_LOCKED');
  target.role = input.role;
  await target.save();
  res.json({ success: true, data: { user: publicUser(target) }, message: 'Workspace role updated.' });
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
