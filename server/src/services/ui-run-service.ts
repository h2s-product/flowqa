/**
 * Menjalankan UI test case secara otomatis dengan Playwright: setiap step
 * dieksekusi berurutan, diberi screenshot, dan progresnya disimpan agar UI
 * bisa memantau (polling). Step setelah kegagalan ditandai "skipped".
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  MobileExecutionMode,
  UiRunArtifact,
  Environment,
  Run,
  RunTrigger,
  UiRun,
  UiFailureEvidence,
  UiRunPace,
  UiStep,
  UiStepResult,
  UiTestCase,
} from '@flowqa/shared';
import { MOBILE_EXECUTION_MODE_LABEL, createId } from '@flowqa/shared';
import { config } from '../config';
import { launchBrowser } from '../engine/ui/browser';
import {
  UiStepError,
  executeUiStep,
  explainUiError,
  watchNetwork,
  type UiStepOutcome,
} from '../engine/ui/step-executor';
import { analyzeUiFailure, collectWebEvidence, unresolvedVariables } from '../engine/ui/failure-analysis';
import { defaultPace, isPaced, stepDelay, waitUntil } from '../engine/ui/pacing';
import { HttpError, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { NotificationService } from './notification-service';
import { noEnvironment, variableResolver, type UiVariables } from '../engine/ui/environment';
import { assertProjectEnvironment } from '../domain/guards';
import { AppiumError } from '../engine/mobile/appium-client';
import { CapabilityError } from '../engine/mobile/capabilities';
import { executeMobileStep, explainMobileError } from '../engine/mobile/mobile-executor';
import type { AppService } from './app-service';
import type { AppiumSettingsService } from './appium-settings-service';
import { MobileError, type MobileProviders } from './mobile-driver-provider';
import { log } from '../lib/log';
import { isStopped, linkSignal, once, stoppedByOf, untilStopped } from '../lib/stop';

/** Menjalankan API scenario dari UI test dan mengembalikan run + variabel akhirnya. */
export type ApiScenarioRunner = (request: {
  scenarioId: string;
  environmentId: string;
  variables: Record<string, unknown>;
  label: string;
  /** UI run dihentikan → scenario ikut berhenti. */
  signal?: AbortSignal;
}) => Promise<{ run: Run; variables: Record<string, unknown> }>;

const SCREENSHOT_FILE = /^step-\d{1,3}\.(jpg|png)$/;
/** Artefak teks run (log, page source). */
const ARTIFACT_FILE = /^[a-z][a-z0-9-]{0,40}(-\d{1,3})?\.(log|txt|xml)$/;

/** Variabel masuk/keluar satu UI run (E2E Flow). */
interface RunVariables {
  initial: Record<string, unknown>;
  onVariables?: (variables: Record<string, string>) => void;
  /** Tombol Stop untuk run ini. */
  signal?: AbortSignal;
}

const STOPPED = 'Stopped by user';

/** Variabel → nilai yang sudah disimpan "Save element text" di run ini. */
type TriedValues = Map<string, string[]>;

const SECRET_NAME = /pass(word)?|secret|token|api[-_]?key|authorization|credential|private/i;

/** Samarkan variabel yang tampak rahasia sebelum disimpan / ditampilkan. */
export function maskVariables(
  variables: Record<string, string>,
  secrets: string[] = [],
): Record<string, string> {
  const known = secrets.filter((s) => s && s.length >= 3);
  return Object.fromEntries(
    Object.entries(variables).map(([k, v]) => [k, SECRET_NAME.test(k) || known.includes(v) ? '****' : v]),
  );
}

/** Cara menjalankan step & mengambil screenshot di satu jenis target (web / mobile). */
interface StepRunner {
  step(step: UiStep): Promise<UiStepOutcome>;
  /** Simpan screenshot ke `file` (tanpa ekstensi); kembalikan nama file, atau null. */
  screenshot(dir: string, name: string): Promise<string | null>;
  explain(error: unknown): string;
  /** Dipanggil sekali saat step pertama gagal (simpan page source, log). */
  onFailure?: () => Promise<void>;
  /** Bukti dari halaman saat step gagal (URL, elemen yang cocok, pesan error) untuk analisa. */
  evidence?: (selectors: string[]) => Promise<UiFailureEvidence>;
}

export class UiRunService {
  private readonly active = new Map<string, Promise<UiRun>>();
  /** Run yang sedang berjalan / antre → pengendali Stop-nya. */
  private readonly controllers = new Map<string, { controller: AbortController; run: UiRun }>();
  /** Jumlah UI run web yang sedang berjalan (batas config.limits.concurrentUiRuns). Test mobile diatur DeviceLockManager. */
  private webRuns = 0;

  constructor(
    private readonly repos: Repositories,
    private readonly notifier?: NotificationService,
    /** Menjalankan API scenario untuk step "Run API scenario" (RunService.runEmbedded). */
    private readonly apiScenarios?: ApiScenarioRunner,
    /** Server Appium untuk test mobile. */
    private readonly appium?: AppiumSettingsService,
    /** Mock / Android Emulator / Android Device. */
    private readonly mobileProviders?: MobileProviders,
    /** App project: mode & serial bawaan, phone/tablet, Firebase. */
    private readonly apps?: AppService,
  ) {}

  start(
    testId: string,
    options: {
      headless?: boolean;
      pace?: UiRunPace;
      environmentId?: string | null;
      trigger?: RunTrigger;
      /** false = jangan kirim email (bulk run mengirim ringkasan sendiri). */
      notify?: boolean;
      scheduleName?: string;
      /** Test mobile: Mock, Android Emulator, atau Android Device (bawaan: Settings). */
      mode?: MobileExecutionMode;
      /** Variabel awal dari node sebelumnya (E2E Flow); dipakai sebagai {{nama}}. */
      initialVariables?: Record<string, unknown>;
      /** Menerima variabel akhir (nilai asli, hanya di memori) setelah run selesai. */
      onVariables?: (variables: Record<string, string>) => void;
      /** Run induk (E2E Flow) dihentikan → run ini ikut berhenti. */
      signal?: AbortSignal;
    } = {},
  ): UiRun {
    const test = this.repos.uiTests.get(testId);
    if (!test) throw notFound('UI test');
    if (!test.steps.some((s) => !s.disabled)) throw new HttpError(400, 'This test has no steps to run yet');
    const isMobile = test.target === 'mobile';
    if (!isMobile && this.webRuns >= config.limits.concurrentUiRuns)
      throw new HttpError(
        409,
        `At most ${config.limits.concurrentUiRuns} UI tests can run at the same time. Try again shortly.`,
      );
    const environment = options.environmentId
      ? assertProjectEnvironment(this.repos, test.projectId, options.environmentId)
      : noEnvironment();

    const now = nowIso();
    const mobile = isMobile;
    // Pilihan saat Run → bawaan app → bawaan Settings → Appium.
    const mode: MobileExecutionMode =
      this.apps?.mode(test, options.mode) ?? options.mode ?? this.appium?.current().defaultMode ?? 'emulator';
    // Aplikasi mobile selalu tampil di perangkat/emulator; "headless" hanya berlaku untuk web.
    const headless = mobile ? false : (options.headless ?? true);
    const run: UiRun = {
      id: createId('uir'),
      projectId: test.projectId,
      testCaseId: test.id,
      testName: test.name,
      ...(test.code ? { testCode: test.code } : {}),
      status: 'running',
      trigger: options.trigger ?? 'manual',
      ...(options.scheduleName ? { scheduleName: options.scheduleName } : {}),
      headless,
      // Mobile: "Run" = cepat, "Run visible" = ritme seperti direkam (perangkat selalu terlihat).
      pace: options.pace ?? defaultPace(options.headless ?? true),
      browser: mobile ? `Android · ${MOBILE_EXECUTION_MODE_LABEL[mode]}` : 'Google Chrome',
      ...(mobile
        ? {
            target: 'mobile' as const,
            mobile: {
              mode,
              device: '',
              udid: '',
              androidVersion: '',
              appPackage: test.mobile?.appPackage ?? '',
              appVersion: '',
              appiumVersion: '',
            },
          }
        : {}),
      startedAt: now,
      finishedAt: null,
      durationMs: 0,
      counts: { total: test.steps.length, passed: 0, failed: 0, skipped: 0 },
      steps: test.steps.map((s, index) => ({
        index,
        stepId: s.id,
        description: s.description,
        type: s.type,
        status: 'queued',
      })),
      createdAt: now,
      updatedAt: now,
    };
    this.persist(run);

    if (!mobile) this.webRuns++;
    const controller = new AbortController();
    linkSignal(controller, options.signal);
    this.controllers.set(run.id, { controller, run });
    const vars: RunVariables = {
      initial: options.initialVariables ?? {},
      onVariables: options.onVariables,
      signal: controller.signal,
    };
    const execute = mobile
      ? this.executeMobile(test, run, environment, mode, vars)
      : this.execute(test, run, environment, vars);
    const job = execute
      .catch((error) => {
        if (isStopped(error) || controller.signal.aborted) {
          run.steps.forEach((s) => {
            if (s.status === 'queued' || s.status === 'running')
              Object.assign(s, { status: 'skipped', error: STOPPED });
          });
          return run;
        }
        // Error yang sudah dijelaskan (Appium tidak jalan, perangkat tidak ada) tidak perlu stack trace.
        if (
          error instanceof MobileError ||
          error instanceof AppiumError ||
          error instanceof CapabilityError ||
          error instanceof UiStepError
        )
          log.warn(`UI run could not run: ${(error as Error).message}`);
        else log.error('UI run crashed', error);
        run.failureReason = mobile ? explainMobileError(error) : explainUiError(error);
        if (error instanceof MobileError) {
          run.errorCode = error.code;
          this.saveErrorDetails(run, error);
        }
        // Test yang tidak bisa dimulai = ERROR (bukan FAILED).
        if (mobile) run.status = 'error';
        run.steps.forEach((s) => {
          if (s.status === 'queued' || s.status === 'running') s.status = 'skipped';
        });
        return run;
      })
      .then(() => {
        if (controller.signal.aborted) run.stoppedBy ??= stoppedByOf(controller.signal);
        return this.finish(run, controller.signal.aborted);
      })
      .then((finished) => {
        // Run yang sengaja dihentikan tidak dikirim lewat email.
        if (options.notify !== false && finished.status !== 'stopped') this.notifier?.uiRun(finished);
        return finished;
      })
      .finally(() => {
        this.active.delete(run.id);
        this.controllers.delete(run.id);
        if (!mobile) this.webRuns--;
      });
    this.active.set(run.id, job);
    return run;
  }

  /**
   * Jalankan banyak UI test berurutan di latar belakang (satu selesai, baru yang
   * berikutnya), sambil menghormati batas UI run bersamaan. Test tanpa step aktif
   * dilewati. Mengembalikan test yang akan dijalankan & yang dilewati.
   */
  startBatch(
    projectId: string,
    testIds: string[],
    options: {
      headless?: boolean;
      environmentId?: string | null;
      trigger?: RunTrigger;
      /** Nama jadwal (Test Scheduler); ditampilkan di run & judul email ringkasan. */
      scheduleName?: string;
      /** Test mobile dalam batch: mode eksekusi (bawaan: Settings). */
      mode?: MobileExecutionMode;
      /** Dipanggil setiap satu test selesai, dan sekali lagi (done = true) setelah semuanya selesai. */
      onProgress?: (runs: UiRun[], done: boolean) => void;
    } = {},
  ): { queued: UiTestCase[]; skipped: UiTestCase[] } {
    if (options.environmentId) assertProjectEnvironment(this.repos, projectId, options.environmentId);
    const tests = [...new Set(testIds)]
      .map((id) => this.repos.uiTests.get(id))
      .filter((t): t is UiTestCase => !!t && t.projectId === projectId);
    const runnable = (t: UiTestCase) => t.steps.some((s) => !s.disabled);
    const queued = tests.filter(runnable);
    const skipped = tests.filter((t) => !runnable(t));
    void (async () => {
      const finished: UiRun[] = [];
      const { onProgress, ...runOptions } = options;
      for (const test of queued) {
        try {
          await this.waitForSlot();
          const run = await this.wait(
            this.start(test.id, { ...runOptions, trigger: options.trigger ?? 'manual', notify: false }).id,
          );
          if (run) finished.push(run);
          onProgress?.(finished, false);
          // Satu run di batch/jadwal dihentikan → sisa batch juga tidak dijalankan (dan tidak ada email).
          if (run?.status === 'stopped') {
            onProgress?.(finished, true);
            return;
          }
        } catch (error) {
          log.warn(`batch UI run skipped "${test.name}": ${(error as Error).message}`);
        }
      }
      onProgress?.(finished, true);
      // Satu email ringkasan, bukan satu email per test.
      if (finished.length) this.notifier?.uiBatch(projectId, finished, options.scheduleName);
    })();
    return { queued, skipped };
  }

  /** Tunggu sampai ada slot UI run web kosong (batas config.limits.concurrentUiRuns). */
  private async waitForSlot(): Promise<void> {
    while (this.webRuns >= config.limits.concurrentUiRuns) await new Promise((r) => setTimeout(r, 500));
  }

  wait(runId: string): Promise<UiRun> | undefined {
    return this.active.get(runId);
  }

  /**
   * Hentikan UI run yang sedang berjalan atau antre: browser / sesi Appium
   * ditutup (perangkat langsung bebas untuk antrean berikutnya), step yang
   * belum jalan dilewati, API scenario di dalamnya ikut berhenti.
   */
  stop(runId: string, stoppedBy?: string): UiRun {
    const active = this.controllers.get(runId);
    if (!active) {
      const run = this.repos.uiRuns.get(runId);
      if (!run) throw notFound('UI run');
      throw new HttpError(409, 'This run has already finished.');
    }
    active.run.stoppedBy ??= stoppedBy;
    active.controller.abort(stoppedBy ?? 'user');
    this.persist(active.run);
    return active.run;
  }

  /**
   * Nilai {{variabel}} yang disimpan run-run sebelumnya dari test ini (terbaru dulu),
   * untuk "Save element text" yang tidak boleh memakai nilai yang sama dua kali.
   */
  private usedValuesFor(test: UiTestCase, current: UiRun, tried: TriedValues) {
    return (variable: string, includeHistory: boolean): string[] => [
      ...(includeHistory
        ? this.repos.uiRuns
            .recent({ parentId: test.id }, 500)
            .filter((r) => r.id !== current.id)
            .map((r) => r.variables?.[variable] ?? '')
            .filter((v) => v && v !== '****')
        : []),
      ...(tried.get(variable) ?? []),
    ];
  }

  /** Path aman ke file screenshot / artefak sebuah run (null bila nama file tidak valid). */
  screenshotPath(runId: string, file: string): string | null {
    if (!(SCREENSHOT_FILE.test(file) || ARTIFACT_FILE.test(file)) || !/^uir_[a-z0-9]+$/.test(runId))
      return null;
    return path.join(config.uiArtifactsDir, runId, file);
  }

  /** Simpan artefak teks (log, page source) dan catat di run. */
  private writeArtifact(
    run: UiRun,
    file: string,
    label: string,
    kind: UiRunArtifact['kind'],
    content: string,
  ) {
    if (!content.trim()) return;
    fs.writeFileSync(path.join(this.artifactsDir(run), file), content);
    run.artifacts = [...(run.artifacts ?? []).filter((a) => a.file !== file), { file, label, kind }];
  }

  /** Detail error mobile (log Appium, capabilities, perangkat) sebagai artefak run. */
  private saveErrorDetails(run: UiRun, error: MobileError) {
    const { appiumLog, device, capabilities } = error.details;
    if (appiumLog) this.writeArtifact(run, 'appium.log', 'Appium log', 'appium-log', appiumLog);
    if (device || capabilities)
      this.writeArtifact(
        run,
        'session-request.txt',
        'Session request',
        'appium-log',
        `Error: ${error.code}\n${error.message}\n\nDevice: ${device ?? '-'}\n\nCapabilities:\n${JSON.stringify(capabilities ?? {}, null, 2)}\n`,
      );
  }

  private artifactsDir(run: UiRun): string {
    const dir = path.join(config.uiArtifactsDir, run.id);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Test web: Playwright + Chrome. */
  private async execute(
    test: UiTestCase,
    run: UiRun,
    environment: Environment,
    vars: RunVariables = { initial: {} },
  ): Promise<void> {
    const resolve = this.resolverFor(environment, vars);
    // Nilai "Save element text" yang sudah dicoba di run ini (dilewati saat retry).
    const tried: TriedValues = new Map();
    const launching = launchBrowser(run.headless);
    const browser = await untilStopped(launching, vars.signal).catch((error) => {
      // Dihentikan saat Chrome masih dibuka: tutup begitu sudah terbuka.
      if (isStopped(error)) void launching.then((b) => b.close()).catch(() => {});
      throw error;
    });
    run.browser = `Google Chrome ${browser.version()}`;
    // Stop → tutup browser sekarang juga (step yang sedang menunggu langsung berhenti).
    const closeOnStop = () => void browser.close().catch(() => {});
    vars.signal?.addEventListener('abort', closeOnStop, { once: true });
    try {
      const context = await browser.newContext({ viewport: test.viewport, ignoreHTTPSErrors: true });
      const page = await context.newPage();
      watchNetwork(page);
      await this.runSteps(
        test,
        run,
        environment,
        resolve,
        {
          step: (step) => executeUiStep(page, step, resolve, run.pace, this.usedValuesFor(test, run, tried)),
          screenshot: async (dir, name) => {
            const file = `${name}.jpg`;
            const shot = await page
              .screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 60, timeout: 5_000 })
              .catch(() => null);
            return shot ? file : null;
          },
          explain: explainUiError,
          evidence: (selectors) => collectWebEvidence(page, selectors),
        },
        vars,
        tried,
      );
    } finally {
      vars.signal?.removeEventListener('abort', closeOnStop);
      await browser.close().catch(() => {});
    }
  }

  /**
   * Test mobile: provider (Mock / Emulator / HP) membuat sesi Appium setelah
   * perangkatnya terkunci untuk run ini. Selama menunggu perangkat, run berstatus
   * QUEUED. Bila gagal, page source, log Appium & logcat disimpan sebagai artefak.
   */
  private async executeMobile(
    test: UiTestCase,
    run: UiRun,
    environment: Environment,
    mode: MobileExecutionMode,
    vars: RunVariables = { initial: {} },
  ): Promise<void> {
    if (!this.mobileProviders) throw new UiStepError('Mobile tests are not available on this server.');
    if (!test.mobile)
      throw new MobileError('APP_NOT_CONFIGURED', 'Set the app and device for this mobile test first.');
    const resolve = this.resolverFor(environment, vars);
    // Nilai "Save element text" yang sudah dicoba di run ini (dilewati saat retry).
    const tried: TriedValues = new Map();
    const secrets = [
      ...test.steps.filter((s) => s.sensitive).map((s) => resolve(s.value)),
      ...environment.variables.filter((v) => v.secret).map((v) => v.value),
    ];
    const acquiring = this.mobileProviders.get(mode).acquire({
      signal: vars.signal,
      appId: test.appId ?? undefined,
      formFactor: this.apps?.formFactor(test) || undefined,
      config: this.apps?.config(test, test.mobile, mode) ?? test.mobile,
      resolve,
      owner: `UI run ${run.id}`,
      secrets,
      onQueued: () => {
        run.status = 'queued';
        run.browser = `Android · waiting for a free ${mode === 'device' ? 'device' : mode === 'mock' ? 'mock device' : 'emulator'}`;
        this.persist(run);
      },
      onStatus: (message) => {
        // Setelah antre, keterangan berikutnya datang saat perangkat sudah didapat.
        run.status = 'running';
        run.browser = `Android · ${message}`;
        this.persist(run);
      },
    });
    // Dihentikan saat perangkat/Appium masih disiapkan: lepas sesinya begitu jadi.
    const lease = await untilStopped(acquiring, vars.signal).catch((error) => {
      if (isStopped(error)) void acquiring.then((l) => l.release()).catch(() => {});
      throw error;
    });
    const release = once(() => lease.release());
    // Stop → tutup sesi Appium sekarang juga; perangkat langsung bebas untuk antrean berikutnya.
    const releaseOnStop = () => void release().catch(() => {});
    vars.signal?.addEventListener('abort', releaseOnStop, { once: true });
    run.status = 'running';
    // Waktu mulai = saat perangkat didapat (waktu antre tidak dihitung sebagai durasi test).
    run.startedAt = nowIso();
    run.mobile = lease.info;
    run.browser = [lease.info.androidVersion || 'Android', lease.info.device].filter(Boolean).join(' · ');
    this.persist(run);
    const { driver } = lease;
    try {
      await this.runSteps(
        test,
        run,
        environment,
        resolve,
        {
          step: (step) =>
            executeMobileStep(driver, step, resolve, run.pace, this.usedValuesFor(test, run, tried)),
          screenshot: async (dir, name) => {
            const file = `${name}.png`;
            const data = await driver.screenshot().catch(() => null);
            if (!data) return null;
            await fs.promises.writeFile(path.join(dir, file), Buffer.from(data, 'base64'));
            return file;
          },
          explain: explainMobileError,
          onFailure: async () => {
            const source = await driver.source().catch(() => '');
            this.writeArtifact(
              run,
              'failure-page-source.xml',
              'Page source at failure',
              'page-source',
              source,
            );
            this.writeArtifact(
              run,
              'logcat.txt',
              'ADB log (logcat)',
              'adb-log',
              await lease.deviceLog().catch(() => ''),
            );
          },
        },
        vars,
        tried,
      );
    } finally {
      vars.signal?.removeEventListener('abort', releaseOnStop);
      await release().catch(() => {});
      this.writeArtifact(run, 'appium.log', 'Appium log', 'appium-log', lease.appiumLog());
    }
  }

  /** Jalankan semua step berurutan dengan salah satu runner (web / mobile). */
  /** Resolver {{variabel}} dengan variabel awal dari node E2E Flow sebelumnya. */
  private resolverFor(environment: Environment, vars: RunVariables): UiVariables {
    const resolve = variableResolver(environment);
    for (const [key, value] of Object.entries(vars.initial))
      resolve.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return resolve;
  }

  private async runSteps(
    test: UiTestCase,
    run: UiRun,
    environment: Environment,
    resolve: UiVariables,
    runner: StepRunner,
    vars?: RunVariables,
    tried: TriedValues = new Map(),
  ): Promise<void> {
    try {
      await this.runStepsInner(test, run, environment, resolve, runner, vars?.signal, tried);
    } finally {
      const all = Object.fromEntries(
        Object.entries(resolve.snapshot()).map(([k, v]) => [
          k,
          typeof v === 'string' ? v : JSON.stringify(v),
        ]),
      );
      vars?.onVariables?.(all);
      // Yang disimpan di database disamarkan: nama yang tampak rahasia & nilai step sensitif.
      const secrets = test.steps
        .filter((s) => s.sensitive)
        .map((s) => resolve(s.value))
        .filter(Boolean);
      run.variables = maskVariables(all, [
        ...secrets,
        ...environment.variables.filter((v) => v.secret).map((v) => v.value),
      ]);
    }
  }

  private async runStepsInner(
    test: UiTestCase,
    run: UiRun,
    environment: Environment,
    resolve: UiVariables,
    runner: StepRunner,
    signal?: AbortSignal,
    tried: TriedValues = new Map(),
  ): Promise<void> {
    const dir = this.artifactsDir(run);
    const paced = isPaced(run.pace);
    let failed = false;
    // Titik acuan jeda step berikutnya: awal step sebelumnya, atau akhirnya bila step itu mengetik.
    let anchor: number | null = null;
    // Retry ("bila gagal, ulangi dari step X"): jumlah ulang per step & catatan percobaan gagal.
    const retries = new Map<string, number>();
    const attemptLog = new Map<number, string[]>();
    // "Bila gagal, akhiri test sebagai lulus": nomor step yang mengakhiri test lebih awal.
    let endedAt: number | null = null;
    // "Bila gagal, lewati N step": step sampai indeks ini dilewati, lalu test berlanjut.
    let skip: { from: number; until: number } | null = null;

    for (let index = 0; index < test.steps.length; index++) {
      const step = test.steps[index];
      const result = run.steps[index];
      if (step.disabled) {
        Object.assign(result, { status: 'skipped', error: 'Step is turned off' });
        continue;
      }
      if (failed) {
        Object.assign(result, { status: 'skipped', error: 'Skipped because an earlier step failed' });
        continue;
      }
      if (endedAt !== null) {
        Object.assign(result, {
          status: 'skipped',
          error: `Not needed: the test ended at step ${endedAt + 1} (its condition was not met)`,
        });
        continue;
      }
      if (skip && index <= skip.until) {
        Object.assign(result, {
          status: 'skipped',
          error: `Not needed: the condition of step ${skip.from + 1} was not met`,
        });
        continue;
      }
      if (signal?.aborted) {
        Object.assign(result, { status: 'skipped', error: STOPPED });
        continue;
      }
      if (paced && anchor !== null)
        await untilStopped(waitUntil(anchor, stepDelay(step)), signal).catch(() => {});
      if (signal?.aborted) {
        Object.assign(result, { status: 'skipped', error: STOPPED });
        continue;
      }
      result.status = 'running';
      result.startedAt = nowIso();
      this.persist(run);
      const started = performance.now();
      anchor = Date.now();
      try {
        const { artifact, ...outcome } = await untilStopped(
          step.type === 'apiScenario'
            ? this.runApiScenario(test, step, environment, resolve, result, signal)
            : runner.step(step),
          signal,
        );
        Object.assign(result, outcome);
        if (artifact) {
          const file = `step-${index + 1}-${artifact.name}`;
          this.writeArtifact(
            run,
            file,
            `Step ${index + 1} · ${artifact.name}`,
            'page-source',
            artifact.content,
          );
          result.artifact = file;
        }
        result.status = 'passed';
        // Nilai yang disimpan "Save element text" dilewati bila bagian ini diulang (retry).
        if (step.type === 'saveText' && step.saveAs) {
          const saved = resolve.snapshot()[step.saveAs];
          if (typeof saved === 'string' && saved)
            tried.set(step.saveAs, [...(tried.get(step.saveAs) ?? []), saved]);
        }
        const log = attemptLog.get(index);
        if (log?.length)
          result.detail = `${result.detail ? `${result.detail} · ` : ''}passed on attempt ${log.length + 1} (${log.join(' | ')})`;
      } catch (error) {
        // Dihentikan saat step berjalan (browser/sesi ditutup) = bukan kegagalan test.
        if (isStopped(error) || signal?.aborted) {
          Object.assign(result, {
            status: 'skipped',
            error: `${STOPPED} while this step was running`,
            durationMs: Math.round(performance.now() - started),
            finishedAt: nowIso(),
          });
          this.persist(run);
          continue;
        }
        const reason = runner.explain(error);
        // "Bila gagal, akhiri test sebagai lulus": kondisi tidak terpenuhi → sisa step dilewati.
        if (step.onFailPass) {
          Object.assign(result, {
            status: 'skipped',
            error: `Condition not met, so the test ends here and counts as passed (${reason})`,
          });
          endedAt = index;
          result.durationMs = Math.round(performance.now() - started);
          result.finishedAt = nowIso();
          const shot = await runner.screenshot(dir, `step-${index + 1}`);
          if (shot) result.screenshot = shot;
          this.persist(run);
          continue;
        }
        // "Bila gagal, lewati N step": kondisi tidak terpenuhi → bagian itu dilewati, test berlanjut.
        if (step.onFailSkip) {
          const until = Math.min(index + step.onFailSkip, test.steps.length - 1);
          Object.assign(result, {
            status: 'skipped',
            error:
              until > index
                ? `Condition not met, so steps ${index + 2}–${until + 1} are skipped and the test continues (${reason})`
                : `Condition not met; the test continues (${reason})`,
          });
          skip = { from: index, until };
          result.durationMs = Math.round(performance.now() - started);
          result.finishedAt = nowIso();
          const shot = await runner.screenshot(dir, `step-${index + 1}`);
          if (shot) result.screenshot = shot;
          this.persist(run);
          continue;
        }
        // "Bila gagal, ulangi dari step X": kembali ke step itu selama jatah ulang masih ada.
        const target = step.retryFrom ? test.steps.findIndex((s) => s.id === step.retryFrom) : -1;
        const used = retries.get(step.id) ?? 0;
        const max = step.retryMax ?? 3;
        if (target >= 0 && target <= index && used < max) {
          retries.set(step.id, used + 1);
          attemptLog.set(index, [...(attemptLog.get(index) ?? []), `attempt ${used + 1} failed: ${reason}`]);
          for (let i = target; i <= index; i++) {
            const r = run.steps[i];
            for (const key of [
              'startedAt',
              'finishedAt',
              'durationMs',
              'usedSelector',
              'detail',
              'error',
              'screenshot',
              'artifact',
              'apiRunId',
              'analysis',
            ] as const)
              delete r[key];
            r.status = 'queued';
          }
          if (skip && target <= skip.from) skip = null;
          result.detail = `Retrying from step ${target + 1} (${used + 1}/${max}): ${reason}`;
          this.persist(run);
          index = target - 1; // loop menambah 1
          continue;
        }
        result.status = 'failed';
        const log = attemptLog.get(index);
        result.error = log?.length
          ? `${reason} (after ${log.length} ${log.length === 1 ? 'retry' : 'retries'}: ${log.join(' | ')})`
          : reason;
        failed = true;
        result.analysis = await this.analyzeFailure(
          test,
          run,
          index,
          error,
          reason,
          runner,
          resolve,
          log?.length,
        );
        await runner.onFailure?.().catch(() => {});
      }
      result.durationMs = Math.round(performance.now() - started);
      if (step.type === 'fill') anchor = Date.now();
      result.finishedAt = nowIso();
      // Step API tidak mengubah layar, jadi tidak perlu screenshot.
      if (step.type !== 'apiScenario') {
        const file = await runner.screenshot(dir, `step-${index + 1}`);
        if (file) result.screenshot = file;
      }
      this.persist(run);
    }
  }

  /**
   * Analisa step yang gagal: pesan error teknis + bukti dari halaman + step sebelumnya
   * yang dilewati karena kondisi → penjelasan, kemungkinan penyebab, dan saran.
   * Tidak pernah membuat run gagal karena analisanya sendiri bermasalah.
   */
  private async analyzeFailure(
    test: UiTestCase,
    run: UiRun,
    index: number,
    error: unknown,
    reason: string,
    runner: StepRunner,
    resolve: UiVariables,
    retries = 0,
  ): Promise<UiStepResult['analysis']> {
    const step = test.steps[index];
    const safe = (text: string) => {
      try {
        return resolve(text);
      } catch {
        return text;
      }
    };
    try {
      const selectors = step.selectors.map(safe);
      const evidence = runner.evidence ? await runner.evidence(selectors).catch(() => undefined) : undefined;
      const missing = unresolvedVariables([...step.selectors, step.value ?? ''], resolve);
      const skippedBefore = run.steps
        .slice(Math.max(0, index - 3), index)
        .filter((s) => s.status === 'skipped' && s.error)
        .map((s) => ({ index: s.index, description: s.description, reason: s.error! }));
      const raw = error instanceof UiStepError ? error.message : ((error as Error)?.message ?? reason);
      return analyzeUiFailure({
        step,
        index,
        // Pesan Playwright lengkap (call log) memuat petunjuk penting, mis. "intercepts pointer events".
        error: raw.includes(reason) ? raw : `${reason}\n${raw}`,
        target: run.target === 'mobile' ? 'mobile' : 'web',
        selectors,
        value: step.type === 'navigate' ? safe(step.value) : undefined,
        evidence: missing.length ? { ...evidence, missingVariables: missing } : evidence,
        skippedBefore,
        retries,
      });
    } catch (analysisError) {
      log.warn(`Could not analyze the failed UI step: ${(analysisError as Error)?.message ?? analysisError}`);
      return undefined;
    }
  }

  /**
   * Step "Run API scenario": variabel UI test dikirim sebagai variabel awal,
   * variabel hasil scenario (capture) kembali ke UI test untuk step berikutnya.
   */
  private async runApiScenario(
    test: UiTestCase,
    step: UiStep,
    environment: Environment,
    variables: UiVariables,
    result: UiStepResult,
    signal?: AbortSignal,
  ): Promise<UiStepOutcome> {
    if (!this.apiScenarios) throw new UiStepError('Running API scenarios is not available here.');
    const scenario = step.apiScenarioId ? this.repos.scenarios.get(step.apiScenarioId) : undefined;
    if (!step.apiScenarioId) throw new UiStepError('Choose the API scenario to run.');
    if (!scenario || scenario.projectId !== test.projectId)
      throw new UiStepError('The API scenario used by this step no longer exists in this project.');
    if (!environment.id)
      throw new UiStepError(
        'Choose an environment (top right) so the API scenario knows which server to call.',
      );

    const before = variables.snapshot();
    const { run, variables: after } = await this.apiScenarios({
      scenarioId: scenario.id,
      environmentId: environment.id,
      variables: before,
      label: `From UI test "${test.name}"`,
      signal,
    });
    result.apiRunId = run.id;
    const changed = Object.entries(after).filter(([key, value]) => before[key] !== value);
    for (const [key, value] of changed)
      variables.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    const steps = run.steps.filter((s) => s.status !== 'not-run').length;
    if (run.status !== 'passed')
      throw new UiStepError(
        `API scenario "${scenario.name}" failed${run.failedStep ? ` at "${run.failedStep}"` : ''}: ${run.failureReason ?? 'see the API run for details'}.`,
      );
    return {
      detail:
        `API scenario "${scenario.name}" passed · ${steps} step${steps === 1 ? '' : 's'}` +
        (changed.length ? ` · saved ${changed.map(([key]) => `{{${key}}}`).join(', ')}` : ''),
    };
  }

  private finish(run: UiRun, stopped = false): UiRun {
    const counts = { total: run.steps.length, passed: 0, failed: 0, skipped: 0 };
    run.steps.forEach((s) => {
      if (s.status === 'passed' || s.status === 'failed' || s.status === 'skipped') counts[s.status]++;
    });
    const failed = run.steps.find((s) => s.status === 'failed');
    run.counts = counts;
    // ERROR (test tidak bisa dijalankan) tetap ERROR; selain itu gagal bila ada step gagal.
    run.status = stopped
      ? 'stopped'
      : run.status === 'error'
        ? 'error'
        : counts.failed || run.failureReason
          ? 'failed'
          : 'passed';
    if (!stopped)
      run.failureReason ??= failed
        ? `Step ${failed.index + 1} · ${failed.description}: ${failed.error}`
        : undefined;
    run.finishedAt = nowIso();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    this.persist(run);
    // Buang run lama beserta screenshot-nya.
    for (const id of this.repos.uiRuns.prune(config.limits.storedUiRuns))
      fs.rmSync(path.join(config.uiArtifactsDir, id), { recursive: true, force: true });
    return run;
  }

  private persist(run: UiRun): void {
    run.updatedAt = nowIso();
    this.repos.uiRuns.save(run);
  }
}
