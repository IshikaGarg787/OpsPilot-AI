import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { UserModel, publicUser } from '../models/User.js';
import { SessionModel } from '../models/Session.js';
import { createSession, clearSessionCookie, destroySession, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { findUserForLogin, hashPassword, publicSignupUserFields, verifyPassword } from '../services/authService.js';
import { loginSchema, signupSchema } from '../validators/schemas.js';
import { databaseStatus } from '../config/database.js';
import { ADMIN_OWNER_EMAIL, ADMIN_OWNER_USERNAME } from '../security/adminPolicy.js';
import crypto from 'node:crypto';
import { z } from 'zod';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { success: false, message: 'Too many authentication attempts. Try again later.', code: 'AUTH_RATE_LIMIT' } });

function requireDatabase() {
  if (!databaseStatus().connected) throw new HttpError(503, 'Account services are temporarily unavailable.', 'DATABASE_UNAVAILABLE');
}

router.post('/signup', authLimiter, asyncHandler(async (req, res) => {
  requireDatabase();
  const input = signupSchema.parse(req.body);
  const exists = await UserModel.exists({ email: input.email });
  if (exists) throw new HttpError(409, 'An account with this email already exists.', 'EMAIL_IN_USE');
  const user = await UserModel.create(publicSignupUserFields({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password) }));
  const session = await createSession(user._id.toString());
  setSessionCookie(res, session.token);
  res.status(201).json({ success: true, data: { user: publicUser(user) }, message: 'Account created.' });
}));

router.post('/activate-it-account', authLimiter, asyncHandler(async (req, res) => {
  requireDatabase();
  const input = z.object({ token: z.string().min(20).max(200), password: z.string().min(8).max(128) }).parse(req.body);
  const setupTokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
  const user = await UserModel.findOne({ setupTokenHash, setupTokenExpiresAt: { $gt: new Date() }, role: 'it_team' }).select('+passwordHash +setupTokenHash +setupTokenExpiresAt');
  if (!user) throw new HttpError(400, 'This account setup link is invalid or expired. Ask an Admin for a new one.', 'SETUP_LINK_INVALID');
  user.passwordHash = await hashPassword(input.password);
  user.set('setupTokenHash', undefined);
  user.set('setupTokenExpiresAt', undefined);
  user.setupPending = false;
  await user.save();
  res.json({ success: true, data: null, message: 'Password created. You can now sign in to the IT Team workspace.' });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  requireDatabase();
  const input = loginSchema.parse(req.body);
  const user = await findUserForLogin(input.email);
  if (!user || !(await verifyPassword(user, input.password))) throw new HttpError(401, 'Email or password is incorrect.', 'INVALID_CREDENTIALS');
  if (user.setupPending) throw new HttpError(403, 'Set your password using the one-time setup link from your Admin before signing in.', 'ACCOUNT_SETUP_REQUIRED');
  if (publicUser(user).role !== input.expectedRole) throw new HttpError(403, 'Selected role does not match this account.', 'ROLE_MISMATCH');
  if (input.expectedRole === 'admin' && (user.email.trim().toLowerCase() !== ADMIN_OWNER_EMAIL || user.username !== ADMIN_OWNER_USERNAME)) throw new HttpError(403, 'Admin sign-in is restricted to the provisioned workspace owner.', 'ADMIN_OWNER_REQUIRED');
  const session = await createSession(user._id.toString(), input.remember);
  setSessionCookie(res, session.token, input.remember);
  res.json({ success: true, data: { user: publicUser(user) }, message: 'Welcome back.' });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await destroySession(req.cookies?.ops_session);
  clearSessionCookie(res);
  res.json({ success: true, data: null, message: 'Signed out.' });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user!) } });
}));

router.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  await SessionModel.deleteMany({ userId: req.user!._id });
  clearSessionCookie(res);
  res.json({ success: true, data: null, message: 'All sessions signed out.' });
}));

export default router;
