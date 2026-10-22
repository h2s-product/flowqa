/**
 * Mobile Inspector: sesi Appium interaktif untuk merekam test mobile. Web
 * menampilkan screenshot + elemen di layar; setiap aksi (Tap, Type, Swipe, …)
 * langsung dijalankan di perangkat dan disimpan sebagai step, lengkap dengan
 * jeda seperti saat direkam.
 */
import type {
  MobileExecutionMode,
  SelectorTestResult,
  Environment,
  MobileActionResult,
  MobileAppConfig,
  MobileInspectorAction,
  MobileInspectorSession,
  MobileScreen,
  UiStep,
  UiTestCase,
} from '@flowqa/shared';
import type { AppService } from './app-service';
import {
  createId,
  MAX_UI_STEP_DELAY_MS,
  MOBILE_EXECUTION_MODE_LABEL,
  MOBILE_EXECUTION_MODES,
  UI_STEP_TYPES,
} from '@flowqa/shared';
import { assertProjectEnvironment } from '../domain/guards';
import { normalizeMobileApp, normalizeUiStep, normalizeUiTest } from '../domain/normalizers';
import { maskUiStep } from '../domain/presenters';
import { buildCapabilities } from '../engine/mobile/capabilities';
import { describeSelector, toLocator } from '../engine/mobile/locators';
import { type MobileDriver, executeMobileStep, explainMobileError } from '../engine/mobile/mobile-executor';
import { parsePageSource } from '../engine/mobile/page-source';
import { noEnvironment, variableResolver, type UiVariables } from '../engine/ui/environment';
import { HttpError, notFound } from '../lib/http';
import { log } from '../lib/log';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { AppiumSettingsService } from './appium-settings-service';
import type { FolderService } from './folder-service';
import { MobileError, type MobileLease, type MobileProviders } from './mobile-driver-provider';

/** Sesi tanpa aktivitas selama ini ditutup otomatis. */
const IDLE_MS = 20 * 60_000;
const MAX_SESSIONS = 2;
const INSPECTOR_TIMEOUT_MS = 4_000;

interface Session extends MobileInspectorSession {
  driver?: MobileDriver;
  lease?: MobileLease;
  environment: Environment;
  resolve: UiVariables;
  lastActivity: number;
  lastActionAt: number;
  /** Rasio piksel screenshot / koordinat Appium (mis. Mock Mode 0.5). */
  scale: number;
  /** Mencegah dua aksi berjalan bersamaan di satu perangkat. */
  busy: boolean;
  /** App project yang direkam (test baru ikut dihubungkan ke app ini). */
  appId: string | null;
}

/** Lebar & tinggi PNG dari header IHDR (tanpa library gambar). */
export function pngSize(base64: string): { width: number; height: number } {
  const header = Buffer.from(base64.slice(0, 64), 'base64');
  if (header.length < 24 || header.toString('ascii', 1, 4) !== 'PNG') return { width: 0, height: 0 };
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** Package aplikasi yang tampil di depan (elemen pertama yang punya package). */
export function foregroundPackageOf(source: string): string {
  return /\bpackage="([^"]+)"/.exec(source)?.[1] ?? '';
}

/** Tunggu sampai page source tidak berubah lagi (default maks. 3 detik). */
async function settleScreen(driver: MobileDriver, maxMs = 3_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  let previous = '';
  await new Promise((r) => setTimeout(r, 300));
  while (Date.now() < deadline) {
    const source = await driver.source().catch(() => '');
    if (source && source === previous) return;
    previous = source;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Step yang tidak mengubah layar / tidak butuh perangkat tidak diputar ulang sebelum merekam lanjutan. */
const NOT_REPLAYED = new Set(['apiScenario']);

export class MobileInspectorService {
  private readonly sessions = new Map<string, Session>();
  private readonly janitor: NodeJS.Timeout;

  constructor(
    private readonly repos: Repositories,
    private readonly folders: FolderService<UiTestCase>,
    private readonly appium: AppiumSettingsService,
    private readonly providers: MobileProviders,
    private readonly apps?: AppService,
  ) {
    this.janitor = setInterval(() => {
      for (const s of this.sessions.values())
        if (Date.now() - s.lastActivity > IDLE_MS) void this.cancel(s.id);
    }, 60_000);
    this.janitor.unref();
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw notFound('Mobile inspector session');
    session.lastActivity = Date.now();
    return session;
  }

  present(session: Session): MobileInspectorSession {
    return {
      id: session.id,
      projectId: session.projectId,
      testCaseId: session.testCaseId,
      name: session.name,
      folderId: session.folderId,
      mobile: session.mobile,
      status: session.busy && session.status === 'ready' ? 'busy' : session.status,
      startedAt: session.startedAt,
      steps: session.steps.map(maskUiStep),
      device: session.device,
      mode: session.mode,
      ...(session.error ? { error: session.error } : {}),
      ...(session.errorCode ? { errorCode: session.errorCode } : {}),
    };
  }

  /**
   * Buka aplikasi di perangkat lewat provider mode yang dipilih (Mock /
   * Emulator / HP). Perangkat dikunci selama sesi; bila sedang dipakai test lain,
   * sesi berstatus QUEUED. Untuk test yang sudah ada, step-nya diputar ulang dulu
   * supaya rekaman dilanjutkan dari layar terakhir.
   */
  start(
    projectId: string,
    input: {
      name?: unknown;
      folderId?: unknown;
      testCaseId?: unknown;
      environmentId?: unknown;
      mobile?: unknown;
      mode?: unknown;
      /** App Android project yang direkam (test baru). */
      appId?: unknown;
    },
  ): MobileInspectorSession {
    const open = [...this.sessions.values()].filter((s) => s.status !== 'stopped' && s.status !== 'failed');
    if (open.length >= MAX_SESSIONS)
      throw new HttpError(
        409,
        'Too many mobile inspector sessions are open. Close one before starting another.',
      );
    const existing = input.testCaseId ? this.repos.uiTests.get(String(input.testCaseId)) : undefined;
    if (input.testCaseId && (!existing || existing.projectId !== projectId)) throw notFound('UI test');
    if (existing && existing.target !== 'mobile')
      throw new HttpError(400, 'This is a web test; record it with the web recorder.');
    const name = String(input.name ?? existing?.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Give the test a name');
    const mobile: MobileAppConfig = existing?.mobile ?? normalizeMobileApp(input.mobile);
    const folderId = this.folders.assertFolder(
      projectId,
      (input.folderId as string) ?? existing?.folderId ?? null,
    );
    const environment = input.environmentId
      ? assertProjectEnvironment(this.repos, projectId, input.environmentId)
      : noEnvironment();
    const resolve = variableResolver(environment);
    // App yang direkam: dari test yang dilanjutkan, atau dipilih saat membuat test baru.
    const chosenApp = existing?.appId ?? (input.appId ? String(input.appId) : null);
    const appRef = { projectId, appId: chosenApp };
    if (chosenApp) {
      const app = this.repos.apps.get(chosenApp);
      if (!app || app.projectId !== projectId || app.platform !== 'android')
        throw new HttpError(400, 'Choose an Android app of this project');
    }
    const mode: MobileExecutionMode = (MOBILE_EXECUTION_MODES as readonly string[]).includes(
      String(input.mode),
    )
      ? (input.mode as MobileExecutionMode)
      : (this.apps?.mode(appRef) ?? this.appium.current().defaultMode);
    try {
      buildCapabilities(mobile, this.appium.current().capabilities, resolve);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    const session: Session = {
      id: createId('mob'),
      projectId,
      testCaseId: existing?.id ?? null,
      name,
      folderId,
      mobile,
      mode,
      status: 'starting',
      startedAt: nowIso(),
      steps: [],
      device: `Android · ${MOBILE_EXECUTION_MODE_LABEL[mode]}`,
      environment,
      resolve,
      lastActivity: Date.now(),
      lastActionAt: Date.now(),
      scale: 1,
      busy: true,
      appId: appRef.appId ?? null,
    };
    this.sessions.set(session.id, session);

    void (async () => {
      try {
        const lease = await this.providers.get(mode).acquire({
          appId: appRef.appId ?? undefined,
          formFactor: this.apps?.formFactor(appRef) || undefined,
          config: this.apps?.config(appRef, mobile, mode) ?? mobile,
          resolve,
          owner: `Mobile Inspector ${session.id}`,
          secrets: environment.variables.filter((v) => v.secret).map((v) => v.value),
          onQueued: () => {
            session.status = 'queued';
            session.device = 'Waiting for a free device…';
          },
          onStatus: (message) => {
            if (session.status === 'queued') session.status = 'starting';
            session.device = message;
          },
        });
        session.lease = lease;
        session.driver = lease.driver;
        session.status = 'starting';
        session.device = [lease.info.device, lease.info.androidVersion].filter(Boolean).join(' · ');
        if (!this.sessions.has(session.id)) return void (await lease.release());
        for (const step of existing?.steps ?? []) {
          if (step.disabled || NOT_REPLAYED.has(step.type)) continue;
          await executeMobileStep(lease.driver, step, resolve).catch((error) => {
            throw new Error(`Replaying step "${step.description}" failed: ${explainMobileError(error)}`);
          });
        }
        // Aplikasi yang baru dibuka biasanya masih di splash screen: tunggu layarnya tenang dulu.
        session.device = `${session.device} · waiting for the screen to settle…`;
        await settleScreen(lease.driver, 6_000);
        session.device = [lease.info.device, lease.info.androidVersion].filter(Boolean).join(' · ');
        session.status = 'ready';
      } catch (error) {
        session.status = 'failed';
        session.error = explainMobileError(error);
        if (error instanceof MobileError) session.errorCode = error.code;
        log.warn(`mobile inspector failed to start: ${session.error}`);
        await session.lease?.release().catch(() => {});
        session.lease = undefined;
        session.driver = undefined;
      } finally {
        session.busy = false;
        session.lastActionAt = Date.now();
      }
    })();
    return this.present(session);
  }

  private ready(id: string): Session & { driver: MobileDriver } {
    const session = this.get(id);
    if (session.status === 'starting' || session.status === 'queued')
      throw new HttpError(409, 'The app is still starting on the device.');
    if (!session.driver || session.status !== 'ready')
      throw new HttpError(409, session.error ?? 'This inspector session is closed.');
    return session as Session & { driver: MobileDriver };
  }

  /** Screenshot + elemen di layar (bounds dalam piksel screenshot). */
  async screen(id: string): Promise<MobileScreen> {
    const session = this.ready(id);
    const { driver } = session;
    const [screenshot, source, window] = await Promise.all([
      driver.screenshot(),
      driver.session.source(),
      driver.windowRect().catch(() => ({ x: 0, y: 0, width: 0, height: 0 })),
    ]).catch((error) => {
      throw new HttpError(502, explainMobileError(error));
    });
    const size = pngSize(screenshot);
    // Screenshot bisa lebih kecil/besar dari koordinat Appium (mis. Mock Mode, layar HiDPI).
    session.scale = window.width && size.width ? size.width / window.width : 1;
    return {
      screenshot,
      width: size.width || window.width,
      height: size.height || window.height,
      elements: parsePageSource(source, 'android', session.scale),
      takenAt: nowIso(),
      foregroundPackage: foregroundPackageOf(source) || undefined,
      appPackage: driver.appId || undefined,
    };
  }

  /** "Test selector": berapa elemen yang cocok & posisinya (untuk di-highlight). */
  async testSelector(id: string, selector: string): Promise<SelectorTestResult> {
    const session = this.ready(id);
    const described = describeSelector(selector);
    const { using, value } = toLocator(selector);
    try {
      const found = await session.driver.session.findElements(using, value);
      const bounds = await Promise.all(
        found.slice(0, 50).map((e) =>
          session.driver.session
            .rect(e)
            .then((r) => ({
              x: Math.round(r.x * session.scale),
              y: Math.round(r.y * session.scale),
              width: Math.round(r.width * session.scale),
              height: Math.round(r.height * session.scale),
            }))
            .catch(() => null),
        ),
      );
      return {
        selector,
        selectorType: described.selectorType,
        matches: found.length,
        bounds: bounds.filter((b): b is NonNullable<typeof b> => !!b),
      };
    } catch (error) {
      return {
        selector,
        selectorType: described.selectorType,
        matches: 0,
        bounds: [],
        error: explainMobileError(error),
      };
    }
  }

  /** Jalankan aksi di perangkat; bila berhasil (dan `record` tidak false), simpan sebagai step. */
  async action(id: string, input: MobileInspectorAction): Promise<MobileActionResult> {
    const session = this.ready(id);
    const info = UI_STEP_TYPES.find((t) => t.id === input?.type);
    if (!info || !info.targets.includes('mobile'))
      throw new HttpError(400, 'This action is not available on mobile.');
    if (session.busy) throw new HttpError(409, 'The previous action is still running.');
    const step: UiStep = normalizeUiStep({
      type: input.type,
      selectors: Array.isArray(input.selectors) ? input.selectors : [],
      value: input.value ?? '',
      description: input.description,
      sensitive: input.sensitive,
      attribute: input.attribute,
      delayMs: Math.min(Date.now() - session.lastActionAt, MAX_UI_STEP_DELAY_MS),
    });
    if (info.needsTarget && !step.selectors.length)
      throw new HttpError(400, 'Select an element on the screen first.');
    session.busy = true;
    try {
      // Elemen sudah terlihat di layar yang dipilih user, jadi tidak perlu menunggu lama.
      const outcome = await executeMobileStep(
        session.driver,
        { ...step, timeoutMs: step.timeoutMs ?? INSPECTOR_TIMEOUT_MS },
        session.resolve,
      );
      // Selector yang berhasil dipakai diletakkan paling depan.
      if (outcome.usedSelector && step.selectors[0] !== outcome.usedSelector)
        step.selectors = [outcome.usedSelector, ...step.selectors.filter((s) => s !== outcome.usedSelector)];
      if (input.record !== false) session.steps.push(step);
      // Tunggu animasi/transisi selesai supaya screenshot berikutnya menampilkan layar baru.
      if (!step.type.startsWith('assert') && step.type !== 'wait') await settleScreen(session.driver);
      return { session: this.present(session), ok: true, detail: outcome.detail };
    } catch (error) {
      return { session: this.present(session), ok: false, error: explainMobileError(error) };
    } finally {
      session.busy = false;
      session.lastActionAt = Date.now();
    }
  }

  removeStep(id: string, stepId: string): MobileInspectorSession {
    const session = this.get(id);
    session.steps = session.steps.filter((s) => s.id !== stepId);
    return this.present(session);
  }

  /** Simpan: test mobile baru, atau tambahkan step ke test yang direkam lanjutan. */
  async save(id: string, input: { name?: unknown; folderId?: unknown }): Promise<UiTestCase> {
    const session = this.get(id);
    let saved: UiTestCase;
    if (session.testCaseId) {
      const existing = this.repos.uiTests.get(session.testCaseId);
      if (!existing) throw notFound('UI test');
      saved = this.repos.uiTests.save(
        normalizeUiTest({ steps: [...existing.steps, ...session.steps] }, existing.projectId, existing),
      );
    } else {
      if (!session.steps.length) throw new HttpError(400, 'Nothing was recorded yet');
      const test = normalizeUiTest(
        {
          name: input.name ?? session.name,
          target: 'mobile',
          mobile: session.mobile,
          ...(session.appId ? { appId: session.appId } : {}),
          folderId: input.folderId !== undefined ? input.folderId : session.folderId,
          steps: session.steps,
        },
        session.projectId,
      );
      this.folders.assertFolder(test.projectId, test.folderId);
      saved = this.repos.uiTests.save(test);
    }
    await this.cancel(id);
    return saved;
  }

  async stop(id: string): Promise<MobileInspectorSession> {
    const session = this.get(id);
    if (session.status !== 'failed') session.status = 'stopped';
    await session.lease?.release().catch(() => {});
    session.lease = undefined;
    session.driver = undefined;
    return this.present(session);
  }

  async cancel(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    await session.lease?.release().catch(() => {});
  }

  async closeAll(): Promise<void> {
    clearInterval(this.janitor);
    await Promise.all([...this.sessions.keys()].map((id) => this.cancel(id)));
  }
}
