/** Pengiriman email lewat SMTP (nodemailer). Test memakai Mailer palsu. */
import nodemailer from 'nodemailer';
import type { SmtpSecurity } from '@flowqa/shared';

export interface MailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  readonly from: string;
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  password: string;
  from: string;
}

/** Mailer SMTP; null bila SMTP belum dikonfigurasi (email mati). */
export function createSmtpMailer(smtp: SmtpConfig): Mailer | null {
  if (!smtp.host || !smtp.from) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'ssl',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  return {
    from: smtp.from,
    async send(message) {
      const { to, subject, text, html, attachments } = message;
      await transport.sendMail({ from: smtp.from, to: to.join(', '), subject, text, html, attachments });
    },
  };
}
