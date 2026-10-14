/**
 * Validasi data akun (nama, email, peran, password) yang dipakai oleh
 * AuthService (akun admin pertama, ganti password) dan UserAdminService.
 */
import type { UserRole } from '@flowqa/shared';
import { PASSWORD_MIN_LENGTH, createId } from '@flowqa/shared';
import { HttpError } from '../lib/http';
import { hashPassword } from '../lib/password';
import { nowIso } from '../lib/time';
import type { UserRecord, UserRepository } from '../repositories/user-repository';

export type UserInput = Record<string, unknown>;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(value: unknown): string {
  const password = String(value ?? '');
  if (password.length < PASSWORD_MIN_LENGTH)
    throw new HttpError(400, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  return password;
}

export function validateProfile(users: UserRepository, input: UserInput, existing?: UserRecord) {
  const name = String(input.name ?? existing?.name ?? '').trim();
  const email = String(input.email ?? existing?.email ?? '')
    .trim()
    .toLowerCase();
  if (!name) throw new HttpError(400, 'Enter a name');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address');
  const owner = users.findByEmail(email);
  if (owner && owner.id !== existing?.id) throw new HttpError(409, 'This email is already registered');
  const role: UserRole =
    input.role === 'admin' || input.role === 'member' ? input.role : (existing?.role ?? 'member');
  const active = typeof input.active === 'boolean' ? input.active : (existing?.active ?? true);
  return { name, email, role, active };
}

/** Rakit record user baru yang tervalidasi (belum disimpan). */
export async function newUserRecord(users: UserRepository, input: UserInput): Promise<UserRecord> {
  const profile = validateProfile(users, input);
  const password = validatePassword(input.password);
  const now = nowIso();
  return {
    id: createId('usr'),
    ...profile,
    passwordHash: await hashPassword(password),
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
