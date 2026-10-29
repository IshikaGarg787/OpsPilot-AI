import crypto from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { SessionModel } from '../models/Session.js';
import { HttpError } from './errorHandler.js';
import { env } from '../config/env.js';
import { databaseStatus } from '../config/database.js';
import { normalizedRole, type AppRole, type UserDocument } from '../models/User.js';
import { ADMIN_OWNER_USERNAME } from '../security/adminPolicy.js';

const COOKIE_NAME = 'ops_session';

function hashToken(token: string) {
  return crypto.createHmac('sha256', env.sessionSecret || 'development-session-key').update(token).digest('hex');
}

export function setSessionCookie(res: Response, token: string, remember = false) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: (remember ? 30 : 1) * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', path: '/' });
}

export async function createSession(userId: string, remember = false) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * 24 * 60 * 60 * 1000);
  await SessionModel.create({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token?: string) {
  if (token) await SessionModel.deleteOne({ tokenHash: hashToken(token) });
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    if (!databaseStatus().connected) throw new HttpError(503, 'Account services are temporarily unavailable.', 'DATABASE_UNAVAILABLE');
    const token = req.cookies?.[COOKIE_NAME] as string | undefined;
    if (!token) throw new HttpError(401, 'Authentication is required.', 'AUTH_REQUIRED');
    const session = await SessionModel.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).populate('userId');
    if (!session?.userId || typeof session.userId === 'string' || !(session.userId as { _id?: unknown })._id) throw new HttpError(401, 'Your session has expired.', 'SESSION_EXPIRED');
    req.user = session.userId as unknown as UserDocument;
    req.sessionId = session._id.toString();
    void SessionModel.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } });
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(...roles: AppRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentication is required.', 'AUTH_REQUIRED'));
    if (!roles.includes(normalizedRole(req.user))) return next(new HttpError(403, 'Your workspace role cannot perform this action.', 'FORBIDDEN'));
    next();
  };
}

export const requireAdminOwner: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication is required.', 'AUTH_REQUIRED'));
  if (normalizedRole(req.user) !== 'admin' || req.user.username !== ADMIN_OWNER_USERNAME) return next(new HttpError(403, 'This action is restricted to the provisioned workspace owner.', 'ADMIN_OWNER_REQUIRED'));
  next();
};

export { COOKIE_NAME, hashToken };
