/**
 * Pengaturan server Appium untuk UI test Android (Settings → Mobile (Android)):
 * URL server, capabilities default, dan mode eksekusi bawaan. Kredensial di URL
 * (user:key@host) tidak pernah dikirim balik ke browser.
 */
import type { AppiumSettings, AppiumStatus } from '@flowqa/shared';
import { MOBILE_EXECUTION_MODES, SECRET_MASK } from '@flowqa/shared';
import { AppiumClient, AppiumError } from '../engine/mobile/appium-client';
import { parseCapabilities } from '../engine/mobile/capabilities';
import { HttpError } from '../lib/http';
import type { SettingsRepository } from '../repositories/settings-repository';

const KEY = 'appium';
export const DEFAULT_APPIUM_URL = 'http://127.0.0.1:4723';

export interface AppiumSettingsView extends AppiumSettings {
  source: 'app' | 'default';
}

/** Ganti password di URL dengan samaran. */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.password) return url;
    parsed.password = '';
    // Samaran ditulis apa adanya (URL akan meng-encode karakter "•").
    return parsed.toString().replace(/\/$/, '').replace('@', `:${SECRET_MASK}@`);
  } catch {
    return url;
  }
}

export class AppiumSettingsService {
  constructor(
    private readonly settings: SettingsRepository,
    private readonly envUrl = process.env.FLOWQA_APPIUM_URL ?? '',
  ) {}

  /** Pengaturan lengkap (dengan kredensial) untuk dipakai server. */
  current(): AppiumSettings {
    const saved = this.settings.get<AppiumSettings>(KEY);
    return {
      serverUrl: saved?.serverUrl || this.envUrl || DEFAULT_APPIUM_URL,
      capabilities: saved?.capabilities ?? '',
      defaultMode: saved?.defaultMode ?? 'emulator',
    };
  }

  view(): AppiumSettingsView {
    const current = this.current();
    return {
      ...current,
      serverUrl: maskUrl(current.serverUrl),
      source: this.settings.get(KEY) ? 'app' : 'default',
    };
  }

  save(input: Partial<AppiumSettings>): AppiumSettingsView {
    this.settings.set(KEY, this.normalize(input));
    return this.view();
  }

  reset(): AppiumSettingsView {
    this.settings.delete(KEY);
    return this.view();
  }

  client(settings = this.current()): AppiumClient {
    return new AppiumClient(settings.serverUrl);
  }

  /** Cek server Appium dengan isian form (boleh belum disimpan). */
  async test(input?: Partial<AppiumSettings>): Promise<AppiumStatus> {
    const settings = input ? this.normalize(input) : this.current();
    try {
      const status = await this.client(settings).status();
      const version = status.build?.version;
      return {
        ok: status.ready !== false,
        version,
        message:
          status.ready === false
            ? `Appium answered but is not ready: ${status.message ?? 'unknown reason'}`
            : `Connected to Appium${version ? ` ${version}` : ''}.`,
      };
    } catch (error) {
      const message = error instanceof AppiumError ? error.message : (error as Error).message;
      return {
        ok: false,
        message: `${message} Use Start Appium in Settings → Mobile (Android), or run Setup Android Environment first.`,
      };
    }
  }

  private normalize(input: Partial<AppiumSettings>): AppiumSettings {
    const previous = this.current();
    let serverUrl =
      String(input.serverUrl ?? '')
        .trim()
        .replace(/\/$/, '') || DEFAULT_APPIUM_URL;
    let parsed: URL;
    try {
      parsed = new URL(serverUrl);
    } catch {
      throw new HttpError(400, 'Enter the Appium server URL, e.g. http://127.0.0.1:4723');
    }
    if (!/^https?:$/.test(parsed.protocol))
      throw new HttpError(400, 'The Appium server URL must start with http:// or https://');
    // Password samaran = pertahankan password yang tersimpan.
    if (decodeURIComponent(parsed.password) === SECRET_MASK) {
      try {
        parsed.password = new URL(previous.serverUrl).password;
      } catch {
        parsed.password = '';
      }
      serverUrl = parsed.toString().replace(/\/$/, '');
    }
    const capabilities = String(input.capabilities ?? '').trim();
    try {
      parseCapabilities(capabilities, 'Default capabilities');
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    const defaultMode = (MOBILE_EXECUTION_MODES as readonly string[]).includes(String(input.defaultMode))
      ? (input.defaultMode as AppiumSettings['defaultMode'])
      : previous.defaultMode;
    return { serverUrl, capabilities, defaultMode };
  }
}
