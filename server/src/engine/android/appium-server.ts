/**
 * Server Appium lokal yang dijalankan & dikelola Testora (Start/Stop dari UI),
 * lengkap dengan log berputar untuk dilampirkan ke hasil test. Log disamarkan.
 */
import type { ChildProcess } from 'node:child_process';
import { maskSecrets, run, stream, toolchain } from './toolchain';

const MAX_LINES = 5_000;

export interface AppiumLogLine {
  at: number;
  line: string;
}

export class AppiumServerManager {
  private child: ChildProcess | null = null;
  private port = 4723;
  private readonly lines: AppiumLogLine[] = [];
  /** Nilai rahasia yang harus disamarkan di log (diisi runner, mis. password step). */
  private readonly secrets = new Set<string>();

  get managed() {
    return !!this.child && this.child.exitCode === null;
  }

  addSecrets(values: string[]) {
    values.filter(Boolean).forEach((v) => this.secrets.add(v));
  }

  private push(line: string) {
    this.lines.push({ at: Date.now(), line: maskSecrets(line, [...this.secrets]) });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
  }

  /** Log sejak waktu tertentu (ms epoch), untuk satu run. */
  logSince(since: number): string {
    return this.lines
      .filter((l) => l.at >= since)
      .map((l) => `${new Date(l.at).toISOString()} ${l.line}`)
      .join('\n');
  }

  recent(count = 300): string[] {
    return this.lines.slice(-count).map((l) => l.line);
  }

  /** Mulai `appium --address 127.0.0.1 --port <port>`; menunggu sampai /status menjawab. */
  async start(port = 4723): Promise<void> {
    if (this.managed) return;
    const tc = toolchain();
    if (!tc.appium) throw new Error('Appium is not installed. Run Setup Android Environment first.');
    this.port = port;
    this.push(`$ appium --address 127.0.0.1 --port ${port} --log-no-colors`);
    const { child, done } = stream(
      tc.appium,
      ['--address', '127.0.0.1', '--port', String(port), '--log-no-colors'],
      (line) => this.push(line),
      { env: tc.env },
    );
    this.child = child;
    void done.then((code) => {
      this.push(`Appium stopped (exit code ${code}).`);
      if (this.child === child) this.child = null;
    });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (!this.managed) throw new Error(`Appium exited right after starting. ${this.recent(5).join(' ')}`);
      const ok = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2_000) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Appium did not answer within 60 seconds.');
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1_000));
    if (child.exitCode === null) child.kill('SIGKILL');
    this.child = null;
  }

  url() {
    return `http://127.0.0.1:${this.port}`;
  }
}

/** Versi Appium & driver UiAutomator2 yang terpasang (perintah benar-benar dijalankan). */
export async function appiumInstallInfo(): Promise<{
  appium: string;
  version?: string;
  error?: string;
  uiautomator2?: string;
  driverError?: string;
}> {
  const tc = toolchain();
  if (!tc.appium) return { appium: '', error: 'not found' };
  const version = await run(tc.appium, ['--version'], { timeoutMs: 30_000, env: tc.env });
  if (!version.ok) return { appium: tc.appium, error: version.error };
  const drivers = await run(tc.appium, ['driver', 'list', '--installed', '--json'], {
    timeoutMs: 60_000,
    env: tc.env,
  });
  let uiautomator2: string | undefined;
  let driverError: string | undefined;
  try {
    const parsed = JSON.parse(drivers.stdout || '{}') as Record<
      string,
      { version?: string; installed?: boolean }
    >;
    const u2 = parsed.uiautomator2;
    if (u2 && u2.installed !== false) uiautomator2 = u2.version ?? 'installed';
  } catch {
    driverError = drivers.error ?? 'could not read `appium driver list` output';
  }
  return { appium: tc.appium, version: version.stdout.trim().split('\n').pop(), uiautomator2, driverError };
}
