/**
 * Firebase App Distribution: setiap release APK baru bisa diunduh & dipasang
 * ke emulator/HP Android — manual (tombol) atau otomatis (cek berkala), lalu
 * opsional menjalankan jadwal Test Scheduler. Kunci Service Account disimpan
 * di server saja; view ke browser hanya memuat email & project-nya.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  AndroidDevice,
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

const KEY = 'firebase';
const STATE_KEY = 'firebase-state';
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
  private readonly tokens = new GoogleTokenSource();
  private readonly client: AppDistributionClient;
  private readonly timer: NodeJS.Timeout;
  private busy: Promise<unknown> | null = null;

  constructor(private readonly deps: FirebaseServiceDeps) {
    this.client = new AppDistributionClient(this.tokens, deps.apiBase);
    // Cek setiap menit apakah pengecekan berkala sudah jatuh tempo.
    this.timer = setInterval(() => void this.tick().catch(() => {}), 60_000);
    this.timer.unref();
  }

  close() {
    clearInterval(this.timer);
  }

  /* ------------------------------ settings ------------------------------ */

  private stored(): FirebaseSettings {
    return { ...EMPTY, ...(this.deps.repos.settings.get<Partial<FirebaseSettings>>(KEY) ?? {}) };
  }

  private state(): FirebaseState {
    return {
      lastSeenRelease: '',
      lastCheckAt: '',
      events: [],
      ...(this.deps.repos.settings.get<Partial<FirebaseState>>(STATE_KEY) ?? {}),
    };
  }

  private setState(patch: Partial<FirebaseState>) {
    this.deps.repos.settings.set(STATE_KEY, { ...this.state(), ...patch });
  }

  view(): FirebaseSettingsView {
    const { serviceAccount, ...settings } = this.stored();
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
    const state = this.state();
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

  events(): FirebaseEvent[] {
    return this.state().events;
  }

  /** Simpan dari form. Key kosong = pertahankan key yang tersimpan. */
  save(input: Partial<FirebaseSettings>): FirebaseSettingsView {
    const previous = this.stored();
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
    if (next.runSchedule && !this.deps.repos.uiSchedules.get(next.scheduleId))
      throw new HttpError(400, 'Choose the Test Scheduler schedule to run after installing.');
    if (next.autoInstall && !(next.serviceAccount && next.projectNumber && next.appId))
      throw new HttpError(400, 'Connect Firebase first (service account key, project number and App ID).');
    if (next.serviceAccount !== previous.serviceAccount) this.tokens.reset();
    this.deps.repos.settings.set(KEY, next);
    return this.view();
  }

  /** Hapus koneksi Firebase (key ikut dihapus). */
  reset(): FirebaseSettingsView {
    this.deps.repos.settings.delete(KEY);
    this.tokens.reset();
    return this.view();
  }

  private connection() {
    const settings = this.stored();
    if (!settings.serviceAccount || !settings.projectNumber || !settings.appId)
      throw new HttpError(
        400,
        'Connect Firebase first: upload the service account key and enter the project number and App ID.',
      );
    return { settings, key: parseServiceAccount(settings.serviceAccount) };
  }

  private event(kind: FirebaseEvent['kind'], ok: boolean, message: string, release?: string) {
    const events = [
      { at: nowIso(), kind, ok, message, ...(release ? { release } : {}) },
      ...this.state().events,
    ].slice(0, MAX_EVENTS);
    this.setState({ events });
    (ok ? log.info : log.warn)(`[firebase] ${message}`);
  }

  /* ------------------------------ releases ------------------------------ */

  private async rawReleases(): Promise<RawRelease[]> {
    const { settings, key } = this.connection();
    return this.client.releases(key, settings.projectNumber, settings.appId).catch((error) => {
      throw error instanceof FirebaseError ? new HttpError(502, error.message) : error;
    });
  }

  private present(r: RawRelease): FirebaseRelease {
    const file = path.join(this.deps.apkDir(), apkName(r));
    const { downloadUri: _uri, ...release } = r;
    return { ...release, downloaded: fs.existsSync(file), ...(fs.existsSync(file) ? { apkPath: file } : {}) };
  }

  async releases(): Promise<FirebaseRelease[]> {
    return (await this.rawReleases()).map((r) => this.present(r));
  }

  /** Test connection: token + daftar release. */
  async test(
    input?: Partial<FirebaseSettings>,
  ): Promise<{ ok: boolean; message: string; latest?: FirebaseRelease }> {
    try {
      const stored = this.stored();
      const serviceAccount = String(input?.serviceAccount ?? '').trim() || stored.serviceAccount;
      const projectNumber = String(input?.projectNumber ?? stored.projectNumber).trim();
      const appId = String(input?.appId ?? stored.appId).trim();
      if (!serviceAccount) return { ok: false, message: 'Upload the service account key (JSON) first.' };
      const key = parseServiceAccount(serviceAccount);
      const releases = await this.client.releases(key, projectNumber, appId, 1);
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

  private async resolveRelease(id: string): Promise<RawRelease> {
    const releases = await this.rawReleases();
    const release = id === 'latest' ? releases[0] : releases.find((r) => r.id === id || r.name === id);
    if (!release)
      throw new HttpError(
        404,
        id === 'latest' ? 'This app has no releases in Firebase yet.' : 'Release not found in Firebase.',
      );
    return release;
  }

  /** Unduh APK release ke folder APK Testora (dilewati bila sudah ada). */
  async download(id: string): Promise<UploadedApk & { release: string }> {
    const release = await this.resolveRelease(id);
    const label = `${release.displayVersion} (${release.buildVersion})`;
    const file = path.join(this.deps.apkDir(), apkName(release));
    if (!fs.existsSync(file)) {
      try {
        const data = await this.client.download(release.downloadUri);
        fs.mkdirSync(this.deps.apkDir(), { recursive: true });
        fs.writeFileSync(file, data);
        this.event(
          'download',
          true,
          `Downloaded ${label} (${(data.length / 1024 / 1024).toFixed(1)} MB)`,
          label,
        );
      } catch (error) {
        this.event('error', false, `Download of ${label} failed: ${(error as Error).message}`, label);
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

  /** Path APK release terbaru (diunduh bila perlu) — untuk "firebase:latest". */
  async latestApk(): Promise<string> {
    return (await this.download('latest')).path;
  }

  /** Pilih perangkat tujuan: serial tertentu, atau yang pertama siap untuk mode itu. */
  private async target(mode: 'emulator' | 'device', udid: string): Promise<AndroidDevice> {
    const devices = await this.deps.probe.devices(this.deps.locks.busyIds());
    const pick = devices.filter(
      (d) =>
        !d.id.startsWith('avd:') &&
        (udid ? d.id === udid : d.type === mode) &&
        (d.status === 'CONNECTED' || d.status === 'BUSY'),
    );
    if (!pick.length)
      throw new HttpError(
        409,
        udid
          ? `The device ${udid} is not connected.`
          : `No ${mode === 'device' ? 'Android phone is connected' : 'Android emulator is running'}. Start one in Settings → Mobile (Android) → Devices.`,
      );
    return pick[0];
  }

  /** Unduh (bila perlu) lalu pasang release ke perangkat. Perangkat dikunci selama pemasangan. */
  async install(
    id: string,
    input: { mode?: unknown; udid?: unknown } = {},
  ): Promise<{ release: string; device: string }> {
    const settings = this.stored();
    const mode =
      input.mode === 'device' ? 'device' : input.mode === 'emulator' ? 'emulator' : settings.installMode;
    const udid = typeof input.udid === 'string' ? input.udid : input.mode ? '' : settings.udid;
    const apk = await this.download(id);
    const device = await this.target(mode, udid);
    const lease = await this.deps.locks.acquire([device.id], `Firebase install ${apk.release}`);
    try {
      await this.deps.probe.installApk(device.id, apk.path);
      this.event('install', true, `Installed ${apk.release} on ${device.name} (${device.id})`, apk.release);
      return { release: apk.release, device: `${device.name} (${device.id})` };
    } catch (error) {
      this.event(
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
    const settings = this.stored();
    if (!settings.autoInstall || this.busy) return;
    const last = this.state().lastCheckAt;
    if (last && Date.now() - new Date(last).getTime() < settings.intervalMinutes * 60_000) return;
    await this.checkNow();
  }

  /**
   * Cek release baru sekarang. Release baru → unduh → pasang → (opsional)
   * jalankan jadwal. Release pertama yang terlihat setelah koneksi dibuat juga
   * diproses, supaya perangkat langsung memakai versi terbaru.
   */
  checkNow(): Promise<FirebaseEvent> {
    if (this.busy) return this.busy as Promise<FirebaseEvent>;
    const job = (async (): Promise<FirebaseEvent> => {
      this.setState({ lastCheckAt: nowIso() });
      const settings = this.stored();
      let latest: RawRelease | undefined;
      try {
        latest = (await this.rawReleases())[0];
      } catch (error) {
        this.event('error', false, `Checking Firebase failed: ${(error as Error).message}`);
        return this.state().events[0];
      }
      if (!latest) {
        this.event('check', true, 'No releases in Firebase yet.');
        return this.state().events[0];
      }
      const label = `${latest.displayVersion} (${latest.buildVersion})`;
      if (latest.name === this.state().lastSeenRelease) {
        this.event('check', true, `No new release. Latest is still ${label}.`, label);
        return this.state().events[0];
      }
      this.event('check', true, `New release found: ${label}.`, label);
      try {
        await this.install(latest.id, { mode: settings.installMode, udid: settings.udid });
      } catch {
        // Dicatat oleh install(); release belum ditandai "terlihat" supaya dicoba lagi berikutnya.
        return this.state().events[0];
      }
      this.setState({ lastSeenRelease: latest.name });
      if (settings.runSchedule) {
        const schedule = this.deps.repos.uiSchedules.get(settings.scheduleId);
        if (!schedule)
          this.event('error', false, 'The schedule to run after installing no longer exists.', label);
        else
          try {
            const { queued } = this.deps.schedules().run(schedule, { mode: settings.installMode });
            this.event(
              'schedule',
              true,
              `Started "${schedule.name}" (${queued} test${queued === 1 ? '' : 's'}) on ${label}.`,
              label,
            );
          } catch (error) {
            this.event(
              'error',
              false,
              `Could not start "${schedule.name}": ${(error as Error).message}`,
              label,
            );
          }
      }
      return this.state().events[0];
    })().finally(() => {
      this.busy = null;
    });
    this.busy = job;
    return job;
  }
}
