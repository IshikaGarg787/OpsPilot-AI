import test from 'node:test';
import assert from 'node:assert/strict';
import { publicUser, UserModel } from '../src/models/User.js';
import { TicketModel } from '../src/models/Ticket.js';

test('user model normalizes email and enforces its required role contract', async () => {
  const user = new UserModel({
    name: 'Alex Morgan',
    email: '  Alex@Example.COM  ',
    passwordHash: 'argon-hash-placeholder',
  });

  await user.validate();
  assert.equal(user.email, 'alex@example.com');
  assert.equal(user.role, 'user');
});

test('user email has a unique database index', () => {
  const emailIndex = UserModel.schema.indexes().find(([keys]) => 'email' in keys);
  assert.ok(emailIndex);
  assert.equal(emailIndex[1].unique, true);
});

test('username is optional for legacy users and protected by a partial unique index', () => {
  const usernameIndex = UserModel.schema.indexes().find(([keys]) => 'username' in keys);
  assert.ok(usernameIndex);
  assert.equal(usernameIndex[1].unique, true);
  assert.deepEqual(usernameIndex[1].partialFilterExpression, { username: { $type: 'string' } });
  const legacyUser = new UserModel({ name: 'Legacy User', email: 'legacy@example.com', passwordHash: 'hash' });
  assert.equal(legacyUser.username, undefined);
});

test('public user contract omits password hashes and maps only the supported customer role', () => {
  const user = new UserModel({
    name: 'Test Customer',
    email: 'customer@example.test',
    passwordHash: 'test-only-hash',
  });

  const result = publicUser(user);
  assert.deepEqual(Object.keys(result).sort(), ['email', 'id', 'name', 'role', 'themePreference']);
  assert.equal(result.role, 'customer');
  assert.equal(JSON.stringify(result).includes('test-only-hash'), false);
});

test('ticket contract validates the persisted fields and rejects unsupported lifecycle statuses', async () => {
  const ticket = new TicketModel({
    ticketNumber: 'OP-TEST-1',
    ownerUserId: new UserModel()._id,
    ownerRole: 'customer',
    subject: 'Example issue',
    description: 'A sufficiently detailed issue description.',
    category: 'Access',
    priority: 'Normal',
    project: 'Workspace',
    status: 'open',
  });

  await ticket.validate();
  assert.equal(ticket.status, 'open');

  ticket.status = 'resolved-again' as never;
  await assert.rejects(ticket.validate(), /`resolved-again` is not a valid enum value/);
});
