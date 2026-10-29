import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_USERNAME,
  parseAdminProvisioningConfig,
  provisionAdmin,
  type AdminAccountRecord,
  type AdminAccountRepository,
} from '../src/services/adminProvisioning.js';

function configValues(overrides: Record<string, string> = {}) {
  return {
    ADMIN_PROVISION_ACTION: 'provision',
    ADMIN_USERNAME,
    ADMIN_OWNER_EMAIL: 'owner@example.com',
    ADMIN_OWNER_NAME: 'Account Owner',
    ADMIN_OWNER_EMAIL_VERIFIED: 'true',
    ADMIN_PROVISION_CONFIRM: `PROVISION ${ADMIN_USERNAME}`,
    ADMIN_INITIAL_PASSWORD: 'test-only-secure-password',
    ...overrides,
  };
}

class MemoryAdminRepository implements AdminAccountRepository {
  records: AdminAccountRecord[] = [];
  passwords = new Map<string, string>();
  createCount = 0;

  async findByUsername(username: string) { return this.records.find((record) => record.username === username) ?? null; }
  async findByEmail(email: string) { return this.records.find((record) => record.email === email) ?? null; }
  async findOtherAdmin(exceptAccountId?: string) {
    return this.records.find((record) => record.role === 'admin' && record.id !== exceptAccountId) ?? null;
  }
  async create(input: { username: typeof ADMIN_USERNAME; email: string; name: string; passwordHash: string; role: 'admin' }) {
    this.createCount += 1;
    const record = { id: `account-${this.createCount}`, username: input.username, email: input.email, role: input.role };
    this.records.push(record);
    this.passwords.set(record.id, input.passwordHash);
    return record;
  }
  async setAdminIdentity(accountId: string, email: string, username: typeof ADMIN_USERNAME, expectedRole: 'user' | 'customer' | 'it_team' | 'admin') {
    const record = this.records.find((item) => item.id === accountId && item.email === email && item.role === expectedRole);
    if (!record || (record.username && record.username !== username)) return false;
    record.username = username;
    record.role = 'admin';
    return true;
  }
  async setPassword(accountId: string, email: string, passwordHash: string) {
    const record = this.records.find((item) => item.id === accountId && item.email === email && item.username === ADMIN_USERNAME && item.role === 'admin');
    if (!record) return false;
    this.passwords.set(accountId, passwordHash);
    return true;
  }
}

test('provisioning config fails closed for mismatched username, unverified email, and weak password', () => {
  assert.throws(() => parseAdminProvisioningConfig(configValues({ ADMIN_USERNAME: 'someone-else' })), /fixed owner username/);
  assert.throws(() => parseAdminProvisioningConfig(configValues({ ADMIN_OWNER_EMAIL_VERIFIED: 'false' })), /verification/);
  assert.throws(() => parseAdminProvisioningConfig(configValues({ ADMIN_INITIAL_PASSWORD: 'short' })), /at least 16/);
});

test('provisioning rejects a username/email identity mismatch without changes', async () => {
  const repository = new MemoryAdminRepository();
  repository.records.push({ id: 'existing', username: ADMIN_USERNAME, email: 'different@example.com', role: 'user' });
  const config = parseAdminProvisioningConfig(configValues());
  await assert.rejects(provisionAdmin(config, repository, async () => 'hashed'), /identity does not match/);
  assert.equal(repository.records[0].role, 'user');
  assert.equal(repository.createCount, 0);
});

test('provisioning creates once; rerunning is a no-op and does not reset password', async () => {
  const repository = new MemoryAdminRepository();
  const config = parseAdminProvisioningConfig(configValues());
  let hashCalls = 0;
  const hash = async (value: string) => { hashCalls += 1; return `hash:${value}`; };

  assert.equal((await provisionAdmin(config, repository, hash)).status, 'created');
  const originalPassword = repository.passwords.get('account-1');
  assert.equal((await provisionAdmin(config, repository, hash)).status, 'unchanged');
  assert.equal(repository.createCount, 1);
  assert.equal(hashCalls, 1);
  assert.equal(repository.passwords.get('account-1'), originalPassword);
});

test('existing normal users are never promoted without explicit promotion approval', async () => {
  const repository = new MemoryAdminRepository();
  repository.records.push({ id: 'owner-user', username: null, email: 'owner@example.com', role: 'user' });
  const config = parseAdminProvisioningConfig(configValues());
  await assert.rejects(provisionAdmin(config, repository, async () => 'hashed'), /explicit ADMIN_ALLOW_EXISTING_USER_PROMOTION/);
  assert.equal(repository.records[0].role, 'user');
});

test('explicitly approved matching owner account can be promoted without password replacement', async () => {
  const repository = new MemoryAdminRepository();
  repository.records.push({ id: 'owner-user', username: null, email: 'owner@example.com', role: 'user' });
  repository.passwords.set('owner-user', 'existing-hash');
  const config = parseAdminProvisioningConfig(configValues({ ADMIN_ALLOW_EXISTING_USER_PROMOTION: 'true' }));
  const result = await provisionAdmin(config, repository, async () => 'must-not-be-used');
  assert.equal(result.status, 'promoted');
  assert.equal(repository.records[0].role, 'admin');
  assert.equal(repository.records[0].username, ADMIN_USERNAME);
  assert.equal(repository.passwords.get('owner-user'), 'existing-hash');
});

test('single-owner policy refuses provisioning when another Admin already exists', async () => {
  const repository = new MemoryAdminRepository();
  repository.records.push({ id: 'other-admin', username: 'other-admin', email: 'other@example.com', role: 'admin' });
  const config = parseAdminProvisioningConfig(configValues());
  await assert.rejects(provisionAdmin(config, repository, async () => 'hashed'), /Another Admin account exists/);
  assert.equal(repository.createCount, 0);
});

test('password reset requires the exact existing owner Admin identity', async () => {
  const repository = new MemoryAdminRepository();
  repository.records.push({ id: 'owner', username: ADMIN_USERNAME, email: 'owner@example.com', role: 'admin' });
  const config = parseAdminProvisioningConfig(configValues({
    ADMIN_PROVISION_ACTION: 'reset-password',
    ADMIN_PROVISION_CONFIRM: `RESET PASSWORD ${ADMIN_USERNAME}`,
  }));
  const result = await provisionAdmin(config, repository, async () => 'replacement-hash');
  assert.equal(result.status, 'password_reset');
  assert.equal(repository.passwords.get('owner'), 'replacement-hash');
});
