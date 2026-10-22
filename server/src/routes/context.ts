import type { Response } from 'express';
import type { ApiDefinition, AuthUser, Scenario, UiTestCase } from '@flowqa/shared';
import type { Repositories } from '../repositories';
import type { FolderService } from '../services/folder-service';
import type { AuthService } from '../services/auth-service';
import type { DeletionService } from '../services/deletion-service';
import type { NotificationService } from '../services/notification-service';
import type { MobileInspectorService } from '../services/mobile-inspector-service';
import type { FlowRunService } from '../services/flow-run-service';
import type { FirebaseDistributionService } from '../services/firebase-service';
import type { AppService } from '../services/app-service';
import type { DeviceLockManager } from '../services/device-lock-manager';
import type { AndroidService } from '../services/android-service';
import type { AppiumSettingsService } from '../services/appium-settings-service';
import type { EmailSettingsService } from '../services/email-settings-service';
import type { PerfService } from '../services/perf-service';
import type { RunService } from '../services/run-service';
import type { UiRecorderService } from '../services/ui-recorder-service';
import type { UiRunService } from '../services/ui-run-service';
import type { UiScheduleService } from '../services/ui-schedule-service';
import type { UserAdminService } from '../services/user-admin-service';
import { HttpError, notFound } from '../lib/http';

/** Dependensi yang dibagikan ke semua router. */
export interface AppContext {
  repos: Repositories;
  notifications: NotificationService;
  emailSettings: EmailSettingsService;
  appium: AppiumSettingsService;
  android: AndroidService;
  deviceLocks: DeviceLockManager;
  firebase: FirebaseDistributionService;
  apps: AppService;
  flowRuns: FlowRunService;
  runs: RunService;
  perf: PerfService;
  auth: AuthService;
  users: UserAdminService;
  apiFolders: FolderService<ApiDefinition>;
  scenarioFolders: FolderService<Scenario>;
  uiFolders: FolderService<UiTestCase>;
  uiRuns: UiRunService;
  uiSchedules: UiScheduleService;
  recorder: UiRecorderService;
  inspector: MobileInspectorService;
  deletion: DeletionService;
}

/** User yang sedang login (diisi middleware requireAuth). */
export function currentUser(res: Response): AuthUser {
  const user = res.locals.user as AuthUser | undefined;
  if (!user) throw new HttpError(401, 'Please sign in to continue');
  return user;
}

/**
 * Ambil project dan pastikan user yang login boleh mengaksesnya.
 * Project tanpa akses dilaporkan "not found" agar keberadaannya tidak bocor.
 */
export function requireProject(ctx: AppContext, res: Response, projectId: string) {
  const project = ctx.repos.projects.get(projectId);
  if (!project || !ctx.users.canAccessProject(currentUser(res), projectId)) throw notFound('Project');
  return project;
}

/** Pastikan entitas ada dan project pemiliknya boleh diakses user. */
export function requireOwned<T extends { projectId: string }>(
  ctx: AppContext,
  res: Response,
  entity: T | undefined,
  what: string,
): T {
  if (!entity || !ctx.users.canAccessProject(currentUser(res), entity.projectId)) throw notFound(what);
  return entity;
}

export function requireAdmin(res: Response): AuthUser {
  const user = currentUser(res);
  if (user.role !== 'admin') throw new HttpError(403, 'Only administrators can do this');
  return user;
}
