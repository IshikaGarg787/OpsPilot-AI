import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAdminOwner, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { publicUser, UserModel } from '../models/User.js';
import { itProfileSchema, preferenceSchema, profileSchema, userRoleSchema } from '../validators/schemas.js';
import { hashPassword } from '../services/authService.js';
import { z } from 'zod';
import { TicketModel } from '../models/Ticket.js';

const router = Router();
router.use(requireAuth);

router.get('/', requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await UserModel.find({}).sort({ createdAt: -1 }).lean();
  const counts = await TicketModel.aggregate([{ $match: { assignedTo: { $in: users.filter((user: any) => user.role === 'it_team').map((user: any) => user._id) }, status: { $in: ['assigned', 'in_progress'] } } }, { $group: { _id: '$assignedTo', count: { $sum: 1 } } }]);
  const active = new Map(counts.map((row: any) => [String(row._id), row.count]));
  res.json({ success: true, data: { users: users.map((user: any) => { const activeTickets = active.get(String(user._id)) ?? 0; return { id: String(user._id), name: user.name, email: user.email, role: user.role === 'user' ? 'customer' : user.role, createdAt: user.createdAt, ...(user.role === 'it_team' ? { skills: user.skills ?? [], activeTickets, availability: user.availability === 'unavailable' ? 'unavailable' : activeTickets ? 'busy' : 'available', setupPending: user.setupPending === true } : {}) }; }) } });
}));

router.post('/it-team', requireRole('admin'), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email() }).parse(req.body);
  if (await UserModel.exists({ email: input.email })) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_IN_USE');
  if (await UserModel.countDocuments({ role: 'it_team' }) >= 7) throw new HttpError(409, 'The seven IT Team account slots are full.', 'IT_TEAM_LIMIT_REACHED');
  const token = crypto.randomBytes(32).toString('base64url');
  const user = await UserModel.create({ name: input.name, email: input.email, role: 'it_team', passwordHash: await hashPassword(crypto.randomBytes(48).toString('base64url')), setupTokenHash: crypto.createHash('sha256').update(token).digest('hex'), setupTokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), setupPending: true });
  res.status(201).json({ success: true, data: { user: { id: user._id.toString(), name: user.name, email: user.email, role: 'it_team' }, setupToken: token }, message: 'IT account created. Share its one-time setup link with the teammate.' });
}));

router.patch('/:userId/role', requireAdminOwner, asyncHandler(async (req, res) => {
  const input = userRoleSchema.parse(req.body);
  const target = await UserModel.findById(req.params.userId);
  if (!target) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  if (target.role === 'admin') throw new HttpError(400, 'The fixed workspace owner role is managed only by the provisioning command.', 'OWNER_ROLE_LOCKED');
  if (input.role === 'it_team' && target.role !== 'it_team' && await UserModel.countDocuments({ role: 'it_team' }) >= 7) throw new HttpError(409, 'The seven IT Team account slots are full.', 'IT_TEAM_LIMIT_REACHED');
  target.role = input.role;
  await target.save();
  res.json({ success: true, data: { user: publicUser(target) }, message: 'Workspace role updated.' });
}));

router.get('/me', asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user!) } });
}));

router.patch('/me/it-profile', requireRole('it_team'), asyncHandler(async (req, res) => {
  const input = itProfileSchema.parse(req.body);
  req.user!.skills = [...new Set(input.skills.map((skill) => skill.trim()).filter(Boolean))];
  req.user!.availability = input.availability;
  await req.user!.save();
  res.json({ success: true, data: { profile: { skills: req.user!.skills, availability: req.user!.availability } }, message: 'IT profile saved.' });
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
