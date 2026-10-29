import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSignupUserFields } from '../src/services/authService.js';

test('public signup persistence allow-list cannot set Admin role or reserved username', () => {
  const fields = publicSignupUserFields({
    name: 'Account Owner',
    email: 'owner@example.com',
    passwordHash: 'argon-hash-placeholder',
  });
  assert.deepEqual(Object.keys(fields).sort(), ['email', 'name', 'passwordHash']);
  assert.equal('role' in fields, false);
  assert.equal('username' in fields, false);
});
