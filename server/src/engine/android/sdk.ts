/**
 * Paket Android SDK lewat sdkmanager: membaca yang terpasang & tersedia, lalu
 * memilih versi yang cocok tanpa hardcode (platform stabil terbaru yang punya
 * system image untuk arsitektur Mac ini, build-tools dengan versi mayor yang sama).
 */
import os from 'node:os';
import { run, toolchain } from './toolchain';

export interface SdkPackage {
  path: string;
  version: string;
  description: string;
}

export interface SdkPackages {
  installed: SdkPackage[];
  available: SdkPackage[];
}

/** Arsitektur system image emulator untuk Mac ini. */
export const imageAbi = () => (os.arch() === 'arm64' ? 'arm64-v8a' : 'x86_64');

/**
 * Parse keluaran `sdkmanager --list` / `--list_installed`. Mendukung dua format:
 * - lama: kolom dipisah "|", path memakai ";" (platforms;android-36);
 * - baru (cmdline-tools 23+, "Android CLI"): kolom dipisah spasi, path memakai "/".
 * Path selalu dinormalkan ke format ";" yang diterima sdkmanager untuk memasang.
 */
export function parseSdkList(output: string): SdkPackages {
  const result: SdkPackages = { installed: [], available: [] };
  let section: keyof SdkPackages | null = null;
  // Progress bar sdkmanager memakai \r, jadi judul bagian bisa berada di "baris" yang sama.
  for (const raw of output.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (/^Installed packages:/i.test(line)) section = 'installed';
    else if (/^Available (Packages|Updates):/i.test(line))
      section = /Updates/i.test(line) ? null : 'available';
    else if (!section || !line || /^(-+|Path\b|\[)/i.test(line)) continue;
    else if (line.includes('|')) {
      const [pkgPath, version, description] = line.split('|').map((c) => c.trim());
      if (pkgPath && !pkgPath.startsWith('-'))
        result[section].push({ path: pkgPath, version, description: description ?? '' });
    } else {
      const m = /^(\S+)\s+(\S+)\s+(.*)$/.exec(line);
      if (m && /^[a-z][\w.-]*(\/|$)/.test(m[1]))
        result[section].push({ path: m[1].replace(/\//g, ';'), version: m[2], description: m[3].trim() });
    }
  }
  return result;
}

export async function listPackages(all = false): Promise<SdkPackages | { error: string }> {
  const tc = toolchain();
  if (!tc.sdkmanager) return { error: 'sdkmanager not found' };
  if (!tc.javaHome) return { error: 'Java (JDK) is required by sdkmanager' };
  const result = await run(
    tc.sdkmanager,
    [`--sdk_root=${tc.sdkTarget}`, all ? '--list' : '--list_installed'],
    { timeoutMs: 180_000, env: tc.env },
  );
  if (!result.ok) return { error: result.error ?? 'sdkmanager failed' };
  return parseSdkList(result.stdout);
}

const versionOf = (p: string) => /android-(\d+(?:\.\d+)?)/.exec(p)?.[1] ?? '';
const cmpVersion = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++)
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
/** Versi Android (nama pasar) dari API level. */
export function androidVersionOfApi(api: string): string {
  const map: Record<string, string> = {
    '24': '7.0',
    '25': '7.1',
    '26': '8.0',
    '27': '8.1',
    '28': '9',
    '29': '10',
    '30': '11',
    '31': '12',
    '32': '12L',
    '33': '13',
    '34': '14',
    '35': '15',
    '36': '16',
    '37': '17',
  };
  return map[api.split('.')[0]] ?? '';
}

export interface SdkChoice {
  platform: string;
  buildTools: string;
  systemImage: string;
  apiLevel: string;
}

/**
 * Pilih komponen yang dipasang. Platform yang sudah terpasang dipakai apa adanya.
 * Bila belum ada: API stabil (tanpa preview/beta/ext) satu versi mayor di bawah
 * yang terbaru — yang terbaru sering belum didukung penuh oleh UiAutomator2.
 */
export function chooseComponents(packages: SdkPackages): SdkChoice | null {
  const abi = imageAbi();
  const stable = (p: string) => !/(beta|preview|ext|canary|rc|-[a-z])/i.test(p.replace(/^[^;]+;/, ''));
  const imageFor = (api: string) => `system-images;android-${api};google_apis;${abi}`;
  const all = [...packages.installed, ...packages.available];
  const hasImage = (api: string) => all.some((p) => p.path === imageFor(api));
  const installedPlatform = packages.installed
    .filter((p) => /^platforms;android-\d+(\.\d+)?$/.test(p.path))
    .map((p) => versionOf(p.path))
    .filter(hasImage)
    .sort(cmpVersion)
    .pop();
  let api = installedPlatform;
  if (!api) {
    const apis = [
      ...new Set(
        all
          .filter((p) => /^platforms;android-\d+$/.test(p.path) && stable(p.path))
          .map((p) => versionOf(p.path)),
      ),
    ]
      .filter(hasImage)
      .sort(cmpVersion);
    const newestMajor = Number(apis.at(-1)?.split('.')[0] ?? 0);
    api = apis.filter((a) => Number(a.split('.')[0]) < newestMajor).pop() ?? apis.pop();
  }
  if (!api) return null;
  const major = api.split('.')[0];
  const buildTools =
    all
      .filter((p) => new RegExp(`^build-tools;${major}\\.\\d+\\.\\d+$`).test(p.path))
      .map((p) => p.path)
      .sort((a, b) => cmpVersion(a.split(';')[1], b.split(';')[1]))
      .pop() ??
    all
      .filter((p) => /^build-tools;\d+\.\d+\.\d+$/.test(p.path))
      .map((p) => p.path)
      .sort((a, b) => cmpVersion(a.split(';')[1], b.split(';')[1]))
      .pop() ??
    '';
  return { platform: `platforms;android-${api}`, buildTools, systemImage: imageFor(api), apiLevel: api };
}
