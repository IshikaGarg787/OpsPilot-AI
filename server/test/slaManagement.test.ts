import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { requireAuth, requireRole } from '../src/middleware/auth.js';
import { operationsQuerySchema, slaAuthorization, policySchema } from '../src/routes/slaRoutes.js';
import { calculateSlaComplianceTrend } from '../src/services/slaManagementService.js';
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

test('operations dashboard filters accept supported ranges and reject invalid range or extra query fields', () => {
  assert.deepEqual(operationsQuerySchema.parse({}), { range: '30' });
  assert.equal(operationsQuerySchema.safeParse({ range: '7', priority: 'High', category: 'Network' }).success, true);
  assert.equal(operationsQuerySchema.safeParse({ range: '365' }).success, false);
  assert.equal(operationsQuerySchema.safeParse({ range: '30', ownerUserId: 'someone' }).success, false);
});

test('SLA compliance trend uses persisted completed outcomes and handles empty history', () => {
  assert.deepEqual(calculateSlaComplianceTrend([]), { trend: [], compliancePercent: null });
  const result = calculateSlaComplianceTrend([
    { _id: { day: '2026-03-01', slaType: 'response' }, eligible: 2, met: 2 },
    { _id: { day: '2026-03-01', slaType: 'resolution' }, eligible: 2, met: 1 },
    { _id: { day: '2026-03-02', slaType: 'resolution' }, eligible: 1, met: 0 },
  ]);
  assert.equal(result.compliancePercent, 60);
  assert.equal(result.trend[0].compliancePercent, 75);
  assert.equal(result.trend[0].responseEligible, 2);
  assert.equal(result.trend[1].compliancePercent, 0);
});
