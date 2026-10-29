import { z } from 'zod';
import { ADMIN_OWNER_USERNAME } from '../security/adminPolicy.js';

export const ADMIN_USERNAME = ADMIN_OWNER_USERNAME;
const USERNAME_CONFIRMATION = `PROVISION ${ADMIN_USERNAME}`;
const RESET_CONFIRMATION = `RESET PASSWORD ${ADMIN_USERNAME}`;

const emailSchema = z.string().trim().toLowerCase().email();

export interface AdminProvisioningConfig {
  action: 'provision' | 'reset-password';
  username: typeof ADMIN_USERNAME;
  ownerEmail: string;
  ownerName: string;
  initialPassword?: string;
  ownerEmailVerified: true;
  allowExistingUserPromotion: boolean;
  confirmation: string;
}

export interface AdminAccountRecord {
  id: string;
  username?: string | null;
  email: string;
  role: string;
}

export interface AdminAccountRepository {
  findByUsername(username: string): Promise<AdminAccountRecord | null>;
  findByEmail(email: string): Promise<AdminAccountRecord | null>;
  findOtherAdmin(exceptAccountId?: string): Promise<AdminAccountRecord | null>;
  create(input: { username: typeof ADMIN_USERNAME; email: string; name: string; passwordHash: string; role: 'admin' }): Promise<AdminAccountRecord>;
  setAdminIdentity(accountId: string, ownerEmail: string, username: typeof ADMIN_USERNAME, expectedRole: 'user' | 'customer' | 'it_team' | 'admin'): Promise<boolean>;
  setPassword(accountId: string, ownerEmail: string, passwordHash: string): Promise<boolean>;
}

export type AdminProvisioningResult = {
  status: 'created' | 'promoted' | 'unchanged' | 'password_reset';
  accountId: string;
};

export function parseAdminProvisioningConfig(values: Record<string, string | undefined>): AdminProvisioningConfig {
  const action = values.ADMIN_PROVISION_ACTION;
  if (action !== 'provision' && action !== 'reset-password') {
    throw new Error('ADMIN_PROVISION_ACTION must be provision or reset-password.');
  }
  const username = values.ADMIN_USERNAME?.trim().toLowerCase();
  if (username !== ADMIN_USERNAME) throw new Error('ADMIN_USERNAME must match the fixed owner username.');
  if (values.ADMIN_OWNER_EMAIL_VERIFIED !== 'true') throw new Error('Owner email verification must be explicitly confirmed.');
  const ownerEmail = emailSchema.parse(values.ADMIN_OWNER_EMAIL ?? '');
  const ownerName = values.ADMIN_OWNER_NAME?.trim();
  if (!ownerName || ownerName.length < 2 || ownerName.length > 100) throw new Error('ADMIN_OWNER_NAME must be configured.');

  const confirmation = values.ADMIN_PROVISION_CONFIRM ?? '';
  const expectedConfirmation = action === 'provision' ? USERNAME_CONFIRMATION : RESET_CONFIRMATION;
  if (confirmation !== expectedConfirmation) throw new Error('Explicit Admin provisioning confirmation does not match.');

  const initialPassword = values.ADMIN_INITIAL_PASSWORD;
  if (initialPassword !== undefined && initialPassword.length < 16) {
    throw new Error('ADMIN_INITIAL_PASSWORD must contain at least 16 characters.');
  }
  return {
    action,
    username: ADMIN_USERNAME,
    ownerEmail,
    ownerName,
    ...(initialPassword === undefined ? {} : { initialPassword }),
    ownerEmailVerified: true,
    allowExistingUserPromotion: values.ADMIN_ALLOW_EXISTING_USER_PROMOTION === 'true',
    confirmation,
  };
}

function assertIdentity(account: AdminAccountRecord, config: AdminProvisioningConfig): void {
  if (account.email.trim().toLowerCase() !== config.ownerEmail || (account.username && account.username.trim().toLowerCase() !== config.username)) {
    throw new Error('Existing account identity does not match the verified owner configuration.');
  }
}

export async function provisionAdmin(
  config: AdminProvisioningConfig,
  repository: AdminAccountRepository,
  hashPassword: (password: string) => Promise<string>,
): Promise<AdminProvisioningResult> {
  if (!config.ownerEmailVerified || config.username !== ADMIN_USERNAME) {
    throw new Error('Admin owner identity configuration is invalid.');
  }

  const [usernameMatch, emailMatch] = await Promise.all([
    repository.findByUsername(config.username),
    repository.findByEmail(config.ownerEmail),
  ]);
  if (usernameMatch && emailMatch && usernameMatch.id !== emailMatch.id) {
    throw new Error('Admin identity is ambiguous; username and email resolve to different accounts.');
  }
  const existing = usernameMatch ?? emailMatch;

  if (config.action === 'reset-password') {
    if (!existing || !usernameMatch || !emailMatch || usernameMatch.id !== emailMatch.id || existing.role !== 'admin') {
      throw new Error('Password reset requires the matching, already-provisioned Admin account.');
    }
    assertIdentity(existing, config);
    const otherAdmin = await repository.findOtherAdmin(existing.id);
    if (otherAdmin) throw new Error('Another Admin account exists; single-owner policy requires manual review.');
    if (!config.initialPassword) throw new Error('ADMIN_INITIAL_PASSWORD is required for password reset.');
    const changed = await repository.setPassword(existing.id, config.ownerEmail, await hashPassword(config.initialPassword));
    if (!changed) throw new Error('Admin password reset did not update the expected account.');
    return { status: 'password_reset', accountId: existing.id };
  }

  if (!existing) {
    if (await repository.findOtherAdmin()) throw new Error('Another Admin account exists; single-owner policy requires manual review.');
    if (!config.initialPassword) throw new Error('ADMIN_INITIAL_PASSWORD is required when creating the Admin account.');
    const created = await repository.create({
      username: config.username,
      email: config.ownerEmail,
      name: config.ownerName,
      passwordHash: await hashPassword(config.initialPassword),
      role: 'admin',
    });
    return { status: 'created', accountId: created.id };
  }

  assertIdentity(existing, config);
  const otherAdmin = await repository.findOtherAdmin(existing.id);
  if (otherAdmin) throw new Error('Another Admin account exists; single-owner policy requires manual review.');

  if (existing.role === 'admin') {
    if (existing.username === config.username) return { status: 'unchanged', accountId: existing.id };
    if (!await repository.setAdminIdentity(existing.id, config.ownerEmail, config.username, 'admin')) {
      throw new Error('Admin username could not be safely assigned.');
    }
    return { status: 'promoted', accountId: existing.id };
  }

  if (!['user', 'customer', 'it_team'].includes(existing.role)) throw new Error('Existing account has an unsupported role; no changes were made.');
  if (!config.allowExistingUserPromotion) throw new Error('Existing account promotion requires explicit ADMIN_ALLOW_EXISTING_USER_PROMOTION=true.');
  if (!await repository.setAdminIdentity(existing.id, config.ownerEmail, config.username, existing.role as 'user' | 'customer' | 'it_team')) {
    throw new Error('Existing user could not be safely promoted; no changes were confirmed.');
  }
  return { status: 'promoted', accountId: existing.id };
}
