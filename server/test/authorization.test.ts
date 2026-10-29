import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { normalizedRole, type AppRole, type UserDocument } from '../src/models/User.js';
import { HttpError } from '../src/middleware/errorHandler.js';
import { requireAdminOwner, requireAuth, requireOwnerAdminWhenPresent, requireRole } from '../src/middleware/auth.js';
import { adminAuthorization } from '../src/routes/adminRoutes.js';

function invokeRoleGuard(role: string | undefined, allowedRoles: AppRole[], username?: string) {
  const request = {
    ...(role === undefined ? {} : { user: { role } as UserDocument }),
    ...(username === undefined ? {} : { username }),
  } as Request;
  let nextError: unknown;
  let nextCalled = false;
  requireRole(...allowedRoles)(request, {} as Response, (error?: unknown) => {
    nextCalled = true;
    nextError = error;
  });
  return { nextCalled, nextError };
}

function invokeAdminOwnerGuard(role: string | undefined, username?: string) {
  const request = {
    ...(role === undefined ? {} : { user: { role, username } as UserDocument }),
  } as Request;
  let nextError: unknown;
  let nextCalled = false;
  requireAdminOwner(request, {} as Response, (error?: unknown) => {
    nextCalled = true;
    nextError = error;
  });
  return { nextCalled, nextError };
}

test('role guard rejects requests without authenticated session context', () => {
  const result = invokeRoleGuard(undefined, ['admin']);
  assert.equal(result.nextCalled, true);
  assert.ok(result.nextError instanceof HttpError);
  assert.equal((result.nextError as HttpError).status, 401);
  assert.equal((result.nextError as HttpError).code, 'AUTH_REQUIRED');
});

test('matching the fixed username without authenticated credentials grants no access', () => {
  const result = invokeRoleGuard(undefined, ['admin'], 'deepti10648');
  assert.ok(result.nextError instanceof HttpError);
  assert.equal((result.nextError as HttpError).status, 401);
});

test('role guard rejects authenticated users with insufficient role', () => {
  const result = invokeRoleGuard('user', ['admin']);
  assert.equal(result.nextCalled, true);
  assert.ok(result.nextError instanceof HttpError);
  assert.equal((result.nextError as HttpError).status, 403);
  assert.equal((result.nextError as HttpError).code, 'FORBIDDEN');
});

test('persisted user maps only to the canonical Customer role', () => {
  assert.equal(normalizedRole({ role: 'user' }), 'customer');
  assert.equal(normalizedRole({ role: 'admin' }), 'admin');
  const result = invokeRoleGuard('user', ['customer']);
  assert.equal(result.nextCalled, true);
  assert.equal(result.nextError, undefined);
});

test('unknown and unapproved persisted roles fail closed', () => {
  assert.throws(() => normalizedRole({ role: 'it' }), /unsupported role/);
  assert.throws(() => normalizedRole({ role: 'it_team' }), /unsupported role/);
  assert.throws(() => normalizedRole({ role: 'unexpected' }), /unsupported role/);
  const result = invokeRoleGuard('unexpected', ['customer']);
  assert.ok(result.nextError instanceof HttpError);
  assert.equal((result.nextError as HttpError).status, 403);
});

test('mixed ticket authorization allows ordinary users but rejects non-owner Admin records', () => {
  const ordinary = { user: { role: 'user', username: 'customer1' } } as unknown as Request;
  let ordinaryError: unknown;
  requireOwnerAdminWhenPresent(ordinary, {} as Response, (error?: unknown) => { ordinaryError = error; });
  assert.equal(ordinaryError, undefined);

  const secondAdmin = { user: { role: 'admin', username: 'another-admin' } } as unknown as Request;
  let adminError: unknown;
  requireOwnerAdminWhenPresent(secondAdmin, {} as Response, (error?: unknown) => { adminError = error; });
  assert.ok(adminError instanceof HttpError);
  assert.equal((adminError as HttpError).status, 403);
});

test('Admin authorization requires both authenticated Admin role and the provisioned owner username', () => {
  const missingSession = invokeAdminOwnerGuard(undefined, 'deepti10648');
  assert.ok(missingSession.nextError instanceof HttpError);
  assert.equal((missingSession.nextError as HttpError).status, 401);

  const usernameOnly = invokeAdminOwnerGuard('user', 'deepti10648');
  assert.ok(usernameOnly.nextError instanceof HttpError);
  assert.equal((usernameOnly.nextError as HttpError).status, 403);

  const otherAdmin = invokeAdminOwnerGuard('admin', 'different-admin');
  assert.ok(otherAdmin.nextError instanceof HttpError);
  assert.equal((otherAdmin.nextError as HttpError).status, 403);

  const owner = invokeAdminOwnerGuard('admin', 'deepti10648');
  assert.equal(owner.nextCalled, true);
  assert.equal(owner.nextError, undefined);
});

test('Admin endpoint mounts authentication before role and owner checks', () => {
  assert.equal(adminAuthorization[0], requireAuth);

  const normalUser = { user: { role: 'user', username: 'customer1' } } as unknown as Request;
  let normalUserError: unknown;
  adminAuthorization[1](normalUser, {} as Response, (error?: unknown) => { normalUserError = error; });
  assert.ok(normalUserError instanceof HttpError);
  assert.equal((normalUserError as HttpError).status, 403);

  const owner = { user: { role: 'admin', username: 'deepti10648' } } as unknown as Request;
  for (const guard of adminAuthorization.slice(1)) {
    let error: unknown;
    guard(owner, {} as Response, (nextError?: unknown) => { error = nextError; });
    assert.equal(error, undefined);
  }
});
