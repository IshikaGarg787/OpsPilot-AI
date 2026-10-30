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
const unresolvedStatuses = ['open', 'triaged', 'assigned', 'in_progress', 'waiting_customer'];
const IT_TEAM_LIMIT = 16;

router.get('/', requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await UserModel.find({}).sort({ createdAt: -1 }).lean();
  const counts = await TicketModel.aggregate([{ $match: { assignedTo: { $in: users.filter((user: any) => user.role === 'it_team').map((user: any) => user._id) }, status: { $in: unresolvedStatuses } } }, { $group: { _id: '$assignedTo', count: { $sum: 1 } } }]);
  const active = new Map(counts.map((row: any) => [String(row._id), row.count]));
  res.json({ success: true, data: { users: users.map((user: any) => { const activeTickets = active.get(String(user._id)) ?? 0; return { id: String(user._id), name: user.name, email: user.email, role: user.role === 'user' ? 'customer' : user.role, createdAt: user.createdAt, ...(user.role === 'it_team' ? { skills: user.skills ?? [], activeTickets, availability: user.setupPending || activeTickets ? 'unavailable' : 'available', setupPending: user.setupPending === true } : {}) }; }) } });
}));

router.get('/workforce', requireRole('admin'), asyncHandler(async (_req, res) => {
  const members = await UserModel.find({ role: 'it_team' }).select('name email skills createdAt setupPending').sort({ name: 1 }).lean();
  if (!members.length) return res.json({ success: true, data: { workers: [] } });
  const ids = members.map((member: any) => member._id);
  const lookbackStart = new Date(Date.now() - 30 * 86400000);
  const metrics = await TicketModel.aggregate([
    { $match: { assignedTo: { $in: ids } } },
    { $group: {
      _id: '$assignedTo',
      totalAssigned: { $sum: 1 },
      activeTickets: { $sum: { $cond: [{ $in: ['$status', unresolvedStatuses] }, 1, 0] } },
      completedLast30Days: { $sum: { $cond: [{ $and: [{ $in: ['$status', ['resolved', 'closed']] }, { $gte: ['$resolutionCompletedAt', lookbackStart] }] }, 1, 0] } },
      completedTotal: { $sum: { $cond: [{ $in: ['$status', ['resolved', 'closed']] }, 1, 0] } },
      slaBreaches: { $sum: { $add: [{ $cond: [{ $eq: ['$slaSnapshot.firstResponseStatus', 'breached'] }, 1, 0] }, { $cond: [{ $eq: ['$slaSnapshot.resolutionStatus', 'breached'] }, 1, 0] }] } },
      slaMet: { $sum: { $add: [{ $cond: [{ $eq: ['$slaSnapshot.firstResponseStatus', 'met'] }, 1, 0] }, { $cond: [{ $eq: ['$slaSnapshot.resolutionStatus', 'met'] }, 1, 0] }] } },
    } },
  ]);
  const byMember = new Map(metrics.map((metric: any) => [String(metric._id), metric]));
  const workers = members.map((member: any) => {
    const metric: any = byMember.get(String(member._id)) ?? {};
    const activeTickets = metric.activeTickets ?? 0;
    const completedLast30Days = metric.completedLast30Days ?? 0;
    const expectedCompletionsNext7Days = Math.round((completedLast30Days / 30) * 7 * 10) / 10;
    const status = member.setupPending ? 'setup_pending' : activeTickets ? 'unavailable' : 'available';
    return {
      id: String(member._id), name: member.name, email: member.email, skills: member.skills ?? [], joinedAt: member.createdAt,
      setupPending: member.setupPending === true, status,
      totalAssigned: metric.totalAssigned ?? 0, activeTickets, completedTotal: metric.completedTotal ?? 0,
      completedLast30Days, slaBreaches: metric.slaBreaches ?? 0, slaMet: metric.slaMet ?? 0,
      capacityForecast: {
        horizonDays: 7, lookbackDays: 30, expectedCompletions: expectedCompletionsNext7Days,
        additionalTicketCapacity: Math.max(0, Math.floor(expectedCompletionsNext7Days - activeTickets)),
        confidence: completedLast30Days >= 10 ? 'moderate' : completedLast30Days > 0 ? 'limited' : 'insufficient_history',
      },
    };
  });
  res.json({ success: true, data: { workers } });
}));

router.get('/workforce/:userId/tickets', requireRole('admin'), asyncHandler(async (req, res) => {
  const userId = String(req.params.userId);
  if (!/^[a-f\d]{24}$/i.test(userId)) throw new HttpError(400, 'Choose a valid IT member.', 'INVALID_WORKER_ID');
  const member = await UserModel.findOne({ _id: userId, role: 'it_team' }).select('_id');
  if (!member) throw new HttpError(404, 'IT member not found.', 'IT_MEMBER_NOT_FOUND');
  const query = z.object({ kind: z.enum(['assigned', 'raised']).default('assigned'), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
  const filter = query.kind === 'assigned'
    ? { assignedTo: member._id }
    : { ownerUserId: member._id, ownerRole: 'it_team' };
  const skip = (query.page - 1) * query.pageSize;
  const [total, tickets] = await Promise.all([
    TicketModel.countDocuments(filter),
    TicketModel.find(filter).select('ticketNumber subject status createdAt aiSignals.resolutionHours').sort({ updatedAt: -1 }).skip(skip).limit(query.pageSize).lean(),
  ]);
  res.json({ success: true, data: {
    tickets: tickets.map((ticket: any) => ({
      id: String(ticket._id), ticketNumber: String(ticket.ticketNumber), subject: String(ticket.subject),
      status: ticket.status, createdAt: ticket.createdAt,
      estimatedResolutionAt: typeof ticket.aiSignals?.resolutionHours === 'number' ? new Date(new Date(ticket.createdAt).getTime() + ticket.aiSignals.resolutionHours * 3600000) : null,
    })),
    page: query.page, pageSize: query.pageSize, total, pages: Math.max(1, Math.ceil(total / query.pageSize)),
  } });
}));

router.post('/it-team', requireRole('admin'), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().toLowerCase().email() }).parse(req.body);
  if (await UserModel.exists({ email: input.email })) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_IN_USE');
  if (await UserModel.countDocuments({ role: 'it_team' }) >= IT_TEAM_LIMIT) throw new HttpError(409, `The ${IT_TEAM_LIMIT} IT Team account slots are full.`, 'IT_TEAM_LIMIT_REACHED');
  const token = crypto.randomBytes(32).toString('base64url');
  const user = await UserModel.create({ name: input.name, email: input.email, role: 'it_team', passwordHash: await hashPassword(crypto.randomBytes(48).toString('base64url')), setupTokenHash: crypto.createHash('sha256').update(token).digest('hex'), setupTokenExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), setupPending: true });
  res.status(201).json({ success: true, data: { user: { id: user._id.toString(), name: user.name, email: user.email, role: 'it_team' }, setupToken: token }, message: 'IT account created. Share its one-time setup link with the teammate.' });
}));

router.patch('/:userId/role', requireAdminOwner, asyncHandler(async (req, res) => {
  const input = userRoleSchema.parse(req.body);
  const target = await UserModel.findById(req.params.userId);
  if (!target) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  if (target.role === 'admin') throw new HttpError(400, 'The fixed workspace owner role is managed only by the provisioning command.', 'OWNER_ROLE_LOCKED');
  if (input.role === 'it_team' && target.role !== 'it_team' && await UserModel.countDocuments({ role: 'it_team' }) >= IT_TEAM_LIMIT) throw new HttpError(409, `The ${IT_TEAM_LIMIT} IT Team account slots are full.`, 'IT_TEAM_LIMIT_REACHED');
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
  await req.user!.save();
  res.json({ success: true, data: { profile: { skills: req.user!.skills } }, message: 'IT skills saved.' });
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
