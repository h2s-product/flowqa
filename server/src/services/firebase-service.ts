/**
 * Firebase App Distribution, per aplikasi Android (ProjectApp): setiap app punya
 * koneksi sendiri (project number, Android App ID, Service Account). Setiap release APK
 * baru bisa diunduh & dipasang ke emulator/HP Android — manual (tombol) atau
 * otomatis (cek berkala), lalu opsional menjalankan jadwal Test Scheduler project
 * app itu. Kunci Service Account disimpan di server saja; view ke browser hanya
 * memuat email & project-nya.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  AndroidDevice,
  FormFactor,
  ProjectApp,
  FirebaseEvent,
  FirebaseRelease,
  FirebaseSettings,
  FirebaseSettingsView,
  UploadedApk,
} from '@flowqa/shared';
import { AppDistributionClient, validateTarget, type RawRelease } from '../engine/firebase/app-distribution';
import { FirebaseError, GoogleTokenSource, parseServiceAccount } from '../engine/firebase/google-auth';
import { HttpError } from '../lib/http';
import { log } from '../lib/log';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { DeviceLockManager } from './device-lock-manager';
import type { AndroidProbe } from './mobile-driver-provider';
import type { UiScheduleService } from './ui-schedule-service';

/** Koneksi & status per app Android (ProjectApp). */
export const firebaseKey = (appId: string) => `firebase:app:${appId}`;
export const firebaseStateKey = (appId: string) => `firebase-state:app:${appId}`;
const MAX_EVENTS = 30;
const MIN_INTERVAL = 5;
const MAX_INTERVAL = 24 * 60;

const EMPTY: FirebaseSettings = {
  projectNumber: '',
  appId: '',
  serviceAccount: '',
  autoInstall: false,
  intervalMinutes: 15,
  installMode: 'emulator',
  udid: '',
  runSchedule: false,
  scheduleId: '',
};

interface FirebaseState {
  lastSeenRelease: string;
  lastCheckAt: string;
  events: FirebaseEvent[];
}

export interface FirebaseServiceDeps {
  repos: Repositories;
  apkDir: () => string;
  locks: DeviceLockManager;
  probe: AndroidProbe;
  schedules: () => UiScheduleService;
  /** Hanya untuk test: server Google/Firebase tiruan. */
  apiBase?: string;
}

/**
 * Nama file APK dari release: firebase-<versi>-<build>-<id release>.apk. Id release ikut
 * dipakai karena tim sering mengunggah build baru dengan nomor versi yang sama
 * (mis. selalu "1.0 (1)"); tanpa id, build baru dianggap sudah diunduh.
 */
const apkName = (r: Pick<RawRelease, 'displayVersion' | 'buildVersion' | 'id'>) =>
  `firebase-${`${r.displayVersion || 'v'}-${r.buildVersion || 'b'}-${r.id}`.replace(/[^\w.-]+/g, '_')}.apk`;

export class FirebaseDistributionService {
  /** Token Google per app (Service Account berbeda tiap app). */
  private readonly tokens = new Map<string, GoogleTokenSource>();
  private readonly clients = new Map<string, AppDistributionClient>();
  private readonly timer: NodeJS.Timeout;
  private readonly busy = new Map<string, Promise<FirebaseEvent>>();

  constructor(private readonly deps: FirebaseServiceDeps) {
    // Cek setiap menit apakah pengecekan berkala suatu project sudah jatuh tempo.
    this.timer = setInterval(() => void this.tick().catch(() => {}), 60_000);
    this.timer.unref();
  }

  close() {
    clearInterval(this.timer);
  }

  private tokenSource(appId: string): GoogleTokenSource {
    let source = this.tokens.get(appId);
    if (!source) this.tokens.set(appId, (source = new GoogleTokenSource()));
    return source;
  }

  private client(appId: string): AppDistributionClient {
    let client = this.clients.get(appId);
    if (!client)
      this.clients.set(
        appId,
        (client = new AppDistributionClient(this.tokenSource(appId), this.deps.apiBase)),
      );
    return client;
  }

  /* ------------------------------ settings ------------------------------ */

  private stored(appId: string): FirebaseSettings {
    return {
      ...EMPTY,
      ...(this.deps.repos.settings.get<Partial<FirebaseSettings>>(firebaseKey(appId)) ?? {}),
    };
  }

  private state(appId: string): FirebaseState {
    return {
      lastSeenRelease: '',
      lastCheckAt: '',
      events: [],
      ...(this.deps.repos.settings.get<Partial<FirebaseState>>(firebaseStateKey(appId)) ?? {}),
    };
  }

  private setState(appId: string, patch: Partial<FirebaseState>) {
    this.deps.repos.settings.set(firebaseStateKey(appId), { ...this.state(appId), ...patch });
  }

  view(appId: string): FirebaseSettingsView {
    const { serviceAccount, ...settings } = this.stored(appId);
    let email = '';
    let project = '';
    try {
      if (serviceAccount) {
        const key = JSON.parse(serviceAccount) as { client_email?: string; project_id?: string };
        email = key.client_email ?? '';
        project = key.project_id ?? '';
      }
    } catch {
      /* kunci rusak: dianggap belum ada */
    }
    const state = this.state(appId);
    return {
      ...settings,
      serviceAccountEmail: email,
      serviceAccountProject: project,
      keySet: !!serviceAccount,
      configured: !!(serviceAccount && settings.projectNumber && settings.appId),
      lastCheck: state.events.find((e) => e.kind === 'check' || e.kind === 'error') ?? null,
      lastSeenRelease: state.lastSeenRelease,
    };
  }

  events(appId: string): FirebaseEvent[] {
    return this.state(appId).events;
  }

  /** Simpan dari form. Key kosong = pertahankan key yang tersimpan. */
  save(appId: string, input: Partial<FirebaseSettings>): FirebaseSettingsView {
    this.app(appId);
    const previous = this.stored(appId);
    const text = (v: unknown) => String(v ?? '').trim();
    const serviceAccount = text(input.serviceAccount) || previous.serviceAccount;
    if (serviceAccount) {
      try {
        parseServiceAccount(serviceAccount);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    }
    const next: FirebaseSettings = {
      projectNumber: text(input.projectNumber ?? previous.projectNumber),
      appId: text(input.appId ?? previous.appId),
      serviceAccount,
      autoInstall: typeof input.autoInstall === 'boolean' ? input.autoInstall : previous.autoInstall,
      intervalMinutes: Math.min(
        Math.max(Math.round(Number(input.intervalMinutes ?? previous.intervalMinutes) || 15), MIN_INTERVAL),
        MAX_INTERVAL,
      ),
      installMode:
        input.installMode === 'device'
          ? 'device'
          : input.installMode === 'emulator'
            ? 'emulator'
            : previous.installMode,
      udid: text(input.udid ?? previous.udid),
      runSchedule: typeof input.runSchedule === 'boolean' ? input.runSchedule : previous.runSchedule,
      scheduleId: text(input.scheduleId ?? previous.scheduleId),
    };
    if (next.projectNumber || next.appId) {
      try {
        validateTarget(next.projectNumber, next.appId);
      } catch (error) {
        throw new HttpError(400, (error as Error).message);
      }
    }
    if (
      next.runSchedule &&
      this.deps.repos.uiSchedules.get(next.scheduleId)?.projectId !== this.app(appId).projectId
    )
      throw new HttpError(
        400,
        'Choose the Test Scheduler schedule (of this project) to run after installing.',
      );
    if (next.autoInstall && !(next.serviceAccount && next.projectNumber && next.appId))
      throw new HttpError(400, 'Connect Firebase first (service account key, project number and App ID).');
    if (next.serviceAccount !== previous.serviceAccount) this.tokenSource(appId).reset();
    this.deps.repos.settings.set(firebaseKey(appId), next);
    return this.view(appId);
  }

  /** Hapus koneksi Firebase app ini (key ikut dihapus). */
  reset(appId: string): FirebaseSettingsView {
    this.deps.repos.settings.delete(firebaseKey(appId));
    this.tokenSource(appId).reset();
    return this.view(appId);
  }

  /** App / project dihapus: koneksi, riwayat & token ikut dibuang. */
  forget(appId: string) {
    this.deps.repos.settings.delete(firebaseKey(appId));
    this.deps.repos.settings.delete(firebaseStateKey(appId));
    this.tokens.delete(appId);
    this.clients.delete(appId);
  }

  private connection(appId: string) {
    const settings = this.stored(appId);
    if (!settings.serviceAccount || !settings.projectNumber || !settings.appId)
      throw new HttpError(
        400,
        `Connect Firebase for "${this.deps.repos.apps.get(appId)?.name ?? 'this app'}" first: upload its service account key and enter the project number and App ID (Apps → the app → Firebase).`,
      );
    return { settings, key: parseServiceAccount(settings.serviceAccount) };
  }

  private event(appId: string, kind: FirebaseEvent['kind'], ok: boolean, message: string, release?: string) {
    const events = [
      { at: nowIso(), kind, ok, message, ...(release ? { release } : {}) },
      ...this.state(appId).events,
    ].slice(0, MAX_EVENTS);
    this.setState(appId, { events });
    const app = this.deps.repos.apps.get(appId)?.name ?? appId;
    (ok ? log.info : log.warn)(`[firebase] ${app}: ${message}`);
  }

  /* ------------------------------ releases ------------------------------ */

  private async rawReleases(appId: string): Promise<RawRelease[]> {
    const { settings, key } = this.connection(appId);
    return this.client(appId)
      .releases(key, settings.projectNumber, settings.appId)
      .catch((error) => {
        throw error instanceof FirebaseError ? new HttpError(502, error.message) : error;
      });
  }

  private present(r: RawRelease): FirebaseRelease {
    const file = path.join(this.deps.apkDir(), apkName(r));
    const { downloadUri: _uri, ...release } = r;
    return { ...release, downloaded: fs.existsSync(file), ...(fs.existsSync(file) ? { apkPath: file } : {}) };
  }

  async releases(appId: string): Promise<FirebaseRelease[]> {
    return (await this.rawReleases(appId)).map((r) => this.present(r));
  }

  /** Test connection: token + daftar release. */
  async test(
    appId: string,
    input?: Partial<FirebaseSettings>,
  ): Promise<{ ok: boolean; message: string; latest?: FirebaseRelease }> {
    try {
      const stored = this.stored(appId);
      const serviceAccount = String(input?.serviceAccount ?? '').trim() || stored.serviceAccount;
      const projectNumber = String(input?.projectNumber ?? stored.projectNumber).trim();
      const firebaseAppId = String(input?.appId ?? stored.appId).trim();
      if (!serviceAccount) return { ok: false, message: 'Upload the service account key (JSON) first.' };
      const key = parseServiceAccount(serviceAccount);
      // Key baru dari form: token sementara, supaya token app yang tersimpan tidak tertukar.
      const client =
        serviceAccount === stored.serviceAccount
          ? this.client(appId)
          : new AppDistributionClient(new GoogleTokenSource(), this.deps.apiBase);
      const releases = await client.releases(key, projectNumber, firebaseAppId, 1);
      const latest = releases[0] ? this.present(releases[0]) : undefined;
      return {
        ok: true,
        message: latest
          ? `Connected as ${key.client_email}. Latest release: ${latest.displayVersion} (${latest.buildVersion}).`
          : `Connected as ${key.client_email}, but this app has no releases yet.`,
        latest,
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  private async resolveRelease(appId: string, id: string): Promise<RawRelease> {
    const releases = await this.rawReleases(appId);
    const release = id === 'latest' ? releases[0] : releases.find((r) => r.id === id || r.name === id);
    if (!release)
      throw new HttpError(
        404,
        id === 'latest' ? 'This app has no releases in Firebase yet.' : 'Release not found in Firebase.',
      );
    return release;
  }

  /** Unduh APK release ke folder APK Testora (dilewati bila sudah ada). */
  async download(appId: string, id: string): Promise<UploadedApk & { release: string }> {
    const release = await this.resolveRelease(appId, id);
    const label = `${release.displayVersion} (${release.buildVersion})`;
    const file = path.join(this.deps.apkDir(), apkName(release));
    if (!fs.existsSync(file)) {
      try {
        const data = await this.client(appId).download(release.downloadUri);
        fs.mkdirSync(this.deps.apkDir(), { recursive: true });
        fs.writeFileSync(file, data);
        this.event(
          appId,
          'download',
          true,
          `Downloaded ${label} (${(data.length / 1024 / 1024).toFixed(1)} MB)`,
          label,
        );
      } catch (error) {
        this.event(appId, 'error', false, `Download of ${label} failed: ${(error as Error).message}`, label);
        throw new HttpError(502, (error as Error).message);
      }
    }
    return {
      name: path.basename(file),
      path: file,
      size: fs.statSync(file).size,
      uploadedAt: nowIso(),
      release: label,
    };
  }

  /** Path APK release terbaru app ini (diunduh bila perlu) — untuk "firebase:latest". */
  async latestApk(appId: string): Promise<string> {
    return (await this.download(appId, 'latest')).path;
  }

  /**
   * Pilih perangkat tujuan: serial tertentu, atau yang pertama siap untuk mode itu
   * dan jenis perangkat app (phone / tablet; perangkat yang jenisnya tak terdeteksi tetap boleh).
   */
  private async target(
    mode: 'emulator' | 'device',
    udid: string,
    formFactor: FormFactor | '',
  ): Promise<AndroidDevice> {
    const devices = await this.deps.probe.devices(this.deps.locks.busyIds());
    const pick = devices.filter(
      (d) =>
        !d.id.startsWith('avd:') &&
        (udid
          ? d.id === udid
          : d.type === mode && (!formFactor || !d.formFactor || d.formFactor === formFactor)) &&
        (d.status === 'CONNECTED' || d.status === 'BUSY'),
    );
    const what =
      `${mode === 'device' ? 'Android' : 'emulator'} ${formFactor || (mode === 'device' ? 'phone' : '')}`.trim();
    if (!pick.length)
      throw new HttpError(
        409,
        udid
          ? `The device ${udid} is not connected.`
          : mode === 'device'
            ? `No ${what === 'Android' ? 'Android phone' : what} is connected. Plug it in over USB with USB debugging on.`
            : `No ${what} is running. Start one in Settings → Mobile (Android) → Devices.`,
      );
    return pick[0];
  }

  /** Unduh (bila perlu) lalu pasang release ke perangkat. Perangkat dikunci selama pemasangan. */
  async install(
    appId: string,
    id: string,
    input: { mode?: unknown; udid?: unknown } = {},
  ): Promise<{ release: string; device: string }> {
    const settings = this.stored(appId);
    const mode =
      input.mode === 'device' ? 'device' : input.mode === 'emulator' ? 'emulator' : settings.installMode;
    const udid = typeof input.udid === 'string' ? input.udid : input.mode ? '' : settings.udid;
    const apk = await this.download(appId, id);
    const device = await this.target(mode, udid, this.app(appId).android?.formFactor ?? '');
    const lease = await this.deps.locks.acquire([device.id], `Firebase install ${apk.release}`);
    try {
      await this.deps.probe.installApk(device.id, apk.path);
      this.event(
        appId,
        'install',
        true,
        `Installed ${apk.release} on ${device.name} (${device.id})`,
        apk.release,
      );
      return { release: apk.release, device: `${device.name} (${device.id})` };
    } catch (error) {
      this.event(
        appId,
        'error',
        false,
        `Install of ${apk.release} on ${device.name} failed: ${(error as Error).message}`,
        apk.release,
      );
      throw new HttpError(502, (error as Error).message);
    } finally {
      lease.release();
    }
  }

  /* ------------------------------ otomatis ------------------------------ */

  private async tick() {
    for (const app of this.deps.repos.apps.list()) {
      if (app.platform !== 'android') continue;
      const settings = this.stored(app.id);
      if (!settings.autoInstall || this.busy.has(app.id)) continue;
      const last = this.state(app.id).lastCheckAt;
      if (last && Date.now() - new Date(last).getTime() < settings.intervalMinutes * 60_000) continue;
      await this.checkNow(app.id).catch(() => {});
    }
  }

  /** App Android pemilik koneksi. */
  private app(appId: string): ProjectApp {
    const app = this.deps.repos.apps.get(appId);
    if (!app || app.platform !== 'android') throw new HttpError(404, 'Android app not found');
    return app;
  }

  /**
   * Cek release baru sekarang. Release baru → unduh → pasang → (opsional)
   * jalankan jadwal. Release pertama yang terlihat setelah koneksi dibuat juga
   * diproses, supaya perangkat langsung memakai versi terbaru.
   */
  checkNow(appId: string): Promise<FirebaseEvent> {
    const running = this.busy.get(appId);
    if (running) return running;
    const latestEvent = () => this.state(appId).events[0];
    const job = (async (): Promise<FirebaseEvent> => {
      this.setState(appId, { lastCheckAt: nowIso() });
      const settings = this.stored(appId);
      let latest: RawRelease | undefined;
      try {
        latest = (await this.rawReleases(appId))[0];
      } catch (error) {
        this.event(appId, 'error', false, `Checking Firebase failed: ${(error as Error).message}`);
        return latestEvent();
      }
      if (!latest) {
        this.event(appId, 'check', true, 'No releases in Firebase yet.');
        return latestEvent();
      }
      const label = `${latest.displayVersion} (${latest.buildVersion})`;
      if (latest.name === this.state(appId).lastSeenRelease) {
        this.event(appId, 'check', true, `No new release. Latest is still ${label}.`, label);
        return latestEvent();
      }
      this.event(appId, 'check', true, `New release found: ${label}.`, label);
      try {
        await this.install(appId, latest.id, { mode: settings.installMode, udid: settings.udid });
      } catch {
        // Dicatat oleh install(); release belum ditandai "terlihat" supaya dicoba lagi berikutnya.
        return latestEvent();
      }
      this.setState(appId, { lastSeenRelease: latest.name });
      if (settings.runSchedule) {
        const schedule = this.deps.repos.uiSchedules.get(settings.scheduleId);
        if (!schedule || schedule.projectId !== this.app(appId).projectId)
          this.event(appId, 'error', false, 'The schedule to run after installing no longer exists.', label);
        else
          try {
            const { queued } = this.deps.schedules().run(schedule, { mode: settings.installMode });
            this.event(
              appId,
              'schedule',
              true,
              `Started "${schedule.name}" (${queued} test${queued === 1 ? '' : 's'}) on ${label}.`,
              label,
            );
          } catch (error) {
            this.event(
              appId,
              'error',
              false,
              `Could not start "${schedule.name}": ${(error as Error).message}`,
              label,
            );
          }
      }
      return latestEvent();
    })().finally(() => {
      this.busy.delete(appId);
    });
    this.busy.set(appId, job);
    return job;
  }
}
