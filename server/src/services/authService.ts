import argon2 from 'argon2';
import { UserModel, type UserDocument } from '../models/User.js';

export async function hashPassword(password: string) {
  return argon2.hash(password, { type: argon2.argon2id });
}

/** Signup accepts customer/IT roles only; Admin identity is provisioned out of band. */
export function publicSignupUserFields(input: { name: string; email: string; passwordHash: string; role?: 'customer' | 'it_team' }) {
  return { name: input.name, email: input.email, passwordHash: input.passwordHash, ...(input.role ? { role: input.role } : {}) };
}

export async function verifyPassword(user: UserDocument, password: string) {
  return argon2.verify(String(user.passwordHash), password);
}

export async function findUserForLogin(email: string) {
  return UserModel.findOne({ email }).select('+passwordHash');
}
