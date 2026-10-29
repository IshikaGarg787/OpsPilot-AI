import mongoose from 'mongoose';
import { connectDatabase } from '../src/config/database.js';
import { UserModel } from '../src/models/User.js';
import { hashPassword } from '../src/services/authService.js';
import {
  parseAdminProvisioningConfig,
  provisionAdmin,
  type AdminAccountRecord,
  type AdminAccountRepository,
} from '../src/services/adminProvisioning.js';

type LeanAccount = { _id: mongoose.Types.ObjectId; username?: string | null; email: string; role: string };

function asRecord(account: LeanAccount | null): AdminAccountRecord | null {
  return account ? { id: account._id.toString(), username: account.username, email: account.email, role: account.role } : null;
}

const repository: AdminAccountRepository = {
  async findByUsername(username) {
    return asRecord(await UserModel.findOne({ username }).select('_id username email role').lean() as unknown as LeanAccount | null);
  },
  async findByEmail(email) {
    return asRecord(await UserModel.findOne({ email }).select('_id username email role').lean() as unknown as LeanAccount | null);
  },
  async findOtherAdmin(exceptAccountId) {
    const query = exceptAccountId
      ? { role: 'admin', _id: { $ne: new mongoose.Types.ObjectId(exceptAccountId) } }
      : { role: 'admin' };
    return asRecord(await UserModel.findOne(query).select('_id username email role').lean() as unknown as LeanAccount | null);
  },
  async create(input) {
    const created = await UserModel.create(input);
    return { id: created._id.toString(), username: created.username, email: created.email, role: String(created.role) };
  },
  async setAdminIdentity(accountId, ownerEmail, username, expectedRole) {
    const updated = await UserModel.updateOne({
      _id: accountId,
      email: ownerEmail,
      role: expectedRole,
      $or: [{ username: { $exists: false } }, { username: null }, { username }],
    }, { $set: { username, role: 'admin' } });
    return updated.modifiedCount === 1 || updated.matchedCount === 1;
  },
  async setPassword(accountId, ownerEmail, passwordHash) {
    const updated = await UserModel.updateOne({ _id: accountId, username: 'deepti10648', email: ownerEmail, role: 'admin' }, { $set: { passwordHash } });
    return updated.matchedCount === 1;
  },
};

async function main() {
  try {
    const config = parseAdminProvisioningConfig(process.env);
    if (!await connectDatabase()) {
      process.exitCode = 1;
      return;
    }
    // Ensure the partial unique username index exists before provisioning.
    await UserModel.init();
    const result = await provisionAdmin(config, repository, hashPassword);
    console.log(`Admin ${result.status.replace('_', ' ')} operation completed.`);
  } catch {
    console.error('Admin operation failed. Verify the explicit configuration and owner identity; details are withheld.');
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

await main();
