/**
 * User Administration: kelola akun, peran, status aktif, dan akses project.
 * Juga menjadi satu-satunya tempat aturan "siapa boleh mengakses project mana".
 */
import type { AuthUser, UserAccount } from '@flowqa/shared';
import { HttpError, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import { hashPassword } from '../lib/password';
import type { Repositories } from '../repositories';
import type { UserRecord, UserRepository } from '../repositories/user-repository';
import { newUserRecord, validatePassword, validateProfile, type UserInput } from '../domain/user-validation';

export class UserAdminService {
  private readonly users: UserRepository;

  constructor(private readonly repos: Repositories) {
    this.users = repos.users;
  }

  /* ------------------------------ akses project ------------------------------ */

  canAccessProject(user: AuthUser, projectId: string): boolean {
    return user.role === 'admin' || this.users.hasProject(user.id, projectId);
  }

  /** Daftar project id yang boleh diakses, atau 'all' untuk admin. */
  accessibleProjectIds(user: AuthUser): string[] | 'all' {
    return user.role === 'admin' ? 'all' : this.users.projectIds(user.id);
  }

  /** Project yang dibuat member otomatis bisa diakses oleh pembuatnya. */
  grantCreator(user: AuthUser, projectId: string): void {
    if (user.role !== 'admin') this.users.addProject(user.id, projectId, nowIso());
  }

  /* -------------------------------- CRUD user -------------------------------- */

  list(): UserAccount[] {
    return this.users.list().map((u) => this.present(u));
  }

  async create(input: UserInput): Promise<UserAccount> {
    const record = await newUserRecord(this.users, input);
    const projectIds = this.validProjectIds(input.projectIds);
    this.users.save(record);
    this.users.setProjects(record.id, record.role === 'admin' ? [] : projectIds, record.createdAt);
    return this.present(record);
  }

  async update(actor: AuthUser, id: string, input: UserInput): Promise<UserAccount> {
    const existing = this.users.get(id);
    if (!existing) throw notFound('User');
    const profile = validateProfile(this.users, input, existing);

    if (actor.id === id && (profile.role !== 'admin' || !profile.active))
      throw new HttpError(400, 'You cannot remove your own admin role or disable your own account');
    const losesAdmin =
      existing.role === 'admin' && existing.active && (profile.role !== 'admin' || !profile.active);
    if (losesAdmin && this.users.countActiveAdmins() <= 1)
      throw new HttpError(400, 'Testora needs at least one active admin');

    const password = input.password ? validatePassword(input.password) : undefined;
    const now = nowIso();
    const updated: UserRecord = {
      ...existing,
      ...profile,
      passwordHash: password ? await hashPassword(password) : existing.passwordHash,
      updatedAt: now,
    };
    this.users.save(updated);
    if (input.projectIds !== undefined || profile.role === 'admin')
      this.users.setProjects(id, profile.role === 'admin' ? [] : this.validProjectIds(input.projectIds), now);
    // Password direset atau akun dinonaktifkan → keluarkan dari semua perangkat.
    if (password || !profile.active) this.users.deleteUserSessions(id);
    return this.present(updated);
  }

  delete(actor: AuthUser, id: string): void {
    const existing = this.users.get(id);
    if (!existing) throw notFound('User');
    if (actor.id === id) throw new HttpError(400, 'You cannot delete your own account');
    if (existing.role === 'admin' && existing.active && this.users.countActiveAdmins() <= 1)
      throw new HttpError(400, 'Testora needs at least one active admin');
    this.users.delete(id);
  }

  private validProjectIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const ids = [...new Set(value.filter((v): v is string => typeof v === 'string'))];
    const unknown = ids.filter((pid) => !this.repos.projects.get(pid));
    if (unknown.length) throw new HttpError(400, 'One or more selected projects no longer exist');
    return ids;
  }

  private present(user: UserRecord): UserAccount {
    const { passwordHash, ...rest } = user;
    return { ...rest, projectIds: user.role === 'admin' ? [] : this.users.projectIds(user.id) };
  }
}
