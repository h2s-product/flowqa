import { createHash, randomBytes } from 'node:crypto';
import type { AuthUser } from '@flowqa/shared';
import { HttpError } from '../lib/http';
import { nowIso } from '../lib/time';
import { hashPassword, verifyPassword } from '../lib/password';
import type { UserRecord, UserRepository } from '../repositories/user-repository';
import { newUserRecord, validatePassword } from '../domain/user-validation';
import { DAY_MS } from '../lib/time';

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_WINDOW_MS = 15 * 60_000;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const publicUser = ({ passwordHash, ...user }: UserRecord): AuthUser => user;

/**
 * Login berbasis sesi: token acak 256-bit dikirim ke browser sebagai cookie
 * HttpOnly, sedangkan database hanya menyimpan hash SHA-256-nya.
 */
export class AuthService {
  private readonly failures = new Map<string, { count: number; firstAt: number }>();
  /** Hash acak untuk menyamakan waktu respons saat email tidak terdaftar. */
  private readonly dummyHash = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly users: UserRepository,
    private readonly sessionDays: number,
    private readonly now: () => number = Date.now,
  ) {}

  get setupRequired(): boolean {
    return this.users.count() === 0;
  }

  /** Buat akun pertama. Ditolak bila sudah ada user. */
  async setup(input: { name?: unknown; email?: unknown; password?: unknown }): Promise<AuthUser> {
    if (!this.setupRequired) throw new HttpError(409, 'An account already exists. Sign in instead.');
    return this.createUser(input);
  }

  /** Buat akun admin (dipakai form setup & seed dari .env). */
  async createUser(input: { name?: unknown; email?: unknown; password?: unknown }): Promise<AuthUser> {
    const record = await newUserRecord(this.users, { ...input, role: 'admin', active: true });
    return publicUser(this.users.save(record));
  }

  /** Ganti password sendiri. Sesi di perangkat lain dikeluarkan. */
  async changePassword(
    userId: string,
    currentToken: string | undefined,
    currentPassword: unknown,
    newPassword: unknown,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new HttpError(404, 'User not found');
    if (!(await verifyPassword(String(currentPassword ?? ''), user.passwordHash)))
      throw new HttpError(400, 'Your current password is incorrect');
    const password = validatePassword(newPassword);
    this.users.save({ ...user, passwordHash: await hashPassword(password), updatedAt: nowIso() });
    this.users.deleteUserSessions(user.id, currentToken ? hashToken(currentToken) : undefined);
  }

  /** Verifikasi kredensial dan buat sesi baru. Mengembalikan token untuk cookie. */
  async login(
    emailInput: unknown,
    passwordInput: unknown,
    clientKey: string,
  ): Promise<{ user: AuthUser; token: string; maxAgeMs: number }> {
    const email = String(emailInput ?? '')
      .trim()
      .toLowerCase();
    const password = String(passwordInput ?? '');
    const key = `${clientKey}|${email}`;
    this.assertNotLocked(key);

    const user = email ? this.users.findByEmail(email) : undefined;
    const valid = user
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword(password, await this.dummyHash), false);
    if (!user || !valid) {
      this.recordFailure(key);
      throw new HttpError(401, 'Email or password is incorrect');
    }
    this.failures.delete(key);
    if (!user.active)
      throw new HttpError(403, 'This account has been disabled. Contact your Testora administrator.');

    const token = randomBytes(32).toString('base64url');
    const maxAgeMs = this.sessionDays * DAY_MS;
    this.users.deleteExpiredSessions(new Date(this.now()).toISOString());
    this.users.createSession(
      hashToken(token),
      user.id,
      new Date(this.now()).toISOString(),
      new Date(this.now() + maxAgeMs).toISOString(),
    );
    const loginAt = new Date(this.now()).toISOString();
    this.users.touchLogin(user.id, loginAt);
    return { user: publicUser({ ...user, lastLoginAt: loginAt }), token, maxAgeMs };
  }

  /** User pemilik token, atau undefined bila token tidak valid/kedaluwarsa. Sesi aktif diperpanjang. */
  authenticate(token: string | undefined): AuthUser | undefined {
    if (!token) return undefined;
    const tokenHash = hashToken(token);
    const session = this.users.findSession(tokenHash);
    if (!session) return undefined;
    const expiresAt = new Date(session.expiresAt).getTime();
    if (expiresAt <= this.now()) {
      this.users.deleteSession(tokenHash);
      return undefined;
    }
    const maxAgeMs = this.sessionDays * DAY_MS;
    // Sliding expiry: perpanjang bila sisa waktu tinggal kurang dari setengah.
    if (expiresAt - this.now() < maxAgeMs / 2)
      this.users.extendSession(tokenHash, new Date(this.now() + maxAgeMs).toISOString());
    const user = this.users.get(session.userId);
    return user?.active ? publicUser(user) : undefined;
  }

  logout(token: string | undefined): void {
    if (token) this.users.deleteSession(hashToken(token));
  }

  private assertNotLocked(key: string): void {
    const entry = this.failures.get(key);
    if (!entry) return;
    const elapsed = this.now() - entry.firstAt;
    if (elapsed > LOCKOUT_WINDOW_MS) {
      this.failures.delete(key);
      return;
    }
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
      const minutes = Math.ceil((LOCKOUT_WINDOW_MS - elapsed) / 60_000);
      throw new HttpError(
        429,
        `Too many failed attempts. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      );
    }
  }

  private recordFailure(key: string): void {
    const entry = this.failures.get(key);
    if (!entry || this.now() - entry.firstAt > LOCKOUT_WINDOW_MS)
      this.failures.set(key, { count: 1, firstAt: this.now() });
    else entry.count++;
  }
}
