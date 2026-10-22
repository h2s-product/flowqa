/**
 * Perangkat Android lewat adb: emulator yang menyala, HP via USB/Wi-Fi, dan
 * AVD yang belum dinyalakan. Tidak ada upaya melewati keamanan Android: HP
 * yang belum menyetujui USB debugging hanya diberi instruksi.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AndroidDevice, AndroidDeviceStatus, FormFactor } from '@flowqa/shared';
import { formFactorOf } from '@flowqa/shared';
import { androidVersionOfApi } from './sdk';
import { run, stream, toolchain } from './toolchain';

const prop = async (serial: string, name: string) =>
  (await run(toolchain().adb, ['-s', serial, 'shell', 'getprop', name], { timeoutMs: 8_000 })).stdout.trim();

export const LOCKED_HELP =
  'The screen is locked. Unlock the phone and keep it unlocked while testing (tip: Developer options → Stay awake, and set Screen lock to None/Swipe on a test phone). Testora never unlocks a device for you.';

/** Ukuran & kepadatan layar dari `wm size` / `wm density` (nilai override diutamakan). */
export function parseWm(
  size: string,
  density: string,
): { width?: number; height?: number; density?: number } {
  const pick = (out: string, re: RegExp) => {
    const override = new RegExp(`Override ${re.source}`).exec(out);
    return (override ?? new RegExp(`Physical ${re.source}`).exec(out) ?? re.exec(out))?.slice(1).map(Number);
  };
  const [width, height] = pick(size, /size: (\d+)x(\d+)/) ?? [];
  const [dpi] = pick(density, /density: (\d+)/) ?? [];
  return { width, height, density: dpi };
}

/** HP / tablet perangkat yang menyala (di-cache per serial; ukuran layar jarang berubah). */
const formFactors = new Map<string, FormFactor | undefined>();
async function detectFormFactor(serial: string): Promise<FormFactor | undefined> {
  if (formFactors.has(serial)) return formFactors.get(serial);
  const tc = toolchain();
  const [characteristics, size, density] = await Promise.all([
    prop(serial, 'ro.build.characteristics').catch(() => ''),
    run(tc.adb, ['-s', serial, 'shell', 'wm', 'size'], { timeoutMs: 5_000, env: tc.env }).then(
      (r) => r.stdout,
    ),
    run(tc.adb, ['-s', serial, 'shell', 'wm', 'density'], { timeoutMs: 5_000, env: tc.env }).then(
      (r) => r.stdout,
    ),
  ]).catch(() => ['', '', ''] as const);
  const result = formFactorOf({ characteristics, ...parseWm(size, density) });
  if (result) formFactors.set(serial, result);
  return result;
}

/** HP / tablet AVD yang belum menyala, dari config.ini-nya. */
export function avdFormFactor(config: Record<string, string>): FormFactor | undefined {
  if (/tablet/i.test(config['hw.device.name'] ?? '')) return 'tablet';
  return formFactorOf({
    width: Number(config['hw.lcd.width']) || undefined,
    height: Number(config['hw.lcd.height']) || undefined,
    density: Number(config['hw.lcd.density']) || undefined,
  });
}

/** true = layar kunci (keyguard) sedang tampil. */
export async function isLocked(serial: string): Promise<boolean> {
  const out = await run(toolchain().adb, ['-s', serial, 'shell', 'dumpsys', 'window'], { timeoutMs: 8_000 });
  return /isKeyguardShowing=true|mShowingLockscreen=true|mDreamingLockscreen=true/.test(out.stdout);
}

export const UNAUTHORIZED_HELP =
  'Unlock your device and accept USB debugging authorization (tick “Always allow from this computer”). If no prompt appears, unplug and plug the cable in again, or revoke USB debugging authorizations in Developer options.';

/** Parse `adb devices -l`. */
export function parseAdbDevices(
  output: string,
): { serial: string; state: string; model: string; usb: boolean }[] {
  return output
    .split('\n')
    .slice(1)
    .map((line) =>
      /^(\S+)\s+(device|offline|unauthorized|authorizing|recovery|sideload|no permissions)\b(.*)$/.exec(
        line.trim(),
      ),
    )
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({
      serial: m[1],
      state: m[2],
      model: /model:(\S+)/.exec(m[3])?.[1]?.replace(/_/g, ' ') ?? '',
      usb: /usb:/.test(m[3]),
    }));
}

/** Isi config.ini sebuah AVD (key=value). */
export function avdConfig(avd: string): Record<string, string> {
  const file = path.join(os.homedir(), '.android', 'avd', `${avd}.avd`, 'config.ini');
  // .ini AVD bisa menunjuk folder lain lewat "path=".
  const ini = path.join(os.homedir(), '.android', 'avd', `${avd}.ini`);
  let target = file;
  if (!fs.existsSync(file) && fs.existsSync(ini)) {
    const p = /^path=(.+)$/m.exec(fs.readFileSync(ini, 'utf8'))?.[1]?.trim();
    if (p) target = path.join(p, 'config.ini');
  }
  if (!fs.existsSync(target)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(target, 'utf8')
      .split('\n')
      .map((l) => /^([^=#]+?)\s*=\s*(.*)$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1], m[2]]),
  );
}

/** Daftar AVD yang dibuat di Mac ini. */
export async function listAvds(): Promise<string[]> {
  const tc = toolchain();
  if (!tc.emulator) return [];
  const result = await run(tc.emulator, ['-list-avds'], { timeoutMs: 10_000, env: tc.env });
  return result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(INFO|WARNING|ERROR)/.test(l));
}

/**
 * Semua perangkat. `busy` = serial yang sedang dipakai test/Inspector (dari DeviceLockManager).
 */
export async function listDevices(busy: Set<string> = new Set()): Promise<AndroidDevice[]> {
  const tc = toolchain();
  const devices: AndroidDevice[] = [];
  const runningAvds = new Set<string>();
  if (tc.adb) {
    const listed = await run(tc.adb, ['devices', '-l'], { timeoutMs: 10_000, env: tc.env });
    for (const d of parseAdbDevices(listed.stdout)) {
      const emulator = d.serial.startsWith('emulator-');
      const base = {
        id: d.serial,
        type: emulator ? ('emulator' as const) : ('device' as const),
        connection: emulator ? ('Emulator' as const) : d.usb ? ('USB' as const) : ('Wi-Fi' as const),
      };
      if (d.state === 'unauthorized' || d.state === 'authorizing') {
        devices.push({
          ...base,
          name: d.model || 'Android device',
          androidVersion: '',
          apiLevel: '',
          status: 'UNAUTHORIZED',
          automationReady: false,
          detail: `ADB Unauthorized. ${UNAUTHORIZED_HELP}`,
        });
        continue;
      }
      if (d.state !== 'device') {
        devices.push({
          ...base,
          name: d.model || d.serial,
          androidVersion: '',
          apiLevel: '',
          status: d.state === 'offline' ? 'DISCONNECTED' : 'ERROR',
          automationReady: false,
          detail:
            d.state === 'offline'
              ? 'adb reports the device as offline. Reconnect it or restart the emulator.'
              : `adb state: ${d.state}`,
        });
        continue;
      }
      const [release, sdk, manufacturer, model, booted] = await Promise.all([
        prop(d.serial, 'ro.build.version.release'),
        prop(d.serial, 'ro.build.version.sdk'),
        prop(d.serial, 'ro.product.manufacturer'),
        prop(d.serial, 'ro.product.model'),
        prop(d.serial, 'sys.boot_completed'),
      ]);
      let avd = '';
      if (emulator) {
        const name = await run(tc.adb, ['-s', d.serial, 'emu', 'avd', 'name'], {
          timeoutMs: 5_000,
          env: tc.env,
        });
        avd = name.stdout.split('\n')[0]?.trim() ?? '';
        if (avd) runningAvds.add(avd);
      }
      const status: AndroidDeviceStatus =
        booted !== '1' ? 'BOOTING' : busy.has(d.serial) ? 'BUSY' : 'CONNECTED';
      // HP fisik yang terkunci terhubung, tetapi belum bisa dipakai otomasi.
      const locked = !emulator && status === 'CONNECTED' && (await isLocked(d.serial));
      const formFactor = booted === '1' ? await detectFormFactor(d.serial) : undefined;
      const brand =
        manufacturer && model && !model.toLowerCase().startsWith(manufacturer.toLowerCase())
          ? `${manufacturer} ${model}`
          : model;
      devices.push({
        ...base,
        name: avd || brand || d.model || d.serial,
        ...(avd ? { avd } : {}),
        ...(formFactor ? { formFactor } : {}),
        androidVersion: release ? `Android ${release}` : '',
        apiLevel: sdk,
        status,
        automationReady: status === 'CONNECTED' && !locked,
        detail: locked
          ? LOCKED_HELP
          : status === 'BOOTING'
            ? 'Android is still starting…'
            : status === 'BUSY'
              ? 'In use by a test or the Mobile Inspector.'
              : 'Ready',
      });
    }
  }
  for (const avd of await listAvds()) {
    if (runningAvds.has(avd)) continue;
    const config = avdConfig(avd);
    const api =
      /android-(\d+)/.exec(config['image.sysdir.1'] ?? '')?.[1] ?? /API_?(\d+)/i.exec(avd)?.[1] ?? '';
    const image = config['image.sysdir.1'];
    // AVD dari instalasi lama bisa menunjuk system image yang sudah tidak ada.
    if (image && !fs.existsSync(path.join(tc.sdkTarget, image))) {
      devices.push({
        id: `avd:${avd}`,
        name: avd,
        avd,
        type: 'emulator',
        androidVersion: api && androidVersionOfApi(api) ? `Android ${androidVersionOfApi(api)}` : '',
        apiLevel: api,
        connection: '-',
        status: 'ERROR',
        automationReady: false,
        detail: `Its system image (${image.replace(/\/$/, '').replace(/\//g, ';')}) is not installed. Create a new emulator, or install that image with sdkmanager.`,
      });
      continue;
    }
    const avdKind = avdFormFactor(config);
    devices.push({
      id: `avd:${avd}`,
      name: avd,
      avd,
      ...(avdKind ? { formFactor: avdKind } : {}),
      type: 'emulator',
      androidVersion: api && androidVersionOfApi(api) ? `Android ${androidVersionOfApi(api)}` : '',
      apiLevel: api,
      connection: '-',
      status: 'DISCONNECTED',
      automationReady: false,
      detail: 'Not running. Start it to use it for tests.',
    });
  }
  return devices;
}

/** Nyalakan AVD di latar belakang (jendela emulator terbuka). */
export function startEmulator(avd: string, onLine: (line: string) => void, headless = false): void {
  const tc = toolchain();
  if (!tc.emulator) throw new Error('The Android emulator is not installed.');
  // RAM dari config.ini dipakai apa adanya (tanpa -memory emulator bisa menaikkannya sendiri).
  const ram = avdConfig(avd)['hw.ramSize'];
  const args = [
    '-avd',
    avd,
    '-no-snapshot-save',
    '-no-boot-anim',
    ...(ram ? ['-memory', ram.replace(/\D/g, '')] : []),
    ...(headless ? ['-no-window', '-no-audio'] : []),
  ];
  const { child, done } = stream(tc.emulator, args, onLine, { env: tc.env });
  void done.then((code) => onLine(`Emulator ${avd} exited (code ${code}).`));
  child.unref();
}

/** Serial emulator masih terdaftar di `adb devices`? */
async function emulatorListed(serial: string): Promise<boolean> {
  const tc = toolchain();
  const out = await run(tc.adb, ['devices'], { timeoutMs: 10_000, env: tc.env });
  return out.stdout.split('\n').some((line) => line.split(/\s+/)[0] === serial);
}

/** PID proses emulator: yang mendengarkan port konsol (emulator-5554 → port 5554). */
async function emulatorPids(serial: string): Promise<number[]> {
  const port = /^emulator-(\d+)$/.exec(serial)?.[1];
  if (!port) return [];
  const out = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeoutMs: 10_000 });
  return [
    ...new Set(
      out.stdout
        .split(/\s+/)
        .map(Number)
        .filter((n) => n > 1),
    ),
  ];
}

/**
 * Matikan emulator. Normal: `adb emu kill`. `force`: bila emulator tidak merespons
 * (macet) dan masih terdaftar setelah beberapa detik, prosesnya di-kill paksa.
 * Mengembalikan cara emulator dimatikan.
 */
export async function stopEmulator(
  serial: string,
  options: { force?: boolean } = {},
): Promise<'stopped' | 'killed'> {
  const tc = toolchain();
  await run(tc.adb, ['-s', serial, 'emu', 'kill'], { timeoutMs: 10_000, env: tc.env });
  if (!options.force) return 'stopped';
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await emulatorListed(serial))) return 'stopped';
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const pids = await emulatorPids(serial);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Proses sudah berhenti sendiri.
    }
  }
  if (!pids.length && (await emulatorListed(serial)))
    throw new Error(`Could not stop ${serial}: the emulator process was not found.`);
  return 'killed';
}

/** Tunggu sampai emulator/perangkat selesai boot. */
export async function waitForBoot(serial: string, timeoutMs = 180_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await prop(serial, 'sys.boot_completed')) === '1') return true;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}

/** Versi aplikasi (versionName) yang terpasang di perangkat. */
export async function appVersion(serial: string, pkg: string): Promise<string> {
  if (!pkg) return '';
  const out = await run(toolchain().adb, ['-s', serial, 'shell', 'dumpsys', 'package', pkg], {
    timeoutMs: 10_000,
  });
  return /versionName=(\S+)/.exec(out.stdout)?.[1] ?? '';
}

/** Log Android terakhir (logcat) untuk hasil test yang gagal. */
export async function logcat(serial: string, lines = 800): Promise<string> {
  const out = await run(toolchain().adb, ['-s', serial, 'logcat', '-d', '-t', String(lines), '-v', 'time'], {
    timeoutMs: 15_000,
  });
  return out.ok ? out.stdout : `adb logcat failed: ${out.error}`;
}
