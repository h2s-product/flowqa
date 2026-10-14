/**
 * Pengaturan SMTP untuk email hasil test, diatur admin di Settings → Email Report.
 * Pengaturan dari aplikasi (database) diutamakan; bila belum ada, dipakai .env.
 * Password SMTP tidak pernah dikirim balik ke browser.
 */
import type { EmailSettings, EmailSettingsView } from '@flowqa/shared';
import { SECRET_MASK, SMTP_SECURITY } from '@flowqa/shared';
import { HttpError } from '../lib/http';
import { createSmtpMailer, type Mailer, type SmtpConfig } from '../lib/mailer';
import type { SettingsRepository } from '../repositories/settings-repository';
import { renderTestEmail } from '../domain/run-email';
import { normalizeNotifications } from '../domain/normalizers';

const KEY = 'email';
const EMPTY_SETTINGS: EmailSettings = {
  host: '',
  port: 587,
  security: 'starttls',
  user: '',
  password: '',
  from: '',
  appUrl: '',
  recipients: [],
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailEnvDefaults {
  smtp: SmtpConfig;
  appUrl: string;
}

/** Sumber mailer, alamat web & penerima default untuk NotificationService. */
export interface MailProvider {
  mailer(): Mailer | null;
  appUrl(): string;
  defaultRecipients(): string[];
}

export class EmailSettingsService implements MailProvider {
  private cached: { key: string; mailer: Mailer | null } | null = null;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly env: EmailEnvDefaults,
  ) {}

  /** Pengaturan yang sedang dipakai (untuk form Settings; password disamarkan). */
  view(): EmailSettingsView {
    const saved = this.stored();
    const source = saved ? 'app' : this.env.smtp.host ? 'env' : 'none';
    const current: EmailSettings = saved ?? {
      host: this.env.smtp.host,
      port: this.env.smtp.port,
      security: this.env.smtp.security,
      user: this.env.smtp.user,
      password: this.env.smtp.password,
      from: this.env.smtp.from,
      appUrl: this.env.appUrl,
      recipients: [],
    };
    return {
      ...current,
      password: current.password ? SECRET_MASK : '',
      passwordSet: !!current.password,
      source,
    };
  }

  /** Simpan dari form. Password kosong / samaran = pertahankan password lama. */
  save(input: Partial<EmailSettings>): EmailSettingsView {
    this.settings.set(KEY, this.normalize(input));
    this.cached = null;
    return this.view();
  }

  /** Hapus pengaturan aplikasi (kembali memakai .env, atau email mati). */
  reset(): EmailSettingsView {
    this.settings.delete(KEY);
    this.cached = null;
    return this.view();
  }

  /**
   * Kirim email percobaan memakai isian form (boleh belum disimpan). Tanpa `to`,
   * dikirim ke penerima laporan di form / yang tersimpan.
   */
  async sendTest(to: string[], draft?: Partial<EmailSettings>): Promise<string[]> {
    if (!to.length) to = draft ? this.normalize(draft).recipients : this.defaultRecipients();
    if (!to.length) throw new HttpError(400, 'Add at least one email address to send the test email to');
    const invalid = to.find((address) => !EMAIL.test(address));
    if (invalid) throw new HttpError(400, `"${invalid}" is not a valid email address`);
    const settings = draft ? this.normalize(draft) : this.active();
    const mailer = settings && createSmtpMailer(toSmtp(settings));
    if (!mailer) throw new HttpError(400, 'Fill in the SMTP server and the sender address first');
    try {
      await mailer.send({ to, ...renderTestEmail('Testora') });
    } catch (error) {
      throw new HttpError(502, `The mail server refused the email: ${(error as Error).message}`);
    }
    return to;
  }

  defaultRecipients(): string[] {
    return this.stored()?.recipients ?? [];
  }

  mailer(): Mailer | null {
    const active = this.active();
    const key = JSON.stringify(active);
    if (this.cached?.key !== key)
      this.cached = { key, mailer: active ? createSmtpMailer(toSmtp(active)) : null };
    return this.cached.mailer;
  }

  appUrl(): string {
    return (this.active()?.appUrl || this.env.appUrl).replace(/\/$/, '');
  }

  /* ------------------------------------------------------------------ */

  /** Pengaturan tersimpan, dilengkapi nilai bawaan untuk field yang ditambahkan belakangan (mis. recipients). */
  private stored(): EmailSettings | undefined {
    const saved = this.settings.get<Partial<EmailSettings>>(KEY);
    return saved ? { ...EMPTY_SETTINGS, ...saved, recipients: saved.recipients ?? [] } : undefined;
  }

  private active(): EmailSettings | null {
    const saved = this.stored();
    if (saved) return saved;
    const { smtp } = this.env;
    return smtp.host ? { ...smtp, appUrl: this.env.appUrl, recipients: [] } : null;
  }

  private normalize(input: Partial<EmailSettings>): EmailSettings {
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const host = text(input.host);
    if (!host) throw new HttpError(400, 'Enter the SMTP server, e.g. smtp.gmail.com');
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new HttpError(400, 'The port must be between 1 and 65535');
    const from = text(input.from);
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
    if (!EMAIL.test(address))
      throw new HttpError(400, 'Enter the sender address, e.g. Testora <qa@company.com>');
    const appUrl = text(input.appUrl);
    if (appUrl && !/^https?:\/\//i.test(appUrl))
      throw new HttpError(400, 'The Testora address must start with http:// or https://');
    const recipients = normalizeNotifications({ email: { recipients: input.recipients ?? [] } }).email
      .recipients;
    const password = typeof input.password === 'string' ? input.password : '';
    const previous = this.stored()?.password ?? this.env.smtp.password;
    return {
      host,
      port,
      security: SMTP_SECURITY.includes(input.security as never) ? input.security! : 'starttls',
      user: text(input.user),
      password: !password || password === SECRET_MASK ? previous : password,
      from,
      appUrl: appUrl.replace(/\/$/, ''),
      recipients,
    };
  }
}

const toSmtp = (s: EmailSettings): SmtpConfig => ({
  host: s.host,
  port: s.port,
  security: s.security,
  user: s.user,
  password: s.password,
  from: s.from,
});
