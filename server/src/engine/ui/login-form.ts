/**
 * Login otomatis sebelum merekam: mencari form login di halaman (lewat
 * LOGIN_PROBE di skrip perekam) dan memastikan login berhasil.
 */
import type { Page } from 'playwright-core';
import type { RecordingLogin } from '@flowqa/shared';
import { LOGIN_PROBE } from './recorder-script';

export interface LoginTarget {
  selectors: string[];
  description: string;
}

export interface LoginForm {
  username: LoginTarget | null;
  password: LoginTarget;
  /** Kosong = tidak ada tombol; login dikirim dengan Enter di field password. */
  submit: LoginTarget | null;
}

const POLL_MS = 300;
const NAVIGATION_GRACE_MS = 3_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ProbeResult = { username: LoginTarget | null; password: LoginTarget | null; submit: LoginTarget | null };

/** Jalankan LOGIN_PROBE di halaman; null bila skrip perekam belum siap atau form belum ada. */
const probe = (page: Page): Promise<ProbeResult | null> =>
  page
    .evaluate((name) => {
      const fn = (globalThis as unknown as Record<string, (() => ProbeResult | null) | undefined>)[name];
      return fn ? fn() : null;
    }, LOGIN_PROBE)
    .catch(() => null);

const override = (selector: string | undefined, description: string): LoginTarget | undefined =>
  selector ? { selectors: [selector], description } : undefined;

/**
 * Tunggu sampai form login muncul (SPA bisa merender belakangan). Selector
 * yang diisi user menggantikan hasil deteksi otomatis.
 */
export async function findLoginForm(
  page: Page,
  login: RecordingLogin,
  timeoutMs: number,
): Promise<LoginForm | null> {
  const manual = {
    username: override(login.usernameSelector, 'Type into the username field'),
    password: override(login.passwordSelector, 'Type into the password field'),
    submit: override(login.submitSelector, 'Click the sign-in button'),
  };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await probe(page);
    const password = manual.password ?? found?.password;
    if (
      password &&
      (manual.password
        ? await page
            .locator(password.selectors[0])
            .count()
            .catch(() => 0)
        : true)
    )
      return {
        username: manual.username ?? found?.username ?? null,
        password,
        submit: manual.submit ?? found?.submit ?? null,
      };
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

/** Login dianggap berhasil bila alamat halaman berubah atau field password tidak terlihat lagi. */
export async function waitForSignedIn(
  page: Page,
  loginUrl: string,
  password: LoginTarget,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (page.url() !== loginUrl) {
      await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_GRACE_MS }).catch(() => {});
      return true;
    }
    const stillShown = await page
      .locator(password.selectors[0])
      .first()
      .isVisible()
      .catch(() => false);
    if (!stillShown) {
      // Form hilang biasanya disusul pindah halaman; tunggu sebentar agar URL akhir terbaca.
      await page.waitForURL((u) => u.href !== loginUrl, { timeout: NAVIGATION_GRACE_MS }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: NAVIGATION_GRACE_MS }).catch(() => {});
      return true;
    }
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
}
