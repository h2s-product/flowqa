import type { AuthUser, UserRole } from '@flowqa/shared';
import type { Database } from '../db/database';

interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  active: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRecord = AuthUser & { passwordHash: string };

const toRecord = (row: UserRow): UserRecord => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.password_hash,
  role: row.role === 'admin' ? 'admin' : 'member',
  active: row.active === 1,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Akses tabel users, sessions & project_members. Hash password tidak pernah keluar dari layer server. */
export class UserRepository {
  constructor(private readonly db: Database) {}

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  countActiveAdmins(): number {
    return (
      this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1`).get() as {
        n: number;
      }
    ).n;
  }

  list(): UserRecord[] {
    return (
      this.db.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all() as unknown as UserRow[]
    ).map(toRecord);
  }

  findByEmail(email: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  get(id: string): UserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  /** Insert atau update user. */
  save(user: UserRecord): UserRecord {
    this.db
      .prepare(
        `INSERT INTO users (id, email, name, password_hash, role, active, last_login_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
           password_hash = excluded.password_hash, role = excluded.role, active = excluded.active,
           last_login_at = excluded.last_login_at, updated_at = excluded.updated_at`,
      )
      .run(
        user.id,
        user.email,
        user.name,
        user.passwordHash,
        user.role satisfies UserRole,
        user.active ? 1 : 0,
        user.lastLoginAt,
        user.createdAt,
        user.updatedAt,
      );
    return user;
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM users WHERE id = ?').run(id).changes) > 0;
  }

  touchLogin(id: string, at: string): void {
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(at, id);
  }

  /* ----------------------------- project access ----------------------------- */

  projectIds(userId: string): string[] {
    return (
      this.db
        .prepare('SELECT project_id FROM project_members WHERE user_id = ? ORDER BY created_at')
        .all(userId) as { project_id: string }[]
    ).map((r) => r.project_id);
  }

  hasProject(userId: string, projectId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM project_members WHERE user_id = ? AND project_id = ?')
      .get(userId, projectId);
  }

  /** Ganti seluruh daftar project milik user (dalam satu transaksi). */
  setProjects(userId: string, projectIds: string[], at: string): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM project_members WHERE user_id = ?').run(userId);
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO project_members (project_id, user_id, created_at) VALUES (?, ?, ?)',
      );
      projectIds.forEach((projectId) => insert.run(projectId, userId, at));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  addProject(userId: string, projectId: string, at: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO project_members (project_id, user_id, created_at) VALUES (?, ?, ?)')
      .run(projectId, userId, at);
  }

  /* -------------------------------- sessions -------------------------------- */

  createSession(tokenHash: string, userId: string, createdAt: string, expiresAt: string): void {
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, createdAt, expiresAt);
  }

  findSession(tokenHash: string): { userId: string; expiresAt: string } | undefined {
    const row = this.db
      .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
      .get(tokenHash) as { user_id: string; expires_at: string } | undefined;
    return row ? { userId: row.user_id, expiresAt: row.expires_at } : undefined;
  }

  extendSession(tokenHash: string, expiresAt: string): void {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  /** Keluarkan user dari semua perangkat, kecuali sesi `keepTokenHash` (bila diisi). */
  deleteUserSessions(userId: string, keepTokenHash?: string): void {
    this.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
      .run(userId, keepTokenHash ?? '');
  }

  deleteExpiredSessions(nowIso: string): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  }
}
