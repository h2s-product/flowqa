/**
 * Sesi rekaman UI: membuka jendela Chrome sungguhan di mesin server, menyuntikkan
 * skrip perekam, lalu mengumpulkan setiap aksi user sebagai UiStep. Hasilnya
 * disimpan menjadi test case baru, atau ditambahkan ke test case yang sudah ada
 * (setelah step lamanya diputar ulang lebih dulu).
 */
import type { Browser, Page } from 'playwright-core';
import type { Environment, RecordingLogin, RecordingSession, UiStep, UiTestCase } from '@flowqa/shared';
import { createId } from '@flowqa/shared';
import { config } from '../config';
import { launchBrowser } from '../engine/ui/browser';
import { RECORDER_BINDING, RECORDER_SCRIPT } from '../engine/ui/recorder-script';
import { executeUiStep, explainUiError, waitForQuiet, watchNetwork } from '../engine/ui/step-executor';
import { HttpError, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { FolderService } from './folder-service';
import {
  normalizeEnvironment,
  normalizeRecordingLogin,
  normalizeUiStep,
  normalizeUiTest,
} from '../domain/normalizers';
import { rememberRecordingInputs, type RememberChoice } from '../domain/recording-variables';
import { findLoginForm, waitForSignedIn } from '../engine/ui/login-form';
import { noEnvironment, variableResolver, type UiVariables } from '../engine/ui/environment';
import { assertProjectEnvironment, assertStartUrl } from '../domain/guards';
import { maskUiStep } from '../domain/presenters';

const SESSION_TTL_MS = 3 * 60 * 60_000;
/** Jeda terekam dibatasi agar saat user diam lama, pemutaran tidak ikut menunggu lama. */
const MAX_RECORDED_DELAY_MS = 8_000;
/** Assertion ditambahkan lewat toolbar perekam — waktu memilihnya tidak perlu ditiru. */
const MAX_ASSERT_DELAY_MS = 1_500;
/** Batas menunggu form login muncul & login selesai (SPA bisa lambat). */
const LOGIN_FORM_TIMEOUT_MS = 15_000;
const SIGN_IN_TIMEOUT_MS = 15_000;
const VARIABLE_ONLY = /^\{\{\s*[\w.-]+\s*\}\}$/;

/**
 * Isian baru di field yang sama dianggap lanjutan (digabung) bila isian sebelumnya
 * kosong, atau keduanya berawalan sama (mengetik lanjut / mengoreksi). Kata kunci
 * yang berbeda — mis. "Admin" lalu "Sales" di kolom pencarian — jadi step terpisah.
 */
export function continuesTyping(previous: string, next: string): boolean {
  if (previous === '') return true;
  if (next === '') return false;
  let common = 0;
  while (common < previous.length && common < next.length && previous[common] === next[common]) common++;
  return common >= Math.min(3, previous.length, next.length);
}

const recordedDelay = (type: string, gapMs: number) =>
  Math.round(
    Math.min(Math.max(gapMs, 0), type.startsWith('assert') ? MAX_ASSERT_DELAY_MS : MAX_RECORDED_DELAY_MS),
  );

interface Session extends RecordingSession {
  browser?: Browser;
  page?: Page;
  environment: Environment;
  lastActivity: number;
  /** Waktu aksi terakhir (ms epoch) — dasar menghitung jeda step berikutnya. */
  lastActionAt: number;
  /** Aksi sebelum waktu ini (login otomatis / replay) tidak direkam ulang. */
  ignoreBefore: number;
}

interface RecordedEvent {
  type?: string;
  selectors?: string[];
  value?: string;
  description?: string;
  sensitive?: boolean;
  /** Kapan aksi terjadi di halaman (ms epoch); untuk fill = awal mengetik. */
  at?: number;
  typingMs?: number;
}

export class UiRecorderService {
  private readonly sessions = new Map<string, Session>();
  private readonly janitor: NodeJS.Timeout;

  constructor(
    private readonly repos: Repositories,
    private readonly folders: FolderService<UiTestCase>,
  ) {
    // Tutup sesi lama yang terlupakan supaya jendela browser tidak menumpuk.
    this.janitor = setInterval(() => {
      for (const session of this.sessions.values())
        if (Date.now() - session.lastActivity > SESSION_TTL_MS) void this.cancel(session.id);
    }, 10 * 60_000);
    this.janitor.unref();
  }

  /** Versi aman untuk dikirim ke UI (tanpa objek browser; nilai rahasia disamarkan). */
  present(session: Session): RecordingSession {
    const { browser, page, environment, lastActivity, lastActionAt, ignoreBefore, ...rest } = session;
    return { ...rest, steps: rest.steps.map(maskUiStep) };
  }

  get(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) throw notFound('Recording');
    return session;
  }

  async start(
    projectId: string,
    input: {
      name?: unknown;
      startUrl?: unknown;
      folderId?: unknown;
      testCaseId?: unknown;
      environmentId?: unknown;
      login?: unknown;
      /** Simpan URL/login yang diketik sebagai variabel environment untuk rekaman berikutnya. */
      remember?: RememberChoice;
    },
  ): Promise<RecordingSession> {
    const active = [...this.sessions.values()].filter((s) => s.status !== 'stopped' && s.status !== 'failed');
    if (active.length >= config.limits.activeRecordings)
      throw new HttpError(409, 'Too many recordings are open. Stop one before starting another.');

    const existing = input.testCaseId ? this.repos.uiTests.get(String(input.testCaseId)) : undefined;
    if (input.testCaseId && (!existing || existing.projectId !== projectId)) throw notFound('UI test');
    if (existing?.target === 'mobile')
      throw new HttpError(400, 'This is a mobile test; record more steps with the Mobile Inspector.');
    const name = String(input.name ?? existing?.name ?? '').trim();
    let startUrl = String(input.startUrl ?? existing?.startUrl ?? '').trim();
    if (!existing) {
      if (!name) throw new HttpError(400, 'Give the test a name');
      assertStartUrl(startUrl);
    }
    const folderId = this.folders.assertFolder(
      projectId,
      (input.folderId as string) ?? existing?.folderId ?? null,
    );
    let environment = input.environmentId
      ? assertProjectEnvironment(this.repos, projectId, input.environmentId)
      : noEnvironment();
    // Login otomatis hanya untuk test baru; test lama sudah punya step login sendiri.
    let login = existing ? null : normalizeRecordingLogin(input.login);
    const remember = input.remember && typeof input.remember === 'object' ? input.remember : null;
    if (!existing && remember && (remember.url || remember.user || remember.password)) {
      if (!environment.id) throw new HttpError(400, 'Choose an environment to save the URL and login in');
      const remembered = rememberRecordingInputs(environment, { startUrl, login }, remember);
      environment = this.repos.environments.save(
        normalizeEnvironment({ ...environment, variables: remembered.variables }, projectId, environment),
      );
      startUrl = remembered.startUrl;
      login = remembered.login;
    }
    const resolve = variableResolver(environment);
    const url = resolve(startUrl);

    const session: Session = {
      id: createId('rec'),
      projectId,
      testCaseId: existing?.id ?? null,
      name,
      startUrl,
      folderId,
      status: 'starting',
      startedAt: nowIso(),
      steps: existing
        ? []
        : [normalizeUiStep({ type: 'navigate', value: startUrl, description: `Open ${startUrl}` })],
      replayed: 0,
      environment,
      lastActivity: Date.now(),
      lastActionAt: Date.now(),
      ignoreBefore: 0,
    };
    this.sessions.set(session.id, session);

    try {
      const browser = await launchBrowser(config.recorderHeadless);
      session.browser = browser;
      const context = await browser.newContext({
        viewport: existing ? existing.viewport : null,
        ignoreHTTPSErrors: true,
      });
      await context.exposeBinding(RECORDER_BINDING, (_source, event: RecordedEvent) =>
        this.onEvent(session, event),
      );
      await context.addInitScript(RECORDER_SCRIPT);
      const page = await context.newPage();
      watchNetwork(page);
      session.page = page;
      browser.on('disconnected', () => {
        if (session.status !== 'failed') session.status = 'stopped';
        session.browser = undefined;
        session.page = undefined;
      });

      if (existing) {
        // Putar ulang step lama dulu agar rekaman dilanjutkan dari kondisi yang sama.
        session.status = 'replaying';
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
        for (const step of existing.steps) {
          // Step API tidak diputar ulang saat merekam lanjutan (tidak mengubah halaman).
          if (step.disabled || step.type === 'apiScenario') continue;
          try {
            await executeUiStep(page, step, resolve);
            session.replayed++;
          } catch (error) {
            session.error = `Replay stopped at "${step.description}": ${explainUiError(error)}. Continue recording from here.`;
            break;
          }
        }
      } else {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (login) await this.signIn(session, page, login, resolve);
      }
      session.ignoreBefore = Date.now();
      if (session.browser) session.status = 'recording';
      // Jeda step pertama dihitung sejak halaman siap direkam.
      session.lastActionAt = Date.now();
    } catch (error) {
      session.status = 'failed';
      session.error = explainUiError(error);
      await session.browser?.close().catch(() => {});
    }
    return this.present(session);
  }

  /** Dipanggil oleh skrip perekam di halaman. Mengembalikan jumlah step (untuk toolbar). */
  private onEvent(session: Session, event: RecordedEvent): number {
    session.lastActivity = Date.now();
    const total = () => session.steps.length;
    if (!event || typeof event.type !== 'string' || session.status !== 'recording') return total();
    if (event.type === '__hello') return total();
    if (event.type === '__stop') {
      // Jangan menutup browser di dalam handler binding; jadwalkan sesudahnya.
      setTimeout(() => void this.stop(session.id), 0);
      return total();
    }

    const at = Number.isFinite(event.at) ? Number(event.at) : Date.now();
    if (at < session.ignoreBefore) return total();
    const step = normalizeUiStep({
      ...event,
      id: undefined,
      timeoutMs: null,
      disabled: false,
      delayMs: recordedDelay(event.type, at - session.lastActionAt),
    });
    if (step.type !== event.type) return total();
    session.lastActionAt = Math.max(session.lastActionAt, at + (step.typingMs ?? 0));
    if (step.type === 'fill' && event.sensitive) this.referenceSecret(session, step);

    const last = session.steps[session.steps.length - 1];
    if (
      step.type === 'fill' &&
      last?.type === 'fill' &&
      last.selectors[0] === step.selectors[0] &&
      continuesTyping(last.value, step.value)
    ) {
      // Lanjutan / koreksi isian yang sama digabung jadi satu step (jeda awal tetap milik isian pertama).
      session.steps[session.steps.length - 1] = {
        ...step,
        id: last.id,
        delayMs: last.delayMs,
        typingMs: (last.typingMs ?? 0) + (step.typingMs ?? 0),
      };
    } else {
      session.steps.push(step);
    }
    return total();
  }

  /** Password yang sama dengan secret environment disimpan sebagai {{VARIABEL}}, bukan nilai aslinya. */
  private referenceSecret(session: Session, step: UiStep): void {
    const secret = session.environment.variables.find((v) => v.secret && v.value && v.value === step.value);
    if (secret) {
      step.value = `{{${secret.key}}}`;
      delete step.sensitive;
    }
  }

  /**
   * Isi form login di halaman awal, lalu simpan langkahnya sebagai step
   * (supaya saat diputar ulang test juga login sendiri). Gagal login tidak
   * menghentikan rekaman: user diminta login manual di jendela Chrome.
   */
  private async signIn(
    session: Session,
    page: Page,
    login: RecordingLogin,
    resolve: UiVariables,
  ): Promise<void> {
    session.status = 'signing-in';
    const manual = 'Sign in in the Chrome window instead — it will be recorded as steps.';
    const form = await findLoginForm(page, login, LOGIN_FORM_TIMEOUT_MS);
    if (!form) {
      session.error = `No login form was found on the start page, so you were not signed in automatically. ${manual}`;
      return;
    }
    // URL halaman form login (bukan URL awal): aplikasi sering mengalihkan "/" → "/login" di browser.
    const loginUrl = page.url();

    const steps: UiStep[] = [];
    if (form.username && login.username)
      steps.push(normalizeUiStep({ type: 'fill', ...form.username, value: login.username }));
    const password = normalizeUiStep({
      type: 'fill',
      ...form.password,
      value: login.password,
      sensitive: !VARIABLE_ONLY.test(login.password.trim()),
    });
    if (password.sensitive) this.referenceSecret(session, password);
    steps.push(password);
    steps.push(
      form.submit
        ? normalizeUiStep({ type: 'click', ...form.submit })
        : normalizeUiStep({
            type: 'press',
            selectors: form.password.selectors,
            value: 'Enter',
            description: 'Press Enter in the password field',
          }),
    );

    for (const step of steps) {
      try {
        await executeUiStep(page, step, resolve);
      } catch (error) {
        session.error = `Automatic sign-in stopped at "${step.description}": ${explainUiError(error)}. ${manual}`;
        return;
      }
    }
    if (!(await waitForSignedIn(page, loginUrl, form.password, SIGN_IN_TIMEOUT_MS))) {
      session.error = `The login form is still shown after signing in — check the username and password (or the environment variables). ${manual}`;
      return;
    }
    session.steps.push(...steps);
    // Baca URL tujuan setelah aplikasi selesai memuat (pengalihan setelah login bisa bertahap).
    await waitForQuiet(page);
    // Pastikan saat diputar ulang login benar-benar berhasil.
    const path = new URL(page.url()).pathname;
    if (path !== new URL(loginUrl).pathname)
      session.steps.push(
        normalizeUiStep({ type: 'assertUrl', value: path, description: `Check page URL contains "${path}"` }),
      );
  }

  async stop(id: string): Promise<RecordingSession> {
    const session = this.get(id);
    if (session.status !== 'failed') session.status = 'stopped';
    await session.browser?.close().catch(() => {});
    return this.present(session);
  }

  removeStep(id: string, stepId: string): RecordingSession {
    const session = this.get(id);
    session.steps = session.steps.filter((s) => s.id !== stepId);
    return this.present(session);
  }

  /** Simpan hasil rekaman: test case baru, atau tambahkan step ke test case yang ada. */
  async save(id: string, input: { name?: unknown; folderId?: unknown }): Promise<UiTestCase> {
    const session = this.get(id);
    if (session.browser) await this.stop(id);
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
          startUrl: session.startUrl,
          folderId: input.folderId !== undefined ? input.folderId : session.folderId,
          steps: session.steps,
        },
        session.projectId,
      );
      this.folders.assertFolder(test.projectId, test.folderId);
      saved = this.repos.uiTests.save(test);
    }
    this.sessions.delete(id);
    return saved;
  }

  async cancel(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.browser?.close().catch(() => {});
    this.sessions.delete(id);
  }

  async closeAll(): Promise<void> {
    clearInterval(this.janitor);
    await Promise.all([...this.sessions.keys()].map((id) => this.cancel(id)));
  }
}
