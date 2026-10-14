import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(serverDir, '..');

// Muat .env dari root repo bila ada (fitur bawaan Node >= 20.12).
try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
  /* .env opsional */
}

const port = Number(process.env.PORT ?? 4000);

export const config = {
  port,
  /** URL publik server, dipakai untuk base URL environment demo. */
  publicUrl: process.env.FLOWQA_PUBLIC_URL ?? `http://localhost:${port}`,
  /** URL tampilan web Testora untuk tautan di email (saat development: alamat Vite, mis. :5173). */
  appUrl: (process.env.FLOWQA_APP_URL ?? process.env.FLOWQA_PUBLIC_URL ?? `http://localhost:${port}`).replace(
    /\/$/,
    '',
  ),
  /** SMTP untuk email hasil test. Kosongkan host = email mati. */
  mail: {
    host: process.env.FLOWQA_SMTP_HOST ?? '',
    port: Number(process.env.FLOWQA_SMTP_PORT ?? 587),
    /** true = TLS langsung (biasanya port 465); false = STARTTLS (587). */
    security: process.env.FLOWQA_SMTP_SECURE === 'true' ? ('ssl' as const) : ('starttls' as const),
    user: process.env.FLOWQA_SMTP_USER ?? '',
    password: process.env.FLOWQA_SMTP_PASSWORD ?? '',
    from: process.env.FLOWQA_MAIL_FROM ?? process.env.FLOWQA_SMTP_USER ?? '',
  },
  dbFile: path.resolve(rootDir, process.env.FLOWQA_DB ?? 'data/flowqa.db'),
  webDistDir: path.join(rootDir, 'web', 'dist'),
  seedDemo: (process.env.FLOWQA_SEED ?? 'true') !== 'false',
  schedulerIntervalMs: Number(process.env.FLOWQA_SCHEDULER_INTERVAL_MS ?? 20_000),
  /** Lama sesi login (hari). */
  sessionDays: Number(process.env.FLOWQA_SESSION_DAYS ?? 7),
  /** Akun admin awal (opsional). Dibuat hanya bila belum ada user sama sekali. */
  admin: {
    email: process.env.FLOWQA_ADMIN_EMAIL ?? '',
    password: process.env.FLOWQA_ADMIN_PASSWORD ?? '',
    name: process.env.FLOWQA_ADMIN_NAME ?? 'Admin',
  },
  /** Buka browser perekam tanpa jendela (hanya untuk test otomatis/CI). */
  recorderHeadless: process.env.FLOWQA_RECORDER_HEADLESS === 'true',
  /** Folder screenshot hasil UI test. */
  uiArtifactsDir: path.resolve(rootDir, process.env.FLOWQA_UI_ARTIFACTS ?? 'data/ui-artifacts'),
  /**
   * Browser untuk UI Tester. Default memakai Google Chrome yang terpasang (channel "chrome").
   * Isi FLOWQA_BROWSER_PATH untuk memakai executable lain (mis. Chromium/Edge).
   */
  browser: {
    channel: process.env.FLOWQA_BROWSER_CHANNEL ?? 'chrome',
    executablePath: process.env.FLOWQA_BROWSER_PATH ?? '',
  },
  /** Batas retensi & konkurensi. Run lama dihapus otomatis. */
  limits: {
    storedRuns: 2_000,
    storedPerfRuns: 200,
    storedUiRuns: 500,
    concurrentUiRuns: 3,
    activeRecordings: 3,
  },
} as const;
