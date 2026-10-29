import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { SlaPolicyModel } from '../models/SlaPolicy.js';
import { SlaEventModel } from '../models/SlaEvent.js';
import { auditPolicy, getOperationsDashboard, getSlaOverview, seedDevelopmentSlaPolicies } from '../services/slaManagementService.js';
import { databaseStatus } from '../config/database.js';

const router = Router();
export const slaAuthorization = [requireAuth, requireRole('admin')] as const;
router.use(...slaAuthorization);
export const policySchema = z.object({ name: z.string().trim().min(2).max(120), priority: z.string().trim().min(1).max(100), firstResponseMinutes: z.number().int().positive().max(525600), resolutionMinutes: z.number().int().positive().max(525600), enabled: z.boolean().default(true) }).strict();
export const operationsQuerySchema = z.object({ range: z.enum(['7', '30', '90']).default('30'), priority: z.string().trim().max(100).optional(), category: z.string().trim().max(100).optional() }).strict();

router.get('/policies', asyncHandler(async (req, res) => {
  await seedDevelopmentSlaPolicies(req.user!._id);
  const policies = await SlaPolicyModel.find().sort({ priority: 1 }).lean();
  res.json({ success: true, data: { policies } });
}));
router.post('/policies', asyncHandler(async (req, res) => {
  const input = policySchema.parse(req.body);
  const priority = input.priority.toLowerCase().replace(/[\s-]+/g, '_');
  if (input.enabled && await SlaPolicyModel.exists({ priority, enabled: true })) throw new HttpError(409, 'An enabled policy already exists for this priority.', 'SLA_POLICY_EXISTS');
  const policy = await SlaPolicyModel.create({ ...input, priority, changedBy: req.user!._id });
  await auditPolicy('policy_created', policy, req.user!._id);
  res.status(201).json({ success: true, data: { policy } });
}));
router.patch('/policies/:id', asyncHandler(async (req, res) => {
  const input = policySchema.partial().strict().parse(req.body);
  if (!Object.keys(input).length) throw new HttpError(400, 'Provide at least one policy field.', 'EMPTY_UPDATE');
  const policy = await SlaPolicyModel.findById(req.params.id);
  if (!policy) throw new HttpError(404, 'SLA policy not found.', 'SLA_POLICY_NOT_FOUND');
  const priority = input.priority?.toLowerCase().replace(/[\s-]+/g, '_') ?? policy.priority;
  const willEnable = input.enabled ?? policy.enabled;
  if (willEnable && await SlaPolicyModel.exists({ _id: { $ne: policy._id }, priority, enabled: true })) throw new HttpError(409, 'An enabled policy already exists for this priority.', 'SLA_POLICY_EXISTS');
  Object.assign(policy, input, { priority, changedBy: req.user!._id });
  await policy.save();
  await auditPolicy(input.enabled === false ? 'policy_disabled' : 'policy_updated', policy, req.user!._id);
  res.json({ success: true, data: { policy } });
}));
router.get('/overview', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await getSlaOverview() });
}));
router.get('/operations', asyncHandler(async (req, res) => {
  if (!databaseStatus().connected) throw new HttpError(503, 'Dashboard data is temporarily unavailable.', 'DATABASE_UNAVAILABLE');
  const query = operationsQuerySchema.parse(req.query);
  const to = new Date();
  const from = new Date(to.getTime() - Number(query.range) * 24 * 60 * 60 * 1000);
  res.json({ success: true, data: await getOperationsDashboard({ from, to, priority: query.priority || undefined, category: query.category || undefined }) });
}));
router.get('/events', asyncHandler(async (_req, res) => {
  const events = await SlaEventModel.find().sort({ createdAt: -1 }).limit(300).lean();
  res.json({ success: true, data: { events } });
}));

export default router;
