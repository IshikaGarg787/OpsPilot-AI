import test from 'node:test';
import assert from 'node:assert/strict';
import { UserModel } from '../src/models/User.js';

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
