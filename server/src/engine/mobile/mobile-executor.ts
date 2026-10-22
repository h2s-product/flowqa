/**
 * Menjalankan satu UI step di aplikasi Android lewat Appium (UiAutomator2).
 * Dipakai oleh runner (test mobile) dan Mobile Inspector (aksi yang direkam
 * langsung dijalankan). Sama untuk Mock Mode dan Real Android Mode.
 */
import type { MobilePlatform, UiRunPace, UiStep } from '@flowqa/shared';
import { FIREBASE_LATEST_APP, extractSavedText, firstUnused, type UsedValues } from '@flowqa/shared';
import type { UiVariables } from '../ui/environment';
import {
  DEFAULT_STEP_TIMEOUT_MS,
  UiStepError,
  assertNotVisible,
  assertSorted,
  type UiStepOutcome,
} from '../ui/step-executor';
import { AppiumError, type AppiumSession, type Rect } from './appium-client';
import { toLocator } from './locators';

const MAX_WAIT_MS = 60_000;
const POLL_MS = 400;
const LONG_PRESS_MS = 1_000;
const MAX_SCROLLS = 12;
/** Jeda setelah menggeser agar animasi gulir selesai. */
const SCROLL_SETTLE_MS = 300;
/** Jeda setelah swipe: daftar panjang masih bergulir sebentar setelah jari diangkat. */
const SWIPE_SETTLE_MS = 700;
export const SWIPE_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
type Direction = (typeof SWIPE_DIRECTIONS)[number];

/** Nama tombol Android → keycode (KeyEvent). Angka juga diterima langsung. */
export const ANDROID_KEYCODES: Record<string, number> = {
  HOME: 3,
  BACK: 4,
  CALL: 5,
  ENDCALL: 6,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  CAMERA: 27,
  TAB: 61,
  SPACE: 62,
  ENTER: 66,
  DEL: 67,
  BACKSPACE: 67,
  MENU: 82,
  SEARCH: 84,
  ESCAPE: 111,
  FORWARD_DEL: 112,
  MOVE_HOME: 122,
  MOVE_END: 123,
  APP_SWITCH: 187,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sesi Appium + informasi aplikasi yang dibutuhkan step. */
export class MobileDriver {
  private window?: Rect;
  readonly platform: MobilePlatform = 'android';

  constructor(
    readonly session: AppiumSession,
    _platform: MobilePlatform,
    /** appPackage aplikasi yang dites. */
    readonly appId: string,
    /** APK dari test (untuk step "Install APK" tanpa nilai). */
    readonly appPath = '',
    /** APK release Firebase terbaru (step "Install APK" dengan nilai firebase:latest). */
    private readonly latestFirebaseApk?: () => Promise<string>,
  ) {}

  async windowRect(): Promise<Rect> {
    this.window ??= await this.session.windowRect();
    return this.window;
  }

  /** Elemen pertama yang cocok dari daftar selector (yang terlihat diutamakan). */
  async find(selectors: string[], timeoutMs: number): Promise<{ element: string; selector: string }> {
    const found = await this.poll(selectors, timeoutMs);
    if (found) return found;
    throw new UiStepError(
      `Could not find the element on the screen within ${Math.round(timeoutMs / 1000)} s. Tried: ${selectors.slice(0, 3).join(' | ')}`,
    );
  }

  /** Seperti `find`, tetapi mengembalikan null bila tidak ada. */
  async poll(selectors: string[], timeoutMs: number): Promise<{ element: string; selector: string } | null> {
    if (!selectors.length) throw new UiStepError('This step has no element selector.');
    const deadline = Date.now() + timeoutMs;
    let hidden: { element: string; selector: string } | null = null;
    for (;;) {
      for (const selector of selectors) {
        const { using, value } = toLocator(selector);
        const element = await this.session.findElement(using, value).catch((error) => {
          // Selector tidak valid → coba selector berikutnya.
          if (error instanceof AppiumError && /invalid (selector|argument)/.test(error.code)) return null;
          throw error;
        });
        if (!element) continue;
        if (await this.session.displayed(element).catch(() => true)) return { element, selector };
        hidden ??= { element, selector };
      }
      if (Date.now() >= deadline) return hidden;
      await sleep(POLL_MS);
    }
  }

  /** Teks elemen; bila kosong dipakai content-desc / hint. */
  async textOf(element: string): Promise<string> {
    const text = await this.session.text(element).catch(() => '');
    if (text) return text;
    for (const name of ['content-desc', 'hint']) {
      const value = await this.session.attribute(element, name).catch(() => null);
      if (value) return value;
    }
    return '';
  }

  async center(element: string) {
    const r = await this.session.rect(element);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  /** Geser layar. "up" = jari bergerak ke atas (konten bergulir ke bawah). */
  async swipe(direction: Direction, area?: Rect) {
    const r = area ?? (await this.windowRect());
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const dx = r.width * 0.3;
    const dy = r.height * 0.3;
    const path = {
      up: [
        { x: cx, y: cy + dy },
        { x: cx, y: cy - dy },
      ],
      down: [
        { x: cx, y: cy - dy },
        { x: cx, y: cy + dy },
      ],
      left: [
        { x: cx + dx, y: cy },
        { x: cx - dx, y: cy },
      ],
      right: [
        { x: cx - dx, y: cy },
        { x: cx + dx, y: cy },
      ],
    }[direction];
    await this.session.gesture(path, 100, 500);
  }

  async tapAt(x: number, y: number) {
    await this.session.gesture([{ x, y }], 50);
  }

  async hideKeyboard(): Promise<boolean> {
    const shown = await this.session
      .execute<boolean>('mobile: isKeyboardShown')
      .catch(() =>
        this.session.request<boolean>('GET', '/appium/device/is_keyboard_shown').catch(() => true),
      );
    if (!shown) return false;
    await this.session
      .execute('mobile: hideKeyboard', {})
      .catch(() => this.session.request('POST', '/appium/device/hide_keyboard', {}))
      .catch(() => {});
    return true;
  }

  back() {
    return this.session.back();
  }

  async pressKey(key: string) {
    const name = key
      .trim()
      .toUpperCase()
      .replace(/^KEYCODE_/, '');
    const keycode = /^\d+$/.test(name) ? Number(name) : ANDROID_KEYCODES[name];
    if (keycode === undefined)
      throw new UiStepError(
        `"${key}" is not an Android key. Use ${Object.keys(ANDROID_KEYCODES).slice(0, 12).join(', ')}, … or a keycode number.`,
      );
    await this.session.execute('mobile: pressKey', { keycode });
    return name;
  }

  private requireApp() {
    if (!this.appId)
      throw new UiStepError('Set the app package in the test to launch, close or restart the app.');
    return this.appId;
  }

  async launchApp() {
    await this.session.execute('mobile: activateApp', { appId: this.requireApp() });
  }

  async closeApp() {
    await this.session.execute('mobile: terminateApp', { appId: this.requireApp() });
  }

  async restartApp() {
    await this.closeApp().catch(() => {});
    await this.launchApp();
  }

  async installApk(appPath: string) {
    let apk = appPath || this.appPath;
    if (apk === FIREBASE_LATEST_APP) {
      if (!this.latestFirebaseApk)
        throw new UiStepError(
          'Firebase App Distribution is not connected (Settings → Mobile (Android) → Firebase).',
        );
      apk = await this.latestFirebaseApk();
    }
    if (!apk) throw new UiStepError('Enter the APK path, or set the APK of this test.');
    await this.session.execute('mobile: installApp', { appPath: apk, replace: true, grantPermissions: true });
    return apk;
  }

  async deepLink(url: string) {
    await this.session
      .execute('mobile: deepLink', { url, package: this.appId })
      .catch(() => this.session.openUrl(url));
  }

  screenshot() {
    return this.session.screenshot();
  }

  source() {
    return this.session.source();
  }

  quit() {
    return this.session.quit();
  }
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function direction(value: string, fallback: Direction): Direction {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  if ((SWIPE_DIRECTIONS as readonly string[]).includes(v)) return v as Direction;
  throw new UiStepError(`"${value}" is not a direction. Use up, down, left or right.`);
}

async function pollUntil(check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}

/**
 * Titik-titik poligon cembung acak di dalam kotak (sudut diurutkan supaya sisi
 * tidak berpotongan). Setiap panggilan menghasilkan bentuk berbeda.
 */
export function randomPolygon(area: Rect, points: number): { x: number; y: number }[] {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const rx = area.width * 0.35;
  const ry = area.height * 0.35;
  const angles = Array.from(
    { length: points },
    (_, i) => ((i + 0.2 + Math.random() * 0.6) / points) * Math.PI * 2 + Math.random() * 0.1,
  ).sort((a, b) => a - b);
  return angles.map((a) => {
    const scale = 0.6 + Math.random() * 0.4;
    return { x: Math.round(cx + Math.cos(a) * rx * scale), y: Math.round(cy + Math.sin(a) * ry * scale) };
  });
}

/**
 * Jalankan satu step di aplikasi. Jeda antar step (pace "recorded") diatur
 * pemanggil; di sini `pace` hanya memberi jeda kecil setelah mengetik.
 */
export async function executeMobileStep(
  driver: MobileDriver,
  step: UiStep,
  resolve: UiVariables,
  pace: UiRunPace = 'fast',
  /** Nilai {{variabel}} dari run sebelumnya (untuk "Save element text" unik). */
  usedValues?: UsedValues,
): Promise<UiStepOutcome> {
  const selectors = step.selectors.map((s) => (s.includes('{{') ? resolve(s) : s));
  const usedTexts =
    step.type === 'saveText' && step.saveAs ? (usedValues?.(step.saveAs, !!step.unique) ?? []) : [];
  if (step.type === 'saveText' && (step.unique || usedTexts.length))
    return saveUniqueMobileText(
      driver,
      step,
      selectors,
      resolve,
      step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
      usedTexts,
    );
  const timeout = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const value = resolve(step.value ?? '');
  const { session } = driver;

  switch (step.type) {
    case 'navigate':
      if (!/^[a-z][\w+.-]*:\/\//i.test(value))
        throw new UiStepError(`"${value}" is not a deep link, e.g. myapp://orders/42 or https://…`);
      await driver.deepLink(value);
      return {};
    case 'wait':
      await sleep(Math.min(Math.max(Number(value) || 0, 0), MAX_WAIT_MS));
      return {};
    case 'setVariable':
      if (!step.saveAs) throw new UiStepError('Give the value a variable name.');
      resolve.set(step.saveAs, value);
      return { detail: `{{${step.saveAs}}} = "${value}"` };
    case 'apiScenario':
      throw new UiStepError('API scenario steps run only as part of a UI test run.');
    case 'swipe': {
      const dir = direction(value, 'up');
      // Dengan selector: geser di dalam elemen itu (mis. carousel); tanpa: seluruh layar.
      const area = selectors.length
        ? await session.rect((await driver.find(selectors, timeout)).element)
        : undefined;
      await driver.swipe(dir, area);
      // Tunggu guliran (fling) berhenti supaya step berikutnya melihat layar yang sudah diam.
      await sleep(SWIPE_SETTLE_MS);
      return { detail: `Swiped ${dir}` };
    }
    case 'back':
      await driver.back();
      return {};
    case 'pressKey':
      return { detail: `Pressed ${await driver.pressKey(value || 'ENTER')}` };
    case 'hideKeyboard':
      return { detail: (await driver.hideKeyboard()) ? 'Keyboard hidden' : 'The keyboard was not shown' };
    case 'launchApp':
      await driver.launchApp();
      return { detail: `Launched ${driver.appId}` };
    case 'closeApp':
      await driver.closeApp();
      return { detail: `Closed ${driver.appId}` };
    case 'restartApp':
      await driver.restartApp();
      return { detail: `Restarted ${driver.appId}` };
    case 'installApk':
      return { detail: `Installed ${await driver.installApk(value)}` };
    case 'takeScreenshot':
      // Runner menyimpan screenshot setelah setiap step; step ini menandainya secara eksplisit.
      return { detail: 'Screenshot saved' };
    case 'pageSource': {
      const source = await driver.source();
      return {
        detail: `Page source saved (${Math.round(source.length / 1024)} KB)`,
        artifact: { name: 'page-source.xml', content: source },
      };
    }
    case 'scrollTo': {
      // "down" = cari ke bawah (jari menggeser ke atas).
      const dir = direction(value, 'down');
      const swipe: Direction =
        dir === 'down' ? 'up' : dir === 'up' ? 'down' : dir === 'left' ? 'right' : 'left';
      for (let i = 0; i <= MAX_SCROLLS; i++) {
        // Tunggu sebentar di awal (layar mungkin masih dimuat), lalu cek langsung setelah setiap geseran.
        const found = await driver.poll(selectors, i === 0 ? Math.min(timeout, 1_000) : 0);
        if (found && (await session.displayed(found.element).catch(() => false)))
          return {
            usedSelector: found.selector,
            detail: i ? `Found after ${i} scroll${i > 1 ? 's' : ''}` : 'Already visible',
          };
        if (i < MAX_SCROLLS) {
          await driver.swipe(swipe);
          await sleep(SCROLL_SETTLE_MS);
        }
      }
      throw new UiStepError(`The element did not appear after scrolling ${dir} ${MAX_SCROLLS} times.`);
    }
    case 'assertEach':
      return assertEach(driver, selectors, value, timeout);
    case 'assertNotVisible':
      return assertNotVisible(selectors, timeout, async (selector) => {
        const { using, value: v } = toLocator(selector);
        const elements = await driver.session.findElements(using, v).catch(() => [] as string[]);
        const shown: string[] = [];
        for (const e of elements.slice(0, 50))
          if (await driver.session.displayed(e).catch(() => false))
            shown.push(await driver.textOf(e).catch(() => ''));
        return shown;
      });
    case 'assertSorted':
      return assertSorted(selectors, value, timeout, async (selector) => {
        const { using, value: v } = toLocator(selector);
        const elements = await driver.session.findElements(using, v).catch(() => [] as string[]);
        const rows: string[] = [];
        for (const e of elements.slice(0, 100))
          if (await driver.session.displayed(e).catch(() => true)) rows.push(await driver.textOf(e));
        return rows;
      });
  }

  const { element, selector } = await driver.find(selectors, timeout);
  switch (step.type) {
    case 'click':
      await session.click(element);
      break;
    case 'longPress': {
      const { x, y } = await driver.center(element);
      await session.gesture([{ x, y }], Math.min(Math.max(Number(value) || LONG_PRESS_MS, 300), 10_000));
      break;
    }
    case 'fill':
      await session.click(element).catch(() => {});
      await session.clear(element).catch(() => {});
      if (value) await session.sendKeys(element, value);
      if (pace === 'recorded') await sleep(300);
      break;
    case 'clearText':
      await session.clear(element);
      break;
    case 'drawPolygon': {
      const points = Math.min(Math.max(Math.round(Number(value) || 4), 3), 12);
      const polygon = randomPolygon(await session.rect(element), points);
      for (const p of polygon) {
        await driver.tapAt(p.x, p.y);
        await sleep(250);
      }
      if (step.saveAs) resolve.set(step.saveAs, JSON.stringify(polygon.map((p) => [p.x, p.y])));
      return {
        usedSelector: selector,
        detail: `Tapped ${points} points: ${polygon.map((p) => `(${p.x},${p.y})`).join(' ')}`,
      };
    }
    case 'saveText': {
      if (!step.saveAs) throw new UiStepError('Give the variable a name.');
      const raw = await driver.textOf(element);
      const saved = extractSavedText(raw, step.value ?? '');
      if (saved === null)
        throw new UiStepError(`The text "${raw.slice(0, 80)}" does not match ${step.value}.`);
      if (!saved) throw new UiStepError('The element has no text to save.');
      resolve.set(step.saveAs, saved);
      return { usedSelector: selector, detail: `{{${step.saveAs}}} = "${saved}"` };
    }
    case 'assertVisible': {
      // Cari ulang di setiap percobaan: setelah scroll/fling, elemen yang pertama
      // ditemukan bisa sudah keluar layar sementara elemen yang cocok kini elemen lain.
      const ok = await pollUntil(async () => {
        const current = (await driver.poll(selectors, 0).catch(() => null))?.element ?? element;
        return session.displayed(current).catch(() => false);
      }, timeout);
      if (!ok) throw new UiStepError('The element exists but is not visible.');
      break;
    }
    case 'assertText': {
      let actual = '';
      const wanted = normalize(value);
      const ok = await pollUntil(async () => {
        actual = await driver.textOf(element);
        return normalize(actual).includes(wanted);
      }, timeout);
      if (!ok)
        throw new UiStepError(`Expected text "${value}", but the element shows "${actual.slice(0, 120)}".`);
      break;
    }
    case 'assertAttribute': {
      const name = (step.attribute ?? '').trim();
      if (!name) throw new UiStepError('Choose the attribute to check, e.g. checked or enabled.');
      let actual: string | null = null;
      const ok = await pollUntil(async () => {
        actual = await session.attribute(element, name);
        return normalize(String(actual ?? '')) === normalize(value);
      }, timeout);
      if (!ok)
        throw new UiStepError(
          `Expected ${name} = "${value}", but it is "${String(actual ?? '(none)').slice(0, 120)}".`,
        );
      return { usedSelector: selector, detail: `${name} = "${actual}"` };
    }
    default:
      throw new UiStepError(`"${step.type}" steps are not available in mobile tests.`);
  }
  return { usedSelector: selector };
}

/** Semua elemen yang cocok (mis. item daftar hasil filter) harus memuat teks. */
async function assertEach(
  driver: MobileDriver,
  selectors: string[],
  expected: string,
  timeout: number,
): Promise<UiStepOutcome> {
  if (!expected.trim()) throw new UiStepError('Enter the text every row must contain.');
  const wanted = normalize(expected);
  const deadline = Date.now() + timeout;
  let last = { selector: selectors[0] ?? '', rows: [] as string[] };
  for (;;) {
    last = { selector: selectors[0] ?? '', rows: [] };
    for (const selector of selectors) {
      const { using, value } = toLocator(selector);
      const elements = await driver.session.findElements(using, value).catch(() => [] as string[]);
      if (!elements.length) continue;
      const rows = await Promise.all(elements.slice(0, 100).map((e) => driver.textOf(e)));
      last = { selector, rows };
      if (rows.every((row) => normalize(row).includes(wanted)))
        return { usedSelector: selector, detail: `All ${rows.length} rows contain "${expected}"` };
      break;
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }
  if (!last.rows.length)
    throw new UiStepError(
      `No rows were shown (tried: ${selectors.slice(0, 3).join(' | ')}), so nothing could be checked.`,
    );
  const wrong = last.rows.filter((row) => !normalize(row).includes(wanted));
  throw new UiStepError(
    `${wrong.length} of ${last.rows.length} rows do not contain "${expected}", e.g. "${wrong[0].slice(0, 120)}".`,
  );
}

/** Pesan error Appium yang ringkas. */
export function explainMobileError(error: unknown): string {
  if (error instanceof UiStepError) return error.message;
  const message = (error as Error)?.message ?? String(error);
  if (error instanceof AppiumError && error.code === 'invalid session id')
    return 'The Appium session ended (the app crashed or the device disconnected).';
  return message.split('\n')[0];
}

/** "Save element text" unik (mobile): teks pertama yang belum disimpan run sebelumnya. */
async function saveUniqueMobileText(
  driver: MobileDriver,
  step: UiStep,
  selectors: string[],
  resolve: UiVariables,
  timeoutMs: number,
  used: string[],
): Promise<UiStepOutcome> {
  if (!step.saveAs) throw new UiStepError('Give the variable a name.');
  if (!selectors.length) throw new UiStepError('This step has no element selector.');
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  for (;;) {
    for (const selector of selectors) {
      const { using, value } = toLocator(selector);
      const elements = (await driver.session.findElements(using, value).catch(() => [])).slice(0, 200);
      const texts: string[] = [];
      for (const element of elements) {
        if (!(await driver.session.displayed(element).catch(() => true))) continue;
        const text = extractSavedText(await driver.textOf(element), step.value ?? '');
        if (text) texts.push(text);
      }
      seen = Math.max(seen, texts.length);
      const chosen = firstUnused(texts, used);
      if (chosen) {
        resolve.set(step.saveAs, chosen);
        const skipped = texts.indexOf(chosen);
        return {
          usedSelector: selector,
          detail: `{{${step.saveAs}}} = "${chosen}"${skipped ? ` (skipped ${skipped} already used)` : ''}`,
        };
      }
    }
    if (Date.now() >= deadline)
      throw new UiStepError(
        seen
          ? `All ${seen} matching values were already used (earlier runs or earlier attempts of this run).`
          : `Could not find the element on the screen within ${Math.round(timeoutMs / 1000)} s. Tried: ${selectors.slice(0, 3).join(' | ')}`,
      );
    await sleep(500);
  }
}
