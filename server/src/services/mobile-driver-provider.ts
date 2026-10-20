/**
 * MobileDriverProvider: satu test case mobile bisa dijalankan di Mock Mode atau
 * Real Android Mode (emulator / HP) tanpa mengubah test-nya.
 *
 *   UiRunService / MobileInspectorService
 *     → MobileDriverProvider.acquire()
 *         MockMobileDriverProvider      → Mock Appium (aplikasi Demo Shop tiruan)
 *         AppiumAndroidDriverProvider   → Appium server → UiAutomator2 → emulator / HP
 *     → MobileDriver (executeMobileStep)
 *
 * Real mode hanya dianggap berhasil bila sesi Appium benar-benar terbentuk.
 * Setiap kegagalan menjadi MobileError dengan kode yang bisa ditindaklanjuti.
 */
import type {
  AndroidDevice,
  MobileAppConfig,
  MobileErrorCode,
  MobileExecutionMode,
  UiRunMobileInfo,
} from '@flowqa/shared';
import { FIREBASE_LATEST_APP, MOBILE_EXECUTION_MODE_LABEL } from '@flowqa/shared';
import { AppiumServerManager, appiumInstallInfo } from '../engine/android/appium-server';
import {
  appVersion,
  isLocked,
  listDevices,
  logcat,
  startEmulator,
  waitForBoot,
} from '../engine/android/devices';
import { maskSecrets, run, toolchain } from '../engine/android/toolchain';
import { AppiumClient, AppiumError, type AppiumSession } from '../engine/mobile/appium-client';
import { CapabilityError, appIdOf, buildCapabilities } from '../engine/mobile/capabilities';
import { MobileDriver } from '../engine/mobile/mobile-executor';
import { MockAppiumServer } from '../engine/mobile/mock-appium';
import { log } from '../lib/log';
import type { AppiumSettingsService } from './appium-settings-service';
import type { DeviceLockManager } from './device-lock-manager';

/** Error mobile dengan kode & detail untuk hasil run (log Appium, perangkat, capabilities). */
export class MobileError extends Error {
  constructor(
    readonly code: MobileErrorCode,
    message: string,
    readonly details: { appiumLog?: string; device?: string; capabilities?: Record<string, unknown> } = {},
  ) {
    super(message);
  }
}

export interface MobileLease {
  driver: MobileDriver;
  info: UiRunMobileInfo;
  /** Log Appium selama sesi (hanya bila server dikelola Testora). */
  appiumLog(): string;
  /** Log Android (logcat) perangkat. */
  deviceLog(): Promise<string>;
  /** Tutup sesi Appium dan lepaskan perangkat. */
  release(): Promise<void>;
}

export interface AcquireRequest {
  config: MobileAppConfig;
  resolve: (text: string) => string;
  /** Mis. "UI run uir_…" — ditampilkan sebagai pemakai perangkat. */
  owner: string;
  /** Dipanggil bila perangkat sedang dipakai & permintaan masuk antrean. */
  onQueued?: () => void;
  /** Keterangan progres (mis. "Starting emulator…"). */
  onStatus?: (message: string) => void;
  /** Nilai rahasia yang disamarkan di log Appium. */
  secrets?: string[];
  /** Run dihentikan (Stop) saat masih menunggu perangkat → keluar dari antrean. */
  signal?: AbortSignal;
}

export interface MobileDriverProvider {
  readonly mode: MobileExecutionMode;
  acquire(request: AcquireRequest): Promise<MobileLease>;
}

const isLocal = (url: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(url);

/** Capabilities untuk ditampilkan: nilai app/password disamarkan bila berisi rahasia. */
function safeCaps(caps: Record<string, unknown>, secrets: string[]) {
  return JSON.parse(maskSecrets(JSON.stringify(caps), secrets)) as Record<string, unknown>;
}

/**
 * Tunggu sampai elemen dengan package aplikasi muncul di page source. Bila yang
 * tampil aplikasi lain: tekan Back (maks. 3×), lalu HOME + buka ulang aplikasinya.
 */
export async function ensureForeground(session: AppiumSession, appId: string): Promise<boolean> {
  const shown = async (ms: number) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const source = await session.source().catch(() => '');
      if (source.includes(`package="${appId}"`)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 800));
    }
  };
  if (await shown(8_000)) return true;
  for (let i = 0; i < 3; i++) {
    await session.back().catch(() => {});
    if (await shown(2_500)) return true;
  }
  await session.execute('mobile: pressKey', { keycode: 3 }).catch(() => {});
  await session.execute('mobile: activateApp', { appId }).catch(() => {});
  if (await shown(10_000)) return true;
  log.warn(`${appId} did not come to the foreground after launch`);
  return false;
}

/* ------------------------------- Mock ------------------------------- */

/** Aplikasi Android tiruan di dalam Testora (tanpa perangkat, untuk development/demo). */
export class MockMobileDriverProvider implements MobileDriverProvider {
  readonly mode = 'mock' as const;
  private readonly server = new MockAppiumServer();

  constructor(private readonly locks: DeviceLockManager) {}

  async acquire(request: AcquireRequest): Promise<MobileLease> {
    const lease = await this.locks.acquire(['mock-device'], request.owner, request.onQueued, request.signal);
    try {
      const url = await this.server.url();
      const caps = buildCapabilities(request.config, '', request.resolve, {
        udid: 'mock-device',
        name: 'Mock Android',
        platformVersion: '15',
      });
      const session = await new AppiumClient(url).createSession(caps);
      const driver = new MobileDriver(
        session,
        'android',
        appIdOf(request.config, session.capabilities) || 'com.demo',
        request.config.app,
      );
      return {
        driver,
        info: {
          mode: 'mock',
          device: 'Mock Android (Demo Shop)',
          udid: 'mock-device',
          androidVersion: 'Android 15 (mock)',
          appPackage: driver.appId,
          appVersion: 'mock',
          appiumVersion: 'mock',
        },
        appiumLog: () => '',
        deviceLog: async () => '',
        release: async () => {
          await session.quit();
          lease.release();
        },
      };
    } catch (error) {
      lease.release();
      if (error instanceof CapabilityError) throw new MobileError('APP_NOT_CONFIGURED', error.message);
      throw error;
    }
  }

  close() {
    this.server.close();
  }
}

/* --------------------------- Real Android --------------------------- */

/** Sumber data perangkat & perkakas (bawaan: adb/appium sungguhan; bisa diganti di test). */
export interface AndroidProbe {
  devices(busy: Set<string>): Promise<AndroidDevice[]>;
  /** true/false = UiAutomator2 terpasang; null = tidak bisa dicek (Appium bukan di mesin ini). */
  uiautomator2(): Promise<boolean | null>;
  appVersion(udid: string, pkg: string): Promise<string>;
  logcat(udid: string): Promise<string>;
  startEmulator(avd: string): void;
  waitForBoot(udid: string): Promise<boolean>;
  /** Pasang / perbarui APK di perangkat (adb install -r -g). */
  installApk(udid: string, apkPath: string): Promise<void>;
  /** true = layar HP terkunci. */
  isLocked(udid: string): Promise<boolean>;
}

export const realAndroidProbe: AndroidProbe = {
  devices: async (busy) => {
    if (!toolchain().adb)
      throw new MobileError('ANDROID_SDK_NOT_FOUND', 'Android SDK was not detected (adb is missing).');
    return listDevices(busy);
  },
  uiautomator2: async () => (toolchain().appium ? !!(await appiumInstallInfo()).uiautomator2 : null),
  appVersion: (udid, pkg) => appVersion(udid, pkg),
  logcat: (udid) => logcat(udid),
  startEmulator: (avd) => startEmulator(avd, (line) => log.info(`[emulator ${avd}] ${line}`)),
  waitForBoot: (udid) => waitForBoot(udid),
  isLocked: (udid) => isLocked(udid),
  installApk: async (udid, apkPath) => {
    const tc = toolchain();
    const result = await run(tc.adb, ['-s', udid, 'install', '-r', '-g', apkPath], {
      timeoutMs: 5 * 60_000,
      env: tc.env,
    });
    const out = `${result.stdout}\n${result.stderr}`;
    // adb bisa exit 0 walau gagal; "Success" wajib ada.
    if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE/.test(out))
      throw new MobileError(
        'APP_LAUNCH_FAILED',
        'adb install failed: this build is signed with a different key than the app already on the device (INSTALL_FAILED_UPDATE_INCOMPATIBLE). Uninstall the old app on that device first (its data and login are removed), then install again.',
      );
    if (!result.ok || !/\bSuccess\b/.test(out))
      throw new MobileError(
        'APP_LAUNCH_FAILED',
        `adb install failed: ${(/Failure \[[^\]]+\]/.exec(out)?.[0] ?? result.error ?? out.trim().split('\n').pop() ?? 'unknown error').slice(0, 300)}`,
      );
  },
};

/** Appium + UiAutomator2 ke Android Emulator (mode "emulator") atau HP sungguhan (mode "device"). */
export class AppiumAndroidDriverProvider implements MobileDriverProvider {
  private driverCheck: { at: number; ok: boolean | null } | null = null;

  constructor(
    readonly mode: 'emulator' | 'device',
    private readonly settings: AppiumSettingsService,
    private readonly server: AppiumServerManager,
    private readonly locks: DeviceLockManager,
    private readonly probe: AndroidProbe = realAndroidProbe,
    private readonly latestFirebaseApk?: () => Promise<string>,
  ) {}

  /** Pastikan Appium menjawab; server lokal dinyalakan otomatis bila Appium terpasang. */
  private async ensureAppium(url: string, onStatus?: (m: string) => void): Promise<string> {
    const version = await new AppiumClient(url)
      .status()
      .then((s) => s.build?.version ?? 'unknown')
      .catch(() => null);
    if (version) return version;
    if (!isLocal(url))
      throw new MobileError('APPIUM_NOT_RUNNING', `The Appium server at ${url} is not answering.`);
    if (!toolchain().appium) throw new MobileError('APPIUM_NOT_INSTALLED', 'Appium is not installed.');
    onStatus?.('Starting the Appium server…');
    const port = Number(new URL(url).port || 4723);
    await this.server.start(port).catch((error) => {
      throw new MobileError('APPIUM_NOT_RUNNING', `Could not start Appium: ${(error as Error).message}`, {
        appiumLog: this.server.recent(40).join('\n'),
      });
    });
    return (await new AppiumClient(url).status().catch(() => null))?.build?.version ?? 'unknown';
  }

  /** Driver UiAutomator2 harus terpasang (dicek dengan `appium driver list`, di-cache 1 menit). */
  private async ensureDriver(url: string) {
    if (!isLocal(url)) return;
    if (!this.driverCheck || Date.now() - this.driverCheck.at > 60_000)
      this.driverCheck = { at: Date.now(), ok: await this.probe.uiautomator2() };
    if (this.driverCheck.ok === false)
      throw new MobileError('UIAUTOMATOR2_NOT_INSTALLED', 'The Appium UiAutomator2 driver is not installed.');
  }

  /** Pilih perangkat sesuai mode (atau serial yang dipasang di test). */
  private async candidates(
    config: MobileAppConfig,
    onStatus?: (m: string) => void,
  ): Promise<{ ids: string[]; names: Map<string, { name: string; version: string }> }> {
    const type = this.mode === 'emulator' ? 'emulator' : 'device';
    let devices = await this.probe.devices(this.locks.busyIds());
    // Serial yang dipasang di test hanya dipakai bila jenisnya sesuai mode yang dipilih saat Run
    // (test yang direkam di emulator tetap bisa dijalankan di HP, dan sebaliknya).
    const kindOf = (id: string) =>
      devices.find((d) => d.id === id)?.type ?? (id.startsWith('emulator-') ? 'emulator' : 'device');
    const udid = config.udid && kindOf(config.udid) === type ? config.udid : '';
    const pick = () =>
      devices.filter(
        (d) =>
          !d.id.startsWith('avd:') &&
          (udid ? d.id === udid : d.type === type) &&
          (d.status === 'CONNECTED' || d.status === 'BUSY' || d.status === 'BOOTING'),
      );
    let found = pick();
    // Emulator yang sudah dibuat tetapi belum menyala → nyalakan (tidak pernah membuat AVD baru diam-diam).
    if (!found.length && this.mode === 'emulator' && !udid) {
      const avd = devices.find((d) => d.id.startsWith('avd:') && d.status === 'DISCONNECTED');
      if (avd?.avd) {
        onStatus?.(`Starting the emulator ${avd.avd}…`);
        this.probe.startEmulator(avd.avd);
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline && !found.length) {
          await new Promise((r) => setTimeout(r, 3_000));
          devices = await this.probe.devices(this.locks.busyIds());
          found = pick();
        }
      }
    }
    for (const d of found.filter((x) => x.status === 'BOOTING')) {
      onStatus?.(`Waiting for ${d.name} to finish booting…`);
      await this.probe.waitForBoot(d.id);
    }
    if (!found.length) {
      const unauthorized = devices.find((d) => d.status === 'UNAUTHORIZED' && (!udid || d.id === udid));
      if (unauthorized)
        throw new MobileError(
          'ADB_UNAUTHORIZED',
          'Android device is connected but USB debugging authorization is pending.',
          {
            device: unauthorized.id,
          },
        );
      throw new MobileError(
        'NO_DEVICE',
        udid
          ? `The device ${udid} set in this test is not connected.`
          : this.mode === 'emulator'
            ? 'No Android emulator is running or available.'
            : 'No physical Android device is connected over USB.',
      );
    }
    return {
      ids: found.map((d) => d.id),
      names: new Map(
        found.map((d) => [d.id, { name: d.name, version: d.androidVersion.replace(/^Android /, '') }]),
      ),
    };
  }

  /** "firebase:latest" → path APK release Firebase terbaru (diunduh bila perlu). */
  private async firebaseApk(): Promise<string> {
    if (!this.latestFirebaseApk)
      throw new MobileError('APP_NOT_CONFIGURED', 'Firebase App Distribution is not connected.');
    return this.latestFirebaseApk().catch((error) => {
      throw new MobileError(
        'APP_NOT_CONFIGURED',
        `Could not get the latest Firebase release: ${(error as Error).message}`,
      );
    });
  }

  async acquire(request: AcquireRequest): Promise<MobileLease> {
    if (request.config.app.trim() === FIREBASE_LATEST_APP) {
      request.onStatus?.('Downloading the latest Firebase release…');
      request = { ...request, config: { ...request.config, app: await this.firebaseApk() } };
    }
    const { url } = { url: this.settings.current().serverUrl };
    const settings = this.settings.current();
    const since = Date.now();
    const secrets = request.secrets ?? [];
    this.server.addSecrets(secrets);
    const appiumVersion = await this.ensureAppium(url, request.onStatus);
    await this.ensureDriver(url);
    const { ids, names } = await this.candidates(request.config, request.onStatus);
    const lease = await this.locks.acquire(ids, request.owner, request.onQueued, request.signal);
    const device = names.get(lease.udid) ?? { name: lease.udid, version: '' };
    if (!lease.udid.startsWith('emulator-') && (await this.probe.isLocked(lease.udid).catch(() => false))) {
      lease.release();
      throw new MobileError(
        'DEVICE_LOCKED',
        `${device.name} is locked. Unlock the phone and keep the screen on, then run again.`,
        { device: `${device.name} (${lease.udid})` },
      );
    }
    let caps: Record<string, unknown>;
    try {
      caps = buildCapabilities(request.config, settings.capabilities, request.resolve, {
        udid: lease.udid,
        name: device.name,
        platformVersion: device.version,
      });
    } catch (error) {
      lease.release();
      throw new MobileError('APP_NOT_CONFIGURED', (error as Error).message);
    }
    request.onStatus?.(`Creating the Appium session on ${device.name}…`);
    let session: AppiumSession;
    try {
      session = await this.settings.client(settings).createSession(caps);
    } catch (error) {
      lease.release();
      const reason = error instanceof AppiumError ? error.message : (error as Error).message;
      throw new MobileError('APPIUM_SESSION_FAILED', `Could not create Appium session: ${reason}`, {
        appiumLog: this.server.managed ? this.server.logSince(since) : '',
        device: `${device.name} (${lease.udid})`,
        capabilities: safeCaps(caps, secrets),
      });
    }
    const driver = new MobileDriver(
      session,
      'android',
      appIdOf(request.config, session.capabilities),
      String(caps['appium:app'] ?? ''),
      this.latestFirebaseApk && (() => this.firebaseApk()),
    );
    // Pastikan aplikasi yang dites benar-benar di depan dan tergambar. Layar sisa dari aplikasi
    // lain (mis. overlay pencarian) bisa tetap menutupi walau aplikasinya sudah di-restart.
    if (driver.appId) {
      request.onStatus?.(`Waiting for ${driver.appId} to open…`);
      if (!(await ensureForeground(session, driver.appId))) {
        await session.quit();
        lease.release();
        throw new MobileError('APP_LAUNCH_FAILED', `${driver.appId} did not open on ${device.name}.`, {
          appiumLog: this.server.managed ? this.server.logSince(since) : '',
          device: `${device.name} (${lease.udid})`,
          capabilities: safeCaps(caps, secrets),
        });
      }
    }
    return {
      driver,
      info: {
        mode: this.mode,
        device: device.name,
        udid: lease.udid,
        androidVersion: device.version ? `Android ${device.version}` : '',
        appPackage: driver.appId,
        appVersion: await this.probe.appVersion(lease.udid, driver.appId).catch(() => ''),
        appiumVersion,
      },
      appiumLog: () => (this.server.managed ? this.server.logSince(since) : ''),
      deviceLog: async () => maskSecrets(await this.probe.logcat(lease.udid), secrets),
      release: async () => {
        await session.quit();
        lease.release();
      },
    };
  }
}

/** Provider per mode eksekusi. */
export class MobileProviders {
  readonly mock: MockMobileDriverProvider;
  private readonly real: Record<'emulator' | 'device', AppiumAndroidDriverProvider>;

  constructor(
    settings: AppiumSettingsService,
    server: AppiumServerManager,
    readonly locks: DeviceLockManager,
    probe: AndroidProbe = realAndroidProbe,
    /** APK release Firebase terbaru (untuk app / step "firebase:latest"). */
    latestFirebaseApk?: () => Promise<string>,
  ) {
    this.mock = new MockMobileDriverProvider(locks);
    this.real = {
      emulator: new AppiumAndroidDriverProvider(
        'emulator',
        settings,
        server,
        locks,
        probe,
        latestFirebaseApk,
      ),
      device: new AppiumAndroidDriverProvider('device', settings, server, locks, probe, latestFirebaseApk),
    };
  }

  get(mode: MobileExecutionMode): MobileDriverProvider {
    return mode === 'mock' ? this.mock : this.real[mode];
  }

  label(mode: MobileExecutionMode) {
    return MOBILE_EXECUTION_MODE_LABEL[mode];
  }
}
