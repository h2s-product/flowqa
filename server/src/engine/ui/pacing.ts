/**
 * Pemutaran UI test dengan ritme seperti saat direkam (pace "recorded"):
 * jeda antar step mengikuti rekaman, teks diketik huruf demi huruf, dan elemen
 * yang akan disentuh diberi highlight sebentar. Pace "fast" melewati semuanya.
 */
import type { Locator } from 'playwright-core';
import type { UiRunPace, UiStep } from '@flowqa/shared';
import { DEFAULT_UI_STEP_DELAY_MS } from '@flowqa/shared';

/** Kecepatan mengetik bila lama mengetik tidak terekam. */
const DEFAULT_CHAR_MS = 70;
const MIN_CHAR_MS = 20;
const MAX_CHAR_MS = 200;
const HIGHLIGHT_MS = 350;
const HIGHLIGHT_COLOR = '#2f4fe0';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isPaced = (pace?: UiRunPace) => pace === 'recorded';

/** Pace bawaan: jendela terlihat = seperti direkam, headless = cepat. */
export const defaultPace = (headless: boolean): UiRunPace => (headless ? 'fast' : 'recorded');

/** Jeda sebelum step dijalankan (ms). Step tanpa aksi di halaman ("Set a value") tidak perlu jeda. */
export const stepDelay = (step: UiStep) =>
  step.type === 'setVariable' || step.type === 'apiScenario' ? 0 : (step.delayMs ?? DEFAULT_UI_STEP_DELAY_MS);

/** Jeda per huruf agar lama mengetik mendekati rekaman. */
export function charDelay(step: UiStep, value: string): number {
  if (!step.typingMs || value.length < 2) return DEFAULT_CHAR_MS;
  const perChar = step.typingMs / (value.length - 1);
  return Math.round(Math.min(Math.max(perChar, MIN_CHAR_MS), MAX_CHAR_MS));
}

/**
 * Tunggu sampai `anchor + delay` (ms epoch). Waktu yang sudah terpakai oleh
 * step sebelumnya (mis. memuat halaman) ikut dihitung, jadi ritmenya sama
 * dengan rekaman, tidak lebih lambat.
 */
export async function waitUntil(anchor: number, delay: number): Promise<void> {
  const remaining = anchor + delay - Date.now();
  if (remaining > 0) await sleep(remaining);
}

/** Beri outline sebentar pada elemen yang akan disentuh, lalu hapus lagi (tidak ikut screenshot). */
export async function highlight(locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
  const toggle = (on: boolean) =>
    locator
      .evaluate(
        (el, [on, color]) => {
          // Berjalan di browser; server tidak punya tipe DOM.
          const style = (el as { style?: Record<string, string> }).style;
          if (!style) return;
          style.outline = on ? `3px solid ${color}` : '';
          style.outlineOffset = on ? '2px' : '';
        },
        [on, HIGHLIGHT_COLOR] as const,
      )
      .catch(() => {});
  await toggle(true);
  await sleep(HIGHLIGHT_MS);
  await toggle(false);
}
