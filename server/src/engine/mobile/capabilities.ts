/**
 * Capabilities Appium (W3C) untuk satu test mobile: bawaan per platform →
 * capabilities default di Settings → capabilities tambahan di test.
 * Key tanpa awalan otomatis diberi "appium:" (kecuali key standar W3C).
 */
import type { MobileAppConfig } from '@flowqa/shared';

const W3C_KEYS = new Set([
  'platformName',
  'browserName',
  'browserVersion',
  'acceptInsecureCerts',
  'pageLoadStrategy',
  'proxy',
  'timeouts',
  'unhandledPromptBehavior',
]);

export class CapabilityError extends Error {}

/** Parse JSON capabilities (boleh kosong). */
export function parseCapabilities(json: string, source: string): Record<string, unknown> {
  if (!json.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new CapabilityError(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new CapabilityError(`${source} must be a JSON object, e.g. {"appium:autoGrantPermissions": true}.`);
  return parsed as Record<string, unknown>;
}

const prefixed = (caps: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(caps).map(([key, value]) => [
      W3C_KEYS.has(key) || key.includes(':') ? key : `appium:${key}`,
      value,
    ]),
  );

/** Hapus nilai kosong supaya tidak menimpa bawaan Appium. */
const compact = (caps: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(caps).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export function buildCapabilities(
  config: MobileAppConfig,
  defaultsJson: string,
  resolve: (text: string) => string = (t) => t,
  /** Perangkat yang dipilih provider (serial adb) — menimpa `config.udid`. */
  device?: { udid: string; name: string; platformVersion?: string },
): Record<string, unknown> {
  const text = (value: string) => (value.includes('{{') ? resolve(value) : value).trim();
  const base = compact({
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': text(config.app),
    'appium:deviceName': device?.name || text(config.deviceName) || 'Android',
    'appium:platformVersion': device ? device.platformVersion : text(config.platformVersion),
    'appium:udid': device?.udid || text(config.udid),
    'appium:appPackage': text(config.appPackage),
    'appium:appActivity': text(config.appActivity),
    'appium:noReset': config.noReset,
    // Setiap test mulai dari layar awal aplikasi, walau data aplikasi tidak di-reset.
    'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true,
    'appium:autoGrantPermissions': true,
    'appium:newCommandTimeout': 300,
    // Pemasangan server UiAutomator2 di perangkat pertama kali bisa lama.
    'appium:uiautomator2ServerLaunchTimeout': 120_000,
    'appium:adbExecTimeout': 60_000,
  });
  const caps = {
    ...base,
    ...prefixed(parseCapabilities(defaultsJson, 'The default capabilities in Settings → Mobile (Android)')),
    ...prefixed(parseCapabilities(config.capabilities, "This test's extra capabilities")),
  };
  if (!caps['appium:app'] && !caps['appium:appPackage'])
    throw new CapabilityError('Set the APK (upload or path) or the package of an installed app.');
  return caps;
}

/** Package aplikasi untuk restart / deep link / versi aplikasi. */
export function appIdOf(config: MobileAppConfig, sessionCaps: Record<string, unknown>): string {
  return config.appPackage || String(sessionCaps.appPackage ?? sessionCaps['appium:appPackage'] ?? '');
}

/** Label perangkat untuk hasil run, mis. "Android 15 · Pixel 8". */
export function deviceLabel(config: MobileAppConfig, sessionCaps: Record<string, unknown>): string {
  const cap = (key: string) => String(sessionCaps[key] ?? sessionCaps[`appium:${key}`] ?? '');
  const version = cap('platformVersion') || config.platformVersion;
  const device = cap('deviceModel') || cap('deviceName') || config.deviceName;
  return [`Android${version ? ` ${version}` : ''}`, device].filter(Boolean).join(' · ');
}
