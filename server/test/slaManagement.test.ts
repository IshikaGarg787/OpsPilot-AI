import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../src/middleware/auth.js';
import { slaAuthorization, policySchema } from '../src/routes/slaRoutes.js';
import { HttpError } from '../src/middleware/errorHandler.js';

test('SLA management routes require authentication followed by Admin role authorization', () => {
  assert.equal(slaAuthorization[0], requireAuth);
  assert.equal(typeof slaAuthorization[1], 'function');
  let error: unknown;
  slaAuthorization[1]({ user: { role: 'customer' } } as unknown as Request, {} as Response, (nextError?: unknown) => { error = nextError; });
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 403);
});

test('SLA policy validation requires positive integer targets and rejects administrative extras', () => {
  const valid = { name: 'Critical', priority: 'critical', firstResponseMinutes: 15, resolutionMinutes: 240 };
  assert.equal(policySchema.parse(valid).enabled, true);
  assert.equal(policySchema.safeParse({ ...valid, firstResponseMinutes: 0 }).success, false);
  assert.equal(policySchema.safeParse({ ...valid, resolutionMinutes: -1 }).success, false);
  assert.equal(policySchema.safeParse({ ...valid, slaDeadline: 'forged' }).success, false);
});
