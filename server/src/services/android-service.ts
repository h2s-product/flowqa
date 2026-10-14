/**
 * Android automation (Settings → Mobile (Android)): preflight environment,
 * "Setup Android Environment", server Appium, Device Manager (emulator & HP),
 * wizard emulator, "Test Android Connection", dan upload APK.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  AndroidConnectionResult,
  AndroidDevice,
  AndroidEnvironmentReport,
  AndroidSetupJob,
  AppiumHealth,
  AvdOptions,
  ConnectionCheck,
  CreateAvdInput,
  UploadedApk,
} from '@flowqa/shared';
import { config } from '../config';
import { AppiumServerManager, appiumInstallInfo } from '../engine/android/appium-server';
import { avdOptions, createAvd } from '../engine/android/avd';
import { LOCKED_HELP, listDevices, startEmulator, stopEmulator } from '../engine/android/devices';
import { AndroidEnvironmentManager } from '../engine/android/environment-manager';
import { AndroidSetupRunner, planSetup, type SetupOptions } from '../engine/android/setup';
import { toolchain } from '../engine/android/toolchain';
import { AppiumClient } from '../engine/mobile/appium-client';
import { HttpError } from '../lib/http';
import { log } from '../lib/log';
import { nowIso } from '../lib/time';
import type { AppiumSettingsService } from './appium-settings-service';
import type { DeviceLockManager } from './device-lock-manager';
import { MobileError, ensureForeground, type MobileProviders } from './mobile-driver-provider';

/** Folder APK yang di-upload / diunduh dari Firebase (di samping folder artefak UI). */
export const androidApkDir = () => path.join(path.dirname(config.uiArtifactsDir), 'apks');

/** Aplikasi bawaan Android yang dipakai "Test Android Connection" bila tidak ada APK. */
const TEST_APP = { appPackage: 'com.android.settings', appActivity: '.Settings' };
const APK_NAME = /^[\w .()-]{1,120}\.apk$/i;

export class AndroidService {
  readonly environment: AndroidEnvironmentManager;
  private readonly setupRunner = new AndroidSetupRunner();
  private readonly avdRunner = new AndroidSetupRunner();
  private lastReport: AndroidEnvironmentReport | null = null;

  constructor(
    private readonly settings: AppiumSettingsService,
    readonly server: AppiumServerManager,
    private readonly locks: DeviceLockManager,
    private readonly providers: MobileProviders,
  ) {
    this.environment = new AndroidEnvironmentManager(() => this.settings.current().serverUrl);
  }

  apkDir() {
    return androidApkDir();
  }

  /* ---------------------------- environment ---------------------------- */

  async check(): Promise<AndroidEnvironmentReport> {
    this.lastReport = await this.environment.check();
    return this.lastReport;
  }

  /** Langkah yang akan dijalankan Setup (untuk ditampilkan sebelum user menyetujui). */
  async plan(options: SetupOptions) {
    const report = await this.check();
    const { steps, blocked } = await planSetup(report, options);
    return { report, steps: steps.map(({ exec: _exec, ...s }) => s), blocked };
  }

  async setup(options: SetupOptions): Promise<AndroidSetupJob> {
    if (this.setupRunner.running()) throw new HttpError(409, 'Setup is already running.');
    const report = await this.check();
    const { steps, blocked } = await planSetup(report, options);
    if (steps.some((s) => s.license) && !options.acceptLicenses)
      throw new HttpError(400, 'Accept the Android SDK licenses to install the SDK components.');
    return this.setupRunner.start(steps, () => this.check(), blocked);
  }

  setupJob(): AndroidSetupJob | null {
    return this.setupRunner.current();
  }

  /* ------------------------------ Appium ------------------------------ */

  async appiumHealth(): Promise<AppiumHealth> {
    const url = this.settings.current().serverUrl;
    const [install, status] = await Promise.all([
      appiumInstallInfo(),
      new AppiumClient(url).status().catch(() => null),
    ]);
    const running = !!status;
    return {
      installed: !!install.version,
      version: install.version,
      path: install.appium || undefined,
      uiautomator2Installed: !!install.uiautomator2,
      uiautomator2Version: install.uiautomator2,
      serverUrl: this.settings.view().serverUrl,
      serverRunning: running,
      serverVersion: status?.build?.version,
      managed: this.server.managed,
      message: !install.version
        ? 'Appium is not installed. Run Setup Android Environment.'
        : !install.uiautomator2
          ? 'Appium is installed, but the UiAutomator2 driver is missing.'
          : running
            ? `Appium ${status?.build?.version ?? ''} is running${this.server.managed ? ' (started by Testora)' : ''}.`
            : 'Appium is installed but not running. Click Start Appium.',
    };
  }

  async startAppium(): Promise<AppiumHealth> {
    const url = this.settings.current().serverUrl;
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(url))
      throw new HttpError(400, `Testora can only start Appium on this computer. The server URL is ${url}.`);
    await this.server.start(Number(new URL(url).port || 4723)).catch((error) => {
      throw new HttpError(500, (error as Error).message);
    });
    return this.appiumHealth();
  }

  async stopAppium(): Promise<AppiumHealth> {
    await this.server.stop();
    return this.appiumHealth();
  }

  appiumLog(): string[] {
    return this.server.recent(400);
  }

  /* ------------------------------ devices ------------------------------ */

  async devices(): Promise<AndroidDevice[]> {
    const devices = await listDevices(this.locks.busyIds());
    // BUSY: tampilkan siapa yang memakai perangkat (untuk keputusan Force stop).
    const owners = this.locks.owners();
    return devices.map((d) => {
      const owner = d.status === 'BUSY' ? owners.get(d.id) : undefined;
      return owner ? { ...d, detail: `In use by ${this.describeDeviceUser?.(owner) ?? owner}.` } : d;
    });
  }

  /** Nama yang mudah dibaca untuk pemakai perangkat, mis. UI test "Login Sales App". */
  describeDeviceUser?: (owner: string) => string;

  async startEmulator(avd: string): Promise<AndroidDevice[]> {
    const known = (await this.devices()).find((d) => d.id === `avd:${avd}`);
    if (!known) throw new HttpError(404, `There is no stopped emulator named "${avd}".`);
    if (known.status === 'ERROR') throw new HttpError(400, known.detail);
    startEmulator(avd, (line) => log.info(`[emulator ${avd}] ${line}`));
    return this.devices();
  }

  /**
   * Hentikan pemakai perangkat (UI run, Mobile Inspector) sebelum Force stop.
   * Diisi app-context karena AndroidService tidak mengenal layanan run.
   */
  stopDeviceUser?: (owner: string, stoppedBy?: string) => Promise<void>;

  /** Pemakai perangkat yang sedang BUSY, mis. "UI run uir_…". */
  ownerOf(serial: string): string | undefined {
    return this.locks.owners().get(serial);
  }

  /**
   * Stop emulator. Saat BUSY hanya bisa dengan `force`: test / inspector yang
   * memakainya dihentikan dulu, emulator dimatikan (di-kill bila macet), lalu
   * kunci perangkatnya dilepas supaya antrean berikutnya tidak tertahan.
   */
  async stopEmulator(
    serial: string,
    options: { force?: boolean; stoppedBy?: string } = {},
  ): Promise<{ devices: AndroidDevice[]; message: string }> {
    if (!/^emulator-\d+$/.test(serial))
      throw new HttpError(400, 'Only emulators can be stopped from Testora.');
    const owner = this.ownerOf(serial);
    if (owner && !options.force)
      throw new HttpError(
        409,
        `This emulator is busy (${owner}). Use Force stop to stop that test and the emulator.`,
      );
    if (owner) {
      log.warn(`Force stop ${serial}: stopping ${owner}`);
      await this.stopDeviceUser?.(owner, options.stoppedBy).catch((error) =>
        log.warn(`Force stop ${serial}: could not stop ${owner}: ${(error as Error).message}`),
      );
    }
    const how = await stopEmulator(serial, { force: !!options.force }).catch((error) => {
      throw new HttpError(500, (error as Error).message);
    });
    // Run yang dihentikan biasanya sudah melepas perangkat; bila belum (macet), lepas paksa.
    if (this.locks.busyIds().has(serial)) this.locks.forceRelease(serial);
    const message = [
      owner ? `Stopped ${owner}.` : '',
      how === 'killed' ? `${serial} did not respond and was killed.` : `${serial} was stopped.`,
    ]
      .filter(Boolean)
      .join(' ');
    return { devices: await this.devices(), message };
  }

  avdOptions(): Promise<AvdOptions> {
    return avdOptions();
  }

  createAvd(input: CreateAvdInput): AndroidSetupJob {
    if (this.avdRunner.running()) throw new HttpError(409, 'An emulator is already being created.');
    return this.avdRunner.start(
      [
        {
          id: 'avd',
          label: `Create the emulator "${input.name}"`,
          command: `avdmanager create avd -n ${input.name} -k "${input.image}" -d ${input.device}`,
          status: 'pending',
          exec: (line) => createAvd(input, line),
        },
      ],
      null,
    );
  }

  avdJob(): AndroidSetupJob | null {
    return this.avdRunner.current();
  }

  /* -------------------------- connection test -------------------------- */

  /**
   * Test Android Connection: Appium → UiAutomator2 → ADB → perangkat → sesi →
   * buka aplikasi → screenshot → tutup sesi. Setiap langkah benar-benar dijalankan.
   */
  async testConnection(input: {
    mode?: unknown;
    udid?: unknown;
    appPackage?: unknown;
    appActivity?: unknown;
    app?: unknown;
  }): Promise<AndroidConnectionResult> {
    const mode = input.mode === 'device' ? 'device' : 'emulator';
    const checks: ConnectionCheck[] = [];
    const add = (id: string, label: string, status: ConnectionCheck['status'], detail: string) =>
      checks.push({ id, label, status, detail });
    const url = this.settings.current().serverUrl;
    const fail = (
      errorCode: AndroidConnectionResult['errorCode'],
      message: string,
    ): AndroidConnectionResult => {
      const labels = [
        'Check Appium',
        'Check UiAutomator2',
        'Check ADB',
        'Detect device',
        'Create Appium session',
        'Launch test app',
        'Capture screenshot',
        'Close session',
      ];
      for (const label of labels.slice(checks.length)) add(label, label, 'skipped', 'Not run');
      return { ok: false, errorCode, message, checks };
    };

    const install = await appiumInstallInfo();
    const status = await new AppiumClient(url).status().catch(() => null);
    if (!status && !install.version) {
      add('appium', 'Check Appium', 'failed', 'Appium is not installed.');
      return fail('APPIUM_NOT_INSTALLED', 'Appium is not installed.');
    }
    if (!status) {
      try {
        await this.server.start(Number(new URL(url).port || 4723));
      } catch (error) {
        add('appium', 'Check Appium', 'failed', (error as Error).message);
        return fail('APPIUM_NOT_RUNNING', `Appium could not be started: ${(error as Error).message}`);
      }
    }
    const version = (await new AppiumClient(url).status().catch(() => null))?.build?.version;
    add(
      'appium',
      'Check Appium',
      'passed',
      `Appium ${version ?? install.version ?? ''} at ${this.settings.view().serverUrl}${status ? '' : ' (started by Testora)'}`,
    );
    if (install.version && !install.uiautomator2) {
      add('uiautomator2', 'Check UiAutomator2', 'failed', 'Not installed.');
      return fail('UIAUTOMATOR2_NOT_INSTALLED', 'The Appium UiAutomator2 driver is not installed.');
    }
    add(
      'uiautomator2',
      'Check UiAutomator2',
      'passed',
      install.uiautomator2 ? `UiAutomator2 ${install.uiautomator2}` : 'Remote Appium server',
    );
    const tc = toolchain();
    if (!tc.adb) {
      add('adb', 'Check ADB', 'failed', 'adb was not found.');
      return fail('ANDROID_SDK_NOT_FOUND', 'Android SDK was not detected (adb is missing).');
    }
    add('adb', 'Check ADB', 'passed', tc.adb);
    const devices = await this.devices();
    const udid = typeof input.udid === 'string' ? input.udid : '';
    const device = devices.find(
      (d) =>
        d.automationReady && (udid ? d.id === udid : d.type === (mode === 'device' ? 'device' : 'emulator')),
    );
    const lockedPhone = devices.find(
      (d) =>
        d.status === 'CONNECTED' &&
        d.detail === LOCKED_HELP &&
        (udid ? d.id === udid : d.type === (mode === 'device' ? 'device' : 'emulator')),
    );
    if (!device && lockedPhone) {
      add('device', 'Detect device', 'failed', `${lockedPhone.name} · ${lockedPhone.id}: ${LOCKED_HELP}`);
      return fail(
        'DEVICE_LOCKED',
        `${lockedPhone.name} is connected, but its screen is locked. Unlock it and try again.`,
      );
    }
    if (!device) {
      const unauthorized = devices.find((d) => d.status === 'UNAUTHORIZED');
      const busy = devices.find((d) => d.status === 'BUSY');
      add(
        'device',
        'Detect device',
        'failed',
        unauthorized?.detail ?? busy?.detail ?? 'No ready Android device.',
      );
      if (unauthorized)
        return fail(
          'ADB_UNAUTHORIZED',
          'Android device is connected but USB debugging authorization is pending.',
        );
      if (busy) return fail('DEVICE_BUSY', `${busy.name} is busy with a test. Try again when it finishes.`);
      return fail(
        'NO_DEVICE',
        `Appium server is running, but no Android ${mode === 'device' ? 'device is connected over USB' : 'emulator is running'}.`,
      );
    }
    add('device', 'Detect device', 'passed', `${device.name} · ${device.id} · ${device.androidVersion}`);

    const lease = await this.locks.acquire([device.id], 'Test Android Connection');
    const app = typeof input.app === 'string' && input.app ? input.app : '';
    const appPackage =
      typeof input.appPackage === 'string' && input.appPackage
        ? input.appPackage
        : app
          ? ''
          : TEST_APP.appPackage;
    const appActivity =
      typeof input.appActivity === 'string' && input.appActivity
        ? input.appActivity
        : app
          ? ''
          : TEST_APP.appActivity;
    const since = Date.now();
    try {
      const session = await this.settings
        .client()
        .createSession({
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:udid': device.id,
          'appium:deviceName': device.name,
          ...(app ? { 'appium:app': app } : {}),
          ...(appPackage ? { 'appium:appPackage': appPackage } : {}),
          ...(appActivity ? { 'appium:appActivity': appActivity } : {}),
          'appium:noReset': true,
          'appium:newCommandTimeout': 120,
          'appium:uiautomator2ServerLaunchTimeout': 120_000,
        })
        .catch((error) => {
          throw new MobileError(
            'APPIUM_SESSION_FAILED',
            `Could not create Appium session: ${(error as Error).message}`,
            {
              appiumLog: this.server.logSince(since),
            },
          );
        });
      add('session', 'Create Appium session', 'passed', `Session ${session.id.slice(0, 8)}…`);
      let screenshot: string | undefined;
      try {
        // Lulus hanya bila aplikasinya benar-benar di depan dan layarnya tergambar
        // (sama dengan run: layar sisa aplikasi lain ditutup dulu).
        const expected =
          appPackage ||
          String(session.capabilities.appPackage ?? session.capabilities['appium:appPackage'] ?? '');
        if (expected && !(await ensureForeground(session, expected))) {
          const current = await session
            .request<string>('GET', '/appium/device/current_package')
            .catch(() => '');
          throw new MobileError(
            'APP_LAUNCH_FAILED',
            `The session was created, but ${expected} did not open (in front: ${current || 'unknown'}).`,
          );
        }
        // Beri waktu satu-dua frame setelah hierarki UI tersedia.
        await new Promise((r) => setTimeout(r, 1_000));
        add('launch', 'Launch test app', 'passed', `${expected || app} is open and its screen is shown`);
        screenshot = await session.screenshot();
        add(
          'screenshot',
          'Capture screenshot',
          'passed',
          `${Math.round((screenshot.length * 3) / 4 / 1024)} KB PNG`,
        );
      } catch (error) {
        // Langkah yang gagal dicatat sebelum "Close session", sesuai urutan kejadian.
        const stage = checks.some((c) => c.id === 'launch')
          ? ['screenshot', 'Capture screenshot']
          : ['launch', 'Launch test app'];
        add(stage[0], stage[1], 'failed', (error as Error).message);
        await session.quit();
        add('close', 'Close session', 'passed', 'Session closed');
        const code = error instanceof MobileError ? error.code : 'APP_LAUNCH_FAILED';
        return {
          ok: false,
          errorCode: code,
          message: (error as Error).message,
          checks,
          device: `${device.name} · ${device.id}`,
        };
      }
      await session.quit();
      add('close', 'Close session', 'passed', 'Session closed');
      return {
        ok: true,
        message: `CONNECTED ✓ ${device.name} (${device.androidVersion})`,
        checks,
        device: `${device.name} · ${device.id}`,
        screenshot,
      };
    } catch (error) {
      const e = error as MobileError;
      const stage = [
        ['session', 'Create Appium session'],
        ['launch', 'Launch test app'],
        ['screenshot', 'Capture screenshot'],
      ].find(([id]) => !checks.some((c) => c.id === id)) ?? ['session', 'Create Appium session'];
      add(stage[0], stage[1], 'failed', e.message);
      const result = fail(e.code ?? 'APPIUM_SESSION_FAILED', e.message);
      return { ...result, device: `${device.name} · ${device.id}`, checks: result.checks };
    } finally {
      lease.release();
    }
  }

  /* -------------------------------- APK -------------------------------- */

  listApks(): UploadedApk[] {
    const dir = this.apkDir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.apk'))
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, path: path.join(dir, f), size: stat.size, uploadedAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  saveApk(name: string, data: Buffer): UploadedApk {
    const clean = path.basename(name).replace(/[^\w .()-]/g, '_');
    if (!APK_NAME.test(clean)) throw new HttpError(400, 'Upload an .apk file.');
    // APK = ZIP: harus diawali "PK".
    if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b)
      throw new HttpError(400, 'This file is not a valid APK.');
    fs.mkdirSync(this.apkDir(), { recursive: true });
    const file = path.join(this.apkDir(), clean);
    fs.writeFileSync(file, data);
    return { name: clean, path: file, size: data.length, uploadedAt: nowIso() };
  }

  deleteApk(name: string) {
    const clean = path.basename(name);
    if (!APK_NAME.test(clean)) throw new HttpError(400, 'Not an APK name.');
    fs.rmSync(path.join(this.apkDir(), clean), { force: true });
  }

  providersFor() {
    return this.providers;
  }
}
