/**
 * Menjalankan satu UI step di halaman Playwright. Dipakai oleh runner dan oleh
 * recorder saat memutar ulang step lama sebelum merekam lanjutan.
 */
import type { Locator, Page } from 'playwright-core';
import type { UiPickOptions, UiRunPace, UiStep } from '@flowqa/shared';
import {
  COLOR_FAMILIES,
  colorFamily,
  extractSavedText,
  firstUnused,
  checkSortOrder,
  parseSortOrder,
  type ColorFamily,
  type UsedValues,
} from '@flowqa/shared';
import { sampleFile } from './sample-files';
import type { UiVariables } from './environment';
import { charDelay, highlight, isPaced } from './pacing';

export const DEFAULT_STEP_TIMEOUT_MS = 10_000;
const MAX_WAIT_MS = 60_000;
const POLL_MS = 250;

/** Hasil satu step: selector yang dipakai & keterangan (mis. pilihan yang diambil). */
export interface UiStepOutcome {
  usedSelector?: string;
  detail?: string;
  /** Berkas yang disimpan runner di folder artefak run (mis. page source). */
  artifact?: { name: string; content: string };
}

export class UiStepError extends Error {}

/**
 * Selector id buatan framework (React useId `#_r_0_` / `#\:r0\:` / `«r0»`, Radix, Headless UI,
 * MUI, React Aria) bisa menunjuk elemen lain setelah aplikasi di-deploy ulang, sehingga isian
 * masuk ke kolom yang salah. Selector seperti ini dicoba paling akhir.
 */
export const GENERATED_ID_SELECTOR =
  /^#(_r_[0-9a-z]+_|(\\:|:)[rR][0-9a-zA-Z]*(\\:|:)|«[rR][0-9a-zA-Z]*»|(radix|headlessui|mui|react-aria|chakra|mantine)[-_:])/i;

export const preferStable = (selectors: string[]) => [
  ...selectors.filter((s) => !GENERATED_ID_SELECTOR.test(s.trim())),
  ...selectors.filter((s) => GENERATED_ID_SELECTOR.test(s.trim())),
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const normalizeLabel = (text: string) => text.replace(/[*:]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Label kolom dari deskripsi step hasil rekaman, mis. Type into "Email *" field → "email". */
export function expectedLabelOf(step: Pick<UiStep, 'type' | 'description'>): string {
  if (!['fill', 'select', 'check', 'uncheck', 'press'].includes(step.type)) return '';
  const m = /"([^"]+)"/.exec(step.description);
  return m ? normalizeLabel(m[1]) : '';
}

/** Label elemen (label, aria-label, placeholder) untuk pemeriksaan kolom. */
const labelOf = new Function(
  'el',
  String.raw`
  const parts = [];
  if (el.labels) for (const l of el.labels) parts.push(l.textContent || '');
  parts.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '', el.getAttribute('name') || '');
  const by = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  for (const id of by) parts.push((document.getElementById(id) || {}).textContent || '');
  return parts.join(' | ');
`,
) as (el: unknown) => string;

/**
 * Kandidat locator untuk satu selector. `role=textbox[name="X"]` hasil rekaman lama
 * juga mencoba kolom berlabel X, karena kolom password tidak punya role "textbox".
 */
function locatorsFor(page: Page, selector: string): Locator[] {
  const list = [page.locator(selector)];
  const textbox = /^role=textbox\[name="((?:[^"\\]|\\.)*)"\]$/.exec(selector);
  if (textbox) {
    const name = textbox[1].replace(/\\"/g, '"').replace(/\s*\*\s*$/, '');
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    list.push(page.getByLabel(new RegExp(`^\\s*${escaped}\\s*\\*?\\s*$`, 'i')));
  }
  return list;
}

/**
 * Cari elemen dengan mencoba selector satu per satu (paling stabil dulu) sampai
 * batas waktu. Elemen yang terlihat diutamakan; elemen tersembunyi dipakai bila
 * hanya itu yang ada (mis. checkbox yang disembunyikan CSS). Selector id buatan
 * framework hanya dipakai bila label elemennya cocok dengan `expectedLabel`, supaya
 * isian tidak masuk ke kolom lain.
 */
async function findTarget(
  page: Page,
  selectors: string[],
  timeoutMs: number,
  expectedLabel = '',
): Promise<{ locator: Locator; selector: string }> {
  if (!selectors.length) throw new UiStepError('This step has no element selector.');
  const deadline = Date.now() + timeoutMs;
  let hidden: { locator: Locator; selector: string } | undefined;
  let mismatch = '';
  for (;;) {
    for (const selector of selectors) {
      for (const candidate of locatorsFor(page, selector)) {
        const locator = candidate.first();
        const count = await locator.count().catch(() => 0);
        if (!count) continue;
        if (expectedLabel && GENERATED_ID_SELECTOR.test(selector.trim())) {
          const actual = normalizeLabel(await locator.evaluate(labelOf).catch(() => ''));
          if (!actual.includes(expectedLabel)) {
            mismatch = `${selector} now points to a different field (${actual.split(' | ')[0] || 'unlabeled'})`;
            continue;
          }
        }
        if (await locator.isVisible().catch(() => false)) return { locator, selector };
        hidden ??= { locator, selector };
      }
    }
    if (Date.now() >= deadline) {
      if (hidden) return hidden;
      throw new UiStepError(
        `Could not find the element on the page within ${Math.round(timeoutMs / 1000)} s. Tried: ${selectors.slice(0, 3).join(' | ')}${mismatch ? `. Skipped: ${mismatch}` : ''}`,
      );
    }
    await sleep(POLL_MS);
  }
}

/**
 * "Save element text" unik: dari semua elemen yang cocok (mis. nama di tiap baris),
 * simpan teks pertama yang belum pernah disimpan run sebelumnya dari test ini.
 */
async function saveUniqueText(
  page: Page,
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
      const all = page.locator(selector);
      const count = Math.min(await all.count().catch(() => 0), 200);
      if (!count) continue;
      const texts: string[] = [];
      for (let i = 0; i < count; i++) {
        const raw = await all
          .nth(i)
          .innerText({ timeout: 2_000 })
          .catch(() => '');
        const text = extractSavedText(raw, step.value ?? '');
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
    if (Date.now() >= deadline) {
      throw new UiStepError(
        seen
          ? `All ${seen} matching values were already used (earlier runs or earlier attempts of this run).`
          : `Could not find the element on the page within ${Math.round(timeoutMs / 1000)} s. Tried: ${selectors.slice(0, 3).join(' | ')}`,
      );
    }
    await sleep(POLL_MS);
  }
}

/** Unggah berkas contoh ke <input type="file"> (boleh tersembunyi di balik tombol "Pilih Berkas"). */
async function uploadFile(
  page: Page,
  selectors: string[],
  name: string,
  timeoutMs: number,
): Promise<UiStepOutcome> {
  if (!selectors.length) throw new UiStepError('This step has no element selector.');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const selector of selectors) {
      const all = page.locator(selector);
      const count = await all.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        // Selector bisa menunjuk label/tombol: pakai input file di dalamnya bila ada.
        let input = all.nth(i);
        const isFile = await input.evaluate(isFileInput).catch(() => false);
        if (!isFile) {
          const inner = input.locator('input[type=file]').first();
          if (!(await inner.count().catch(() => 0))) continue;
          input = inner;
        }
        const accept = (await input.getAttribute('accept').catch(() => null)) ?? '';
        const file = sampleFile(name, accept);
        await input.setInputFiles(file.path);
        await settle(page);
        return { usedSelector: selector, detail: `Uploaded ${file.name}` };
      }
    }
    if (Date.now() >= deadline)
      throw new UiStepError(
        `No file field found within ${Math.round(timeoutMs / 1000)} s. Point the step at the <input type="file"> (or its label). Tried: ${selectors.slice(0, 3).join(' | ')}`,
      );
    await sleep(POLL_MS);
  }
}

interface ElementColors {
  text: string[];
  background: string[];
}

/** Elemen adalah <input type="file">? (dijalankan di browser) */
const isFileInput = new Function('el', `return el.tagName === 'INPUT' && el.type === 'file';`) as (
  el: unknown,
) => boolean;

/** Warna teks elemen (dan anak-anaknya) & warna latar elemen beserta 2 induknya (dijalankan di browser). */
const colorsOf = new Function(
  'el',
  String.raw`
  const text = new Set();
  const background = new Set();
  const nodes = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 20)];
  for (const n of nodes) if ((n.textContent || '').trim()) text.add(getComputedStyle(n).color);
  let node = el;
  for (let i = 0; node && i < 3; i++, node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) background.add(bg);
  }
  return { text: [...text], background: [...background] };
`,
) as (el: unknown) => ElementColors;

function describeColors(list: string[]): string {
  if (!list.length) return 'none';
  return [...new Set(list.map((c) => `${colorFamily(c) ?? 'transparent'} (${c})`))].slice(0, 3).join(', ');
}

async function pollUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}

/* ----------------------- menunggu halaman tenang ----------------------- */

/** Request yang masih berjalan per halaman (fetch/XHR/dokumen/skrip). */
const network = new WeakMap<Page, { inflight: Map<object, number>; lastActivity: number }>();
/** Koneksi panjang (stream/long-poll) tidak ditunggu. */
const IGNORED_TYPES = new Set(['eventsource', 'websocket', 'media']);
const LONG_REQUEST_MS = 5_000;
const QUIET_MS = 300;
const MAX_QUIET_WAIT_MS = 3_000;

function trackNetwork(page: Page) {
  let state = network.get(page);
  if (state) return state;
  state = { inflight: new Map(), lastActivity: Date.now() };
  network.set(page, state);
  const s = state;
  page.on('request', (req) => {
    if (IGNORED_TYPES.has(req.resourceType())) return;
    s.inflight.set(req, Date.now());
    s.lastActivity = Date.now();
  });
  const done = (req: object) => {
    if (s.inflight.delete(req)) s.lastActivity = Date.now();
  };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return s;
}

/**
 * Tunggu sampai aplikasi selesai memuat data setelah sebuah aksi: tidak ada
 * request aktif (kecuali yang sudah >5 dtk, mis. long-poll) selama 300 ms.
 * Maksimal 3 dtk. Mencegah aksi berikutnya terjadi saat halaman masih
 * me-render ulang (mis. dialog yang dibuka lagi lalu tertutup oleh re-render).
 */
async function networkQuiet(page: Page): Promise<void> {
  const state = trackNetwork(page);
  const deadline = Date.now() + MAX_QUIET_WAIT_MS;
  // Beri kesempatan request yang dipicu aksi untuk mulai.
  await sleep(100);
  while (Date.now() < deadline) {
    const now = Date.now();
    const active = [...state.inflight.values()].some((started) => now - started < LONG_REQUEST_MS);
    if (!active && now - state.lastActivity >= QUIET_MS) return;
    await sleep(50);
  }
}

const settle = async (page: Page) => {
  await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
  await networkQuiet(page);
};

/** Tunggu sampai tidak ada request aktif (maks. 3 dtk). */
export const waitForQuiet = (page: Page) => networkQuiet(page);

/** Pasang pelacak request sejak awal run (dipanggil runner/recorder setelah membuat halaman). */
export const watchNetwork = (page: Page) => void trackNetwork(page);

/**
 * Jalankan satu step. Mengembalikan selector yang dipakai (bila ada).
 * `pace: 'recorded'` menampilkan aksi seperti manusia (highlight + mengetik
 * huruf demi huruf); jeda antar step diatur oleh pemanggil.
 */
export async function executeUiStep(
  page: Page,
  step: UiStep,
  resolve: UiVariables,
  pace: UiRunPace = 'fast',
  /** Nilai {{variabel}} dari run sebelumnya (untuk "Save element text" unik). */
  usedValues?: UsedValues,
): Promise<UiStepOutcome> {
  const paced = isPaced(pace);
  // Selector boleh memakai {{variabel}}, mis. text="{{user_name}}" untuk data yang dibuat di run ini.
  const selectors = preferStable(step.selectors.map((s) => (s.includes('{{') ? resolve(s) : s)));
  const timeout = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  const value = resolve(step.value ?? '');

  switch (step.type) {
    case 'navigate':
      if (!/^https?:\/\//i.test(value)) throw new UiStepError(`"${value}" is not a full http(s) URL.`);
      await page.goto(value, { waitUntil: 'domcontentloaded', timeout: Math.max(timeout, 30_000) });
      return {};
    case 'wait':
      await sleep(Math.min(Math.max(Number(value) || 0, 0), MAX_WAIT_MS));
      return {};
    case 'assertUrl': {
      const ok = await pollUntil(async () => page.url().includes(value), timeout);
      if (!ok) throw new UiStepError(`Expected the page URL to contain "${value}", but it was ${page.url()}`);
      return {};
    }
    case 'setVariable': {
      if (!step.saveAs) throw new UiStepError('Give the value a variable name.');
      resolve.set(step.saveAs, value);
      return { detail: `{{${step.saveAs}}} = "${value}"` };
    }
    case 'pickOption':
      return pickOption(page, { ...step, selectors }, resolve, timeout, paced);
    case 'assertEach':
      return assertEach(page, selectors, value, timeout);
    case 'assertNotVisible':
      return assertNotVisible(selectors, timeout, (selector) =>
        page
          .locator(selector)
          .evaluateAll((els) =>
            (els as unknown as { innerText: string; getClientRects(): { length: number } }[])
              .filter((el) => el.getClientRects().length > 0)
              .map((el) => el.innerText ?? ''),
          )
          .catch(() => [] as string[]),
      );
    case 'assertSorted':
      return assertSorted(selectors, value, timeout, (selector) =>
        page
          .locator(selector)
          .evaluateAll((els) =>
            (els as unknown as { innerText: string; getClientRects(): { length: number } }[])
              .filter((el) => el.getClientRects().length > 0)
              .map((el) => el.innerText),
          )
          .catch(() => [] as string[]),
      );
    case 'uploadFile':
      return uploadFile(page, selectors, value, timeout);
    case 'saveText': {
      const used = step.saveAs ? (usedValues?.(step.saveAs, !!step.unique) ?? []) : [];
      if (step.unique || used.length) return saveUniqueText(page, step, selectors, resolve, timeout, used);
      break;
    }
    case 'apiScenario':
      // Dijalankan oleh UiRunService (butuh RunService); tidak bisa dijalankan di sini.
      throw new UiStepError('API scenario steps run only as part of a UI test run.');
  }

  const { locator, selector } = await findTarget(page, selectors, timeout, expectedLabelOf(step));
  if (paced) await highlight(locator);
  switch (step.type) {
    case 'click':
      await locator.click({ timeout });
      await settle(page);
      break;
    case 'fill':
      if (paced && value) {
        await locator.fill('', { timeout });
        await locator.pressSequentially(value, { delay: charDelay(step, value), timeout: timeout + 30_000 });
      } else {
        await locator.fill(value, { timeout });
      }
      break;
    case 'select':
      await locator.selectOption(value, { timeout });
      await settle(page);
      break;
    case 'check':
      await locator.check({ timeout }).catch(() => locator.check({ timeout, force: true }));
      await settle(page);
      break;
    case 'uncheck':
      await locator.uncheck({ timeout }).catch(() => locator.uncheck({ timeout, force: true }));
      await settle(page);
      break;
    case 'press':
      await locator.press(value || 'Enter', { timeout });
      await settle(page);
      break;
    case 'saveText': {
      if (!step.saveAs) throw new UiStepError('Give the variable a name.');
      await locator.waitFor({ state: 'visible', timeout }).catch(() => {});
      const raw =
        (await locator.innerText({ timeout }).catch(() => '')) ||
        (await locator.inputValue({ timeout: 1_000 }).catch(() => ''));
      const saved = extractSavedText(raw, step.value ?? '');
      if (saved === null)
        throw new UiStepError(`The text "${raw.slice(0, 80)}" does not match ${step.value}.`);
      if (!saved) throw new UiStepError('The element has no text to save.');
      resolve.set(step.saveAs, saved);
      return { usedSelector: selector, detail: `{{${step.saveAs}}} = "${saved}"` };
    }
    case 'assertVisible':
      await locator.waitFor({ state: 'visible', timeout }).catch(() => {
        throw new UiStepError('The element exists but is not visible.');
      });
      break;
    case 'assertColor': {
      const wanted = value.trim().toLowerCase() as ColorFamily;
      if (!COLOR_FAMILIES.includes(wanted))
        throw new UiStepError(`Choose a color: ${COLOR_FAMILIES.join(', ')}.`);
      let seen: ElementColors = { text: [], background: [] };
      const ok = await pollUntil(async () => {
        seen = await locator.evaluate(colorsOf);
        return [...seen.text, ...seen.background].some((c) => colorFamily(c) === wanted);
      }, timeout);
      if (!ok)
        throw new UiStepError(
          `Expected ${wanted}, but the text is ${describeColors(seen.text)} and the background is ${describeColors(seen.background)}.`,
        );
      return { usedSelector: selector, detail: `Color is ${wanted}` };
    }
    case 'assertText': {
      let actual = '';
      const ok = await pollUntil(async () => {
        actual = (
          (await locator.innerText({ timeout: 1_000 })) || (await locator.inputValue().catch(() => ''))
        ).trim();
        return actual.replace(/\s+/g, ' ').includes(value.replace(/\s+/g, ' ').trim());
      }, timeout);
      if (!ok)
        throw new UiStepError(`Expected text "${value}", but the element shows "${actual.slice(0, 120)}".`);
      break;
    }
  }
  return { usedSelector: selector };
}

/* --------------------------- assertNotVisible --------------------------- */

/**
 * Tidak ada elemen terlihat yang cocok dengan selector mana pun. Ditunggu sampai
 * terpenuhi (mis. sheet yang sedang menutup, daftar yang sedang difilter ulang).
 * Dipakai juga oleh UI test mobile (lewat `visibleTexts`).
 */
export async function assertNotVisible(
  selectors: string[],
  timeout: number,
  visibleTexts: (selector: string) => Promise<string[]>,
): Promise<UiStepOutcome> {
  if (!selectors.length) throw new UiStepError('This step has no element selector.');
  const deadline = Date.now() + timeout;
  let shown: { selector: string; texts: string[] } | null = null;
  for (;;) {
    shown = null;
    for (const selector of selectors) {
      const texts = await visibleTexts(selector);
      if (texts.length) {
        shown = { selector, texts };
        break;
      }
    }
    if (!shown) return { detail: 'Not shown' };
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }
  const sample = shown.texts
    .find((t) => t.trim())
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  throw new UiStepError(
    `${shown.texts.length} matching element${shown.texts.length > 1 ? 's are' : ' is'} still shown (${shown.selector}${sample ? `, e.g. "${sample}"` : ''}).`,
  );
}

/* ----------------------------- assertSorted ----------------------------- */

/**
 * Nilai (tanggal / angka) pada semua elemen terlihat yang cocok harus berurutan.
 * Ditunggu sampai terpenuhi karena daftar biasanya dimuat ulang setelah urutan diganti.
 * Dipakai juga oleh UI test web (lewat `rowsOf`).
 */
export async function assertSorted(
  selectors: string[],
  value: string,
  timeout: number,
  rowsOf: (selector: string) => Promise<string[]>,
): Promise<UiStepOutcome> {
  const order = parseSortOrder(value);
  if (!order) throw new UiStepError('Enter the order: ascending or descending.');
  const deadline = Date.now() + timeout;
  let last: { selector: string; result: ReturnType<typeof checkSortOrder> } | null = null;
  for (;;) {
    last = null;
    for (const selector of selectors) {
      const result = checkSortOrder(await rowsOf(selector), order);
      if (!result.values.length) continue;
      last = { selector, result };
      if (result.ok)
        return {
          usedSelector: selector,
          detail: `${result.values.length} ${result.kind === 'date' ? 'dates' : 'values'} are ${order}: ${result.values.slice(0, 8).join(' → ')}`,
        };
      break;
    }
    if (Date.now() >= deadline) break;
    await sleep(POLL_MS);
  }
  if (!last)
    throw new UiStepError(
      `No dates or numbers were shown (tried: ${selectors.slice(0, 3).join(' | ')}), so the order could not be checked.`,
    );
  const { values, brokenAt } = last.result;
  throw new UiStepError(
    `Not ${order}: "${values[brokenAt]}" comes after "${values[brokenAt - 1]}" (shown: ${values.slice(0, 8).join(' → ')}).`,
  );
}

/* ------------------------------ assertEach ------------------------------ */

const normalizeText = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Semua elemen terlihat yang cocok dengan selector (mis. baris tabel hasil filter)
 * harus memuat `expected`. Ditunggu sampai terpenuhi, karena data hasil filter
 * biasanya dimuat ulang sesaat setelah filter diterapkan. Daftar kosong = gagal.
 */
async function assertEach(
  page: Page,
  selectors: string[],
  expected: string,
  timeout: number,
): Promise<UiStepOutcome> {
  if (!expected.trim()) throw new UiStepError('Enter the text every row must contain.');
  const wanted = normalizeText(expected);
  const deadline = Date.now() + timeout;
  let last = { selector: selectors[0] ?? '', rows: [] as string[] };
  for (;;) {
    // Hasil terakhir selalu mencerminkan kondisi terbaru (termasuk tabel yang menjadi kosong).
    last = { selector: selectors[0] ?? '', rows: [] };
    for (const selector of selectors) {
      const rows = await page
        .locator(selector)
        .evaluateAll((els) =>
          (els as unknown as { innerText: string; getClientRects(): { length: number } }[])
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => el.innerText),
        )
        .catch(() => [] as string[]);
      if (!rows.length) continue;
      last = { selector, rows };
      if (rows.every((row) => normalizeText(row).includes(wanted)))
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
  const wrong = last.rows.filter((row) => !normalizeText(row).includes(wanted));
  throw new UiStepError(
    `${wrong.length} of ${last.rows.length} rows do not contain "${expected}", e.g. "${wrong[0].replace(/\s+/g, ' ').trim().slice(0, 120)}".`,
  );
}

/* ------------------------------ pickOption ------------------------------ */

/** Teks pilihan boleh memakai {{variabel}}. */
const resolveText = (variables: UiVariables, value: string) =>
  value.includes('{{') ? variables(value) : value;

const DROPDOWN_SETTLE_MS = 200;
const DROPDOWN_ACCEPT_MS = 2_000;

/**
 * Pilihan dropdown dianggap diterima bila daftarnya tertutup, opsinya kini
 * terpilih (multi-select yang tetap terbuka), atau tombolnya menampilkan pilihan itu.
 */
function dropdownAccepted(trigger: Locator, option: Locator, text: string): Promise<boolean> {
  return pollUntil(async () => {
    if (!(await option.isVisible().catch(() => false))) return true;
    if ((await option.getAttribute('aria-selected').catch(() => null)) === 'true') return true;
    return (await trigger.innerText().catch(() => '')).includes(text);
  }, DROPDOWN_ACCEPT_MS);
}

/** Pilihan di dalam dropdown kustom yang sudah dibuka. */
const DROPDOWN_OPTIONS = '[role=option], [role=menuitem], [role=menuitemradio]';

interface OptionInfo {
  index: number;
  text: string;
  visible: boolean;
  taken: boolean;
  /** <option> bawaan milik <select>. */
  native: boolean;
}

/**
 * Dijalankan di browser. Dibuat dengan `new Function` dari JavaScript biasa
 * (seperti skrip perekam) agar tidak tercampur helper hasil transpile: teks, visibilitas, dan apakah
 * pilihan sudah terpakai (terpilih / tercentang / nonaktif / cocok dengan `skip`).
 * Mengembalikan string berisi pesan error bila selector `skip` tidak valid.
 */
const describeOptions = new Function(
  'elements',
  'skip',
  String.raw`
  const truthy = (el, name) => el.getAttribute(name) === 'true';
  try {
    return elements.map((el, index) => {
      const state = el.getAttribute('data-state') || '';
      const taken =
        el.disabled === true ||
        truthy(el, 'aria-disabled') ||
        truthy(el, 'aria-selected') ||
        truthy(el, 'aria-checked') ||
        truthy(el, 'aria-pressed') ||
        /^(checked|on|active|selected)$/.test(state) ||
        (el.hasAttribute('data-selected') && el.getAttribute('data-selected') !== 'false') ||
        (el.tagName === 'OPTION' && (el.selected || el.value === '')) ||
        !!el.querySelector('input:checked') ||
        (!!skip && el.matches(skip));
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const native = el.tagName === 'OPTION';
      return { index, text, visible: native || el.getClientRects().length > 0, taken, native };
    });
  } catch (error) {
    return 'The "skip" selector is not valid CSS: ' + error.message;
  }
`,
) as (elements: unknown[], skip: string) => OptionInfo[] | string;

/**
 * Pilih satu pilihan yang belum terpakai dari semua elemen yang cocok dengan
 * selector step. Untuk <select> bawaan, yang dipilih adalah <option>-nya.
 */
async function pickOption(
  page: Page,
  step: UiStep,
  variables: UiVariables,
  timeout: number,
  paced: boolean,
): Promise<UiStepOutcome> {
  const pick: UiPickOptions = step.pick ?? { mode: 'random', text: '', saveAs: '', skip: '' };
  const { locator: first, selector } = await findTarget(page, step.selectors, timeout);
  const target = await first
    .evaluate((el) => {
      const e = el as unknown as { tagName: string; getAttribute(n: string): string | null };
      return {
        tag: e.tagName,
        role: e.getAttribute('role') ?? '',
        popup: e.getAttribute('aria-haspopup') ?? '',
        expanded: e.getAttribute('aria-expanded'),
      };
    })
    .catch(() => ({ tag: '', role: '', popup: '', expanded: null }));
  const isSelect = target.tag === 'SELECT';
  // Dropdown kustom (mis. Radix/Headless UI): selector menunjuk tombol pembukanya.
  const isDropdown =
    !isSelect && (target.role === 'combobox' || ['listbox', 'menu', 'true'].includes(target.popup));
  if (isDropdown && target.expanded !== 'true') {
    if (paced) await highlight(first);
    await first.click({ timeout });
    // Beberapa dropdown mengabaikan pilihan yang datang sesaat setelah dibuka.
    await sleep(DROPDOWN_SETTLE_MS);
  }
  const options = isSelect
    ? first.locator('option')
    : isDropdown
      ? page.locator(DROPDOWN_OPTIONS)
      : page.locator(selector);

  const visibleOptions = async () => {
    const described = await options.evaluateAll(describeOptions, pick.skip);
    if (typeof described === 'string') throw new UiStepError(described);
    // role=option juga cocok dengan <option> milik <select> lain di halaman; itu tidak bisa diklik.
    return described.filter((o) => o.visible && (isSelect ? !!o.text : !o.native));
  };
  let shown = await visibleOptions();
  // Daftar pilihan dropdown bisa muncul sesaat setelah dibuka.
  if (
    isDropdown &&
    !shown.length &&
    (await pollUntil(async () => (await visibleOptions()).length > 0, timeout))
  )
    shown = await visibleOptions();
  const free = shown.filter((o) => !o.taken);
  const wanted = pick.mode === 'named' ? resolveText(variables, pick.text) : '';
  const named = wanted ? shown.find((o) => o.text.toLowerCase() === wanted.toLowerCase()) : undefined;
  if (pick.mode === 'named' && !named)
    throw new UiStepError(
      shown.length
        ? `No option named "${wanted}". Options shown: ${shown
            .map((o) => o.text)
            .slice(0, 12)
            .join(', ')}.`
        : isDropdown
          ? 'The dropdown opened, but no options appeared.'
          : 'No visible options were found for this selector.',
    );
  if (!named && !free.length)
    throw new UiStepError(
      shown.length
        ? `All ${shown.length} options are already selected or disabled — there is nothing new to pick.`
        : isDropdown
          ? 'The dropdown opened, but no options appeared.'
          : 'No visible options were found for this selector.',
    );

  const chosen = named ?? (pick.mode === 'first' ? free[0] : free[Math.floor(Math.random() * free.length)]);
  if (isSelect) {
    if (paced) await highlight(first);
    await first.selectOption({ index: chosen.index }, { timeout });
  } else {
    const option = options.nth(chosen.index);
    if (paced) await highlight(option);
    await option.click({ timeout });
    if (isDropdown && !(await dropdownAccepted(first, option, chosen.text))) {
      // Coba sekali lagi sebelum menyatakan gagal.
      await option.click({ timeout }).catch(() => {});
      if (!(await dropdownAccepted(first, option, chosen.text)))
        throw new UiStepError(
          `"${chosen.text}" was clicked, but the dropdown did not accept it (it is still open).`,
        );
    }
    await settle(page);
  }
  if (pick.saveAs) variables.set(pick.saveAs, chosen.text);

  const used = named ? 0 : shown.length - free.length;
  return {
    usedSelector: isDropdown ? `${selector} → option` : selector,
    detail:
      `Picked "${chosen.text}"` +
      (used ? ` (skipped ${used} already selected)` : '') +
      (pick.saveAs ? ` · saved as {{${pick.saveAs}}}` : ''),
  };
}

/** Pesan error Playwright yang ringkas & mudah dibaca. */
export function explainUiError(error: unknown): string {
  if (error instanceof UiStepError) return error.message;
  const message = (error as Error)?.message ?? String(error);
  const first = message.split('\n')[0].replace(/^(locator|page)\.\w+:\s*/, '');
  if (/Timeout \d+ms exceeded/.test(first)) return `The page did not respond in time: ${first}`;
  if (/net::ERR_/.test(first)) return `Could not open the page: ${first}`;
  return first;
}
