/**
 * Lokasi & environment perkakas Android (JDK, Android SDK, Appium) untuk
 * proses anak yang dijalankan Testora. Server sering dijalankan dari shell
 * yang PATH-nya tidak memuat SDK, jadi lokasinya dicari sendiri:
 * variabel environment → lokasi standar macOS → Homebrew → folder Testora.
 * Tidak ada perintah yang butuh sudo.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
/** Folder perkakas milik Testora (Appium dipasang di sini tanpa npm -g / sudo). */
export const TESTORA_TOOLS_DIR = process.env.FLOWQA_TOOLS_DIR ?? path.join(HOME, '.testora');
export const TESTORA_APPIUM_DIR = path.join(TESTORA_TOOLS_DIR, 'appium');
/** Lokasi SDK bawaan (sama dengan Android Studio). */
export const DEFAULT_SDK_ROOT = path.join(HOME, 'Library', 'Android', 'sdk');
const BREW_PREFIXES = ['/opt/homebrew', '/usr/local'];

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** JAVA_HOME: env → Homebrew openjdk (17/21/latest) → /usr/libexec/java_home dilakukan terpisah. */
export function findJavaHome(): string {
  const candidates = [
    process.env.JAVA_HOME ?? '',
    ...BREW_PREFIXES.flatMap((b) =>
      ['openjdk@17', 'openjdk@21', 'openjdk'].map((f) =>
        path.join(b, 'opt', f, 'libexec', 'openjdk.jdk', 'Contents', 'Home'),
      ),
    ),
  ];
  return candidates.find((c) => c && isFile(path.join(c, 'bin', 'java'))) ?? '';
}

/** Android SDK: ANDROID_HOME → ANDROID_SDK_ROOT → ~/Library/Android/sdk (hanya bila berisi komponen SDK). */
export function findSdkRoot(): {
  root: string;
  source: 'ANDROID_HOME' | 'ANDROID_SDK_ROOT' | 'default' | 'none';
} {
  const looksLikeSdk = (p: string) =>
    isDir(p) &&
    ['platform-tools', 'emulator', 'platforms', 'cmdline-tools', 'licenses'].some((d) =>
      isDir(path.join(p, d)),
    );
  if (process.env.ANDROID_HOME && looksLikeSdk(process.env.ANDROID_HOME))
    return { root: process.env.ANDROID_HOME, source: 'ANDROID_HOME' };
  if (process.env.ANDROID_SDK_ROOT && looksLikeSdk(process.env.ANDROID_SDK_ROOT))
    return { root: process.env.ANDROID_SDK_ROOT, source: 'ANDROID_SDK_ROOT' };
  if (looksLikeSdk(DEFAULT_SDK_ROOT)) return { root: DEFAULT_SDK_ROOT, source: 'default' };
  return { root: '', source: 'none' };
}

/** sdkmanager: di dalam SDK (cmdline-tools/latest) atau dari Homebrew cask android-commandlinetools. */
export function findSdkManager(sdkRoot: string): string {
  const candidates = [
    sdkRoot && path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'),
    ...BREW_PREFIXES.map((b) => path.join(b, 'bin', 'sdkmanager')),
  ].filter(Boolean) as string[];
  return candidates.find(isFile) ?? '';
}

export function findAvdManager(sdkRoot: string): string {
  const candidates = [
    sdkRoot && path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    ...BREW_PREFIXES.map((b) => path.join(b, 'bin', 'avdmanager')),
  ].filter(Boolean) as string[];
  return candidates.find(isFile) ?? '';
}

/** Appium: yang dipasang Testora dulu, lalu yang ada di PATH. */
export function findAppium(): string {
  const local = path.join(TESTORA_APPIUM_DIR, 'node_modules', '.bin', 'appium');
  if (isFile(local)) return local;
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const candidate = path.join(dir, 'appium');
    if (dir && isFile(candidate)) return candidate;
  }
  return '';
}

export interface Toolchain {
  javaHome: string;
  sdkRoot: string;
  sdkSource: ReturnType<typeof findSdkRoot>['source'];
  /** SDK yang dipakai/akan dipakai untuk pemasangan (terdeteksi atau bawaan). */
  sdkTarget: string;
  adb: string;
  emulator: string;
  sdkmanager: string;
  avdmanager: string;
  appium: string;
  env: NodeJS.ProcessEnv;
}

/** Hitung ulang setiap kali dipakai: perkakas bisa baru saja dipasang. */
export function toolchain(): Toolchain {
  const javaHome = findJavaHome();
  const { root: sdkRoot, source } = findSdkRoot();
  const sdkTarget = sdkRoot || DEFAULT_SDK_ROOT;
  const sdkmanager = findSdkManager(sdkTarget);
  const avdmanager = findAvdManager(sdkTarget);
  const appium = findAppium();
  const adb = path.join(sdkTarget, 'platform-tools', 'adb');
  const emulator = path.join(sdkTarget, 'emulator', 'emulator');
  const extraPath = [
    javaHome && path.join(javaHome, 'bin'),
    path.join(sdkTarget, 'platform-tools'),
    path.join(sdkTarget, 'emulator'),
    path.join(sdkTarget, 'cmdline-tools', 'latest', 'bin'),
    appium && path.dirname(appium),
    ...BREW_PREFIXES.map((b) => path.join(b, 'bin')),
  ].filter(Boolean);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: [...extraPath, process.env.PATH ?? ''].join(':'),
    ANDROID_HOME: sdkTarget,
    ANDROID_SDK_ROOT: sdkTarget,
    ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  };
  return {
    javaHome,
    sdkRoot,
    sdkSource: source,
    sdkTarget,
    adb: isFile(adb) ? adb : '',
    emulator: isFile(emulator) ? emulator : '',
    sdkmanager,
    avdmanager,
    appium,
    env,
  };
}

export interface CommandResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Pesan singkat bila gagal (tidak ditemukan / timeout / exit code). */
  error?: string;
}

/** Jalankan perintah (tanpa shell) dan kembalikan hasilnya; tidak pernah melempar. */
export function run(
  cmd: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (!cmd) return resolve({ ok: false, code: null, stdout: '', stderr: '', error: 'not found' });
    const child = execFile(
      cmd,
      args,
      {
        timeout: options.timeoutMs ?? 20_000,
        env: options.env ?? toolchain().env,
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
        resolve({
          ok: !error,
          code: typeof e?.code === 'number' ? e.code : error ? null : 0,
          stdout: String(stdout),
          stderr: String(stderr),
          ...(error
            ? {
                error:
                  e?.code === 'ENOENT'
                    ? 'not found'
                    : e?.killed
                      ? 'timed out'
                      : `exit code ${e?.code ?? '?'}: ${(String(stderr) || String(stdout)).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`,
              }
            : {}),
        });
      },
    );
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}

/**
 * Jalankan perintah panjang (pemasangan) sambil meneruskan setiap baris log.
 * `answer` diketik berulang ke stdin (mis. "y" untuk lisensi SDK yang sudah disetujui user).
 */
export function stream(
  cmd: string,
  args: string[],
  onLine: (line: string) => void,
  options: { env?: NodeJS.ProcessEnv; answer?: string; timeoutMs?: number; cwd?: string } = {},
): { child: ChildProcess; done: Promise<number | null> } {
  const child = spawn(cmd, args, { env: options.env ?? toolchain().env, cwd: options.cwd });
  let buffer = '';
  const feed = (chunk: Buffer) => {
    buffer += chunk.toString().replace(/\r/g, '\n');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach(onLine);
  };
  child.stdout?.on('data', feed);
  child.stderr?.on('data', feed);
  let answering: NodeJS.Timeout | undefined;
  if (options.answer) {
    answering = setInterval(() => child.stdin?.writable && child.stdin.write(`${options.answer}\n`), 500);
  } else child.stdin?.end();
  const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs) : undefined;
  const done = new Promise<number | null>((resolve) => {
    child.on('error', (error) => {
      onLine(`Could not start ${path.basename(cmd)}: ${error.message}`);
      resolve(null);
    });
    child.on('close', (code) => {
      if (buffer.trim()) onLine(buffer.trim());
      clearInterval(answering);
      clearTimeout(timer);
      resolve(code);
    });
  });
  return { child, done };
}

/** Samarkan nilai rahasia (password, token) di teks log. */
export function maskSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets.filter((s) => s && s.length >= 3).sort((a, b) => b.length - a.length))
    out = out.split(secret).join('****');
  // Kredensial di URL (user:pass@host) dan header Authorization.
  return out
    .replace(/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1****@')
    .replace(/(authorization["']?\s*[:=]\s*["']?\w+\s)[^\s"']+/gi, '$1****');
}
