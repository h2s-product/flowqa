/**
 * Merakit semua service yang dibagikan ke router (AppContext) dari repositori.
 * Dipakai oleh bootstrap server (index.ts) dan oleh test, sehingga service baru
 * cukup didaftarkan di satu tempat.
 */
import { config } from './config';
import type { HttpClient } from './engine/http-client';
import { log } from './lib/log';
import type { Mailer } from './lib/mailer';
import { AppiumServerManager } from './engine/android/appium-server';
import { AndroidService } from './services/android-service';
import { AppiumSettingsService } from './services/appium-settings-service';
import { DeviceLockManager } from './services/device-lock-manager';
import { MobileProviders, realAndroidProbe, type AndroidProbe } from './services/mobile-driver-provider';
import { FirebaseDistributionService } from './services/firebase-service';
import { AppService } from './services/app-service';
import { FlowRunService } from './services/flow-run-service';
import { androidApkDir } from './services/android-service';
import { EmailSettingsService, type MailProvider } from './services/email-settings-service';
import { MobileInspectorService } from './services/mobile-inspector-service';
import { NotificationService } from './services/notification-service';
import type { Repositories } from './repositories';
import type { AppContext } from './routes/context';
import { AuthService } from './services/auth-service';
import { DeletionService } from './services/deletion-service';
import { FolderService } from './services/folder-service';
import { PerfService } from './services/perf-service';
import { RunService } from './services/run-service';
import { UiRecorderService } from './services/ui-recorder-service';
import { UiRunService } from './services/ui-run-service';
import { UiScheduleService } from './services/ui-schedule-service';
import { UserAdminService } from './services/user-admin-service';

/**
 * `mailer` hanya untuk test (mailer palsu / null). Tanpa itu, email memakai
 * Settings → Email Report, atau .env bila belum diatur di aplikasi.
 */
export function createAppContext(
  repos: Repositories,
  http: HttpClient,
  mailer?: Mailer | null,
  /** Hanya untuk test: perangkat Android tiruan. */
  androidProbe?: AndroidProbe,
  /** Hanya untuk test: server Firebase App Distribution tiruan. */
  firebaseApiBase?: string,
): AppContext {
  const uiFolders = new FolderService(repos.uiFolders, repos.uiTests, 'UI test');
  const emailSettings = new EmailSettingsService(repos.settings, {
    smtp: config.mail,
    appUrl: config.appUrl,
  });
  const mail: MailProvider =
    mailer === undefined
      ? emailSettings
      : {
          mailer: () => mailer,
          appUrl: () => config.appUrl,
          defaultRecipients: () => emailSettings.defaultRecipients(),
        };
  const notifications = new NotificationService(repos, mail);
  const runs = new RunService(repos, http, notifications);
  const appium = new AppiumSettingsService(repos.settings);
  // Android: satu perangkat = satu sesi; provider Mock / Emulator / HP memakai kunci yang sama.
  const deviceLocks = new DeviceLockManager();
  const appiumServer = new AppiumServerManager();
  const probe = androidProbe ?? realAndroidProbe;
  // Firebase App Distribution: APK terbaru bisa dipakai test lewat "firebase:latest".
  let uiSchedules: UiScheduleService;
  const firebase = new FirebaseDistributionService({
    repos,
    apkDir: () => androidApkDir(),
    locks: deviceLocks,
    probe,
    schedules: () => uiSchedules,
    apiBase: firebaseApiBase ?? process.env.FLOWQA_FIREBASE_API,
  });
  const mobileProviders = new MobileProviders(appium, appiumServer, deviceLocks, probe, (appId) =>
    firebase.latestApk(appId),
  );
  // App per project (Android / Web): Firebase, phone/tablet, mode & serial bawaan.
  const apps = new AppService(repos, appium, firebase);
  apps.migrate();
  const uiRuns = new UiRunService(
    repos,
    notifications,
    (request) => runs.runEmbedded(request),
    appium,
    mobileProviders,
    apps,
  );
  const inspector = new MobileInspectorService(repos, uiFolders, appium, mobileProviders, apps);
  const android = new AndroidService(appium, appiumServer, deviceLocks, mobileProviders);
  // Force stop emulator: hentikan dulu test / inspector yang sedang memakainya.
  android.describeDeviceUser = (owner) => {
    const run = /^UI run (uir_\w+)$/.exec(owner)?.[1];
    if (run) return `UI test "${repos.uiRuns.get(run)?.testName ?? run}"`;
    if (/^Mobile Inspector /.test(owner)) return 'the Mobile Inspector';
    return owner;
  };
  android.stopDeviceUser = async (owner, stoppedBy) => {
    const run = /^UI run (uir_\w+)$/.exec(owner)?.[1];
    if (run) {
      try {
        uiRuns.stop(run, stoppedBy);
      } catch {
        return; // sudah selesai
      }
      // Tunggu run selesai menutup sesinya (maks. 15 detik), lalu emulator dimatikan.
      await Promise.race([uiRuns.wait(run), new Promise((r) => setTimeout(r, 15_000))]);
      return;
    }
    const session = /^Mobile Inspector (mob_\w+)$/.exec(owner)?.[1];
    if (session) await Promise.race([inspector.stop(session), new Promise((r) => setTimeout(r, 15_000))]);
  };
  return {
    repos,
    notifications,
    emailSettings,
    appium,
    android,
    /** Satu perangkat = satu sesi (antrean QUEUED). */
    deviceLocks,
    runs,
    perf: new PerfService(repos, http, notifications),
    auth: new AuthService(repos.users, config.sessionDays),
    users: new UserAdminService(repos),
    apiFolders: new FolderService(repos.apiFolders, repos.apis, 'API'),
    scenarioFolders: new FolderService(repos.scenarioFolders, repos.scenarios, 'scenario'),
    uiFolders,
    uiRuns,
    uiSchedules: (uiSchedules = new UiScheduleService(repos, uiRuns)),
    firebase,
    apps,
    flowRuns: new FlowRunService(repos, uiRuns, runs, notifications),
    recorder: new UiRecorderService(repos, uiFolders),
    inspector,
    deletion: new DeletionService(repos, (_projectId, appIds) => apps.forgetProject(appIds)),
  };
}

/** Run yang masih "running" saat server terakhir mati diberi status akhir. */
export function recoverInterruptedRuns(repos: Repositories): void {
  const reason = 'The server stopped before this run finished.';
  const counts = [
    ['API run(s) marked as failed', repos.runs.markInterrupted('failed', reason)],
    ['performance run(s) marked as stopped', repos.perfRuns.markInterrupted('stopped', reason)],
    ['UI run(s) marked as failed', repos.uiRuns.markInterrupted('failed', reason, ['running', 'queued'])],
    ['E2E flow run(s) marked as failed', repos.flowRuns.markInterrupted('failed', reason)],
  ] as const;
  for (const [label, count] of counts) if (count) log.info(`${count} interrupted ${label}`);
}
