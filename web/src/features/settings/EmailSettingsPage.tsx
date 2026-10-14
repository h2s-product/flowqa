import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EmailSettings, SmtpSecurity } from '@flowqa/shared';
import { MAX_NOTIFY_RECIPIENTS } from '@flowqa/shared';
import {
  useEmailSettings,
  useResetEmailSettings,
  useSaveEmailSettings,
  useSendSettingsTestEmail,
} from '@/api/queries';
import { Icon } from '@/components/Icon';
import { EmailListInput, EmptyState, ErrorBox, Field, Loading, isValidEmail } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';

/** Isian cepat untuk layanan email populer. */
const PRESETS: { name: string; host: string; port: number; security: SmtpSecurity; note: string }[] = [
  {
    name: 'Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    security: 'starttls',
    note: 'Use your Gmail address as username and an App Password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.',
  },
  {
    name: 'Microsoft 365 / Outlook',
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    note: 'Use the full mailbox address as username. SMTP sending (SMTP AUTH) must be allowed for the mailbox.',
  },
  {
    name: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    security: 'starttls',
    note: 'Username is literally "apikey"; the password is your SendGrid API key. The sender must be a verified address.',
  },
  {
    name: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    security: 'starttls',
    note: 'Use the SMTP credentials of your Mailgun domain.',
  },
];

const SECURITY_LABEL: Record<SmtpSecurity, string> = {
  starttls: 'STARTTLS (usually port 587)',
  ssl: 'SSL/TLS (usually port 465)',
  none: 'None (internal mail relay only)',
};

const EMPTY: EmailSettings = {
  host: '',
  port: 587,
  security: 'starttls',
  user: '',
  password: '',
  from: '',
  appUrl: '',
  recipients: [],
};

/** Settings → Email Report: SMTP untuk email hasil test (khusus admin). */
export function EmailSettingsPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useEmailSettings();
  const save = useSaveEmailSettings();
  const reset = useResetEmailSettings();
  const sendTest = useSendSettingsTestEmail();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<EmailSettings>(EMPTY);
  const [note, setNote] = useState('');
  const set = (patch: Partial<EmailSettings>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (data)
      setForm({
        host: data.host,
        port: data.port,
        security: data.security,
        user: data.user,
        password: data.password,
        from: data.from,
        appUrl: data.appUrl || window.location.origin,
        // Belum ada penerima tersimpan → usulkan email admin yang sedang login.
        recipients: data.recipients.length ? data.recipients : user?.email ? [user.email] : [],
      });
  }, [data]);

  if (user?.role !== 'admin')
    return (
      <div className="panel">
        <EmptyState title="Only administrators can change settings">
          Ask an administrator to set up the email server.
        </EmptyState>
      </div>
    );
  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const recipientsValid = form.recipients.every(isValidEmail);
  const ready = !!form.host.trim() && !!form.from.trim() && form.port > 0 && recipientsValid;
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    set({ host: p.host, port: p.port, security: p.security });
    setNote(p.note);
  };
  const submit = () =>
    save.mutate(form, { onSuccess: () => toast('Email settings saved — used right away') });
  const test = () =>
    sendTest.mutate(
      { to: form.recipients, settings: form },
      {
        onSuccess: ({ sentTo }) =>
          toast(`Test email sent to ${sentTo.join(', ')}. Check the inbox (and spam folder).`),
      },
    );
  const remove = async () =>
    (await confirm({
      title: 'Remove the saved email settings?',
      message: 'Result emails stop, unless the server’s .env file has SMTP settings.',
      confirmLabel: 'Remove',
    })) && reset.mutate(undefined, { onSuccess: () => toast('Email settings removed') });

  return (
    <div className="settings-page">
      <div className={`banner ${data.source === 'none' ? 'warn' : ''}`}>
        <Icon name="mail" size={16} />
        <span>
          {data.source === 'app' && (
            <>Email is on. These settings are used to send test results for every project.</>
          )}
          {data.source === 'env' && (
            <>
              Email is on, using the <span className="code">.env</span> file of the server. Save the form
              below to manage it from Testora instead.
            </>
          )}
          {data.source === 'none' && (
            <>Email is off. Fill in your mail server below, send a test email, then save.</>
          )}{' '}
          Choose who gets the results per project in{' '}
          <Link to="/projects">Projects → Edit details → Email test results</Link>.
        </span>
      </div>

      <section className="panel">
        <div className="panel-h">
          <h3>Mail server (SMTP)</h3>
        </div>
        <div className="panel-b grid">
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="small muted">Quick fill:</span>
            {PRESETS.map((p) => (
              <button key={p.name} type="button" className="btn sm" onClick={() => applyPreset(p)}>
                {p.name}
              </button>
            ))}
          </div>
          {note && (
            <p className="small muted" style={{ margin: 0 }}>
              {note}
            </p>
          )}
          <div className="grid two">
            <Field label="SMTP server">
              <input
                className="in code"
                value={form.host}
                placeholder="smtp.gmail.com"
                onChange={(e) => set({ host: e.target.value })}
              />
            </Field>
            <div className="grid two">
              <Field label="Port">
                <input
                  className="in"
                  type="number"
                  value={form.port}
                  onChange={(e) => set({ port: Number(e.target.value) })}
                />
              </Field>
              <Field label="Security">
                <select
                  className="in"
                  value={form.security}
                  onChange={(e) => set({ security: e.target.value as SmtpSecurity })}
                >
                  {(Object.keys(SECURITY_LABEL) as SmtpSecurity[]).map((s) => (
                    <option key={s} value={s}>
                      {SECURITY_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field
              label="Username"
              hint="Usually the email address. Leave empty if the server needs no login."
            >
              <input
                className="in"
                autoComplete="off"
                value={form.user}
                onChange={(e) => set({ user: e.target.value })}
              />
            </Field>
            <Field
              label="Password"
              hint={
                data.passwordSet
                  ? 'A password is saved. Leave as is to keep it, or type a new one.'
                  : 'Stored on the server only; never shown again.'
              }
            >
              <input
                className="in"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onFocus={(e) => e.target.select()}
                onChange={(e) => set({ password: e.target.value })}
              />
            </Field>
            <Field label="Send as" hint="The sender shown in the inbox, e.g. Testora <qa@company.com>.">
              <input
                className="in"
                value={form.from}
                placeholder="Testora <qa@company.com>"
                onChange={(e) => set({ from: e.target.value })}
              />
            </Field>
            <Field
              label="Testora address for links"
              hint="The “Open the result” button in emails opens this address."
            >
              <input
                className="in code"
                value={form.appUrl}
                placeholder={window.location.origin}
                onChange={(e) => set({ appUrl: e.target.value })}
              />
            </Field>
          </div>
        </div>
        <div className="panel-b settings-test">
          <Field
            group
            label="Send reports to"
            hint="Saved with the settings. Used by every project that emails results without its own list of recipients. “Send test email” sends to these addresses using the values above, so you can try them before saving."
          >
            <div className="settings-test-row">
              <EmailListInput
                label="Report recipients"
                value={form.recipients}
                max={MAX_NOTIFY_RECIPIENTS}
                onChange={(recipients) => set({ recipients })}
              />
              <button
                className="btn"
                type="button"
                disabled={!ready || !form.recipients.length || sendTest.isPending}
                onClick={test}
              >
                <Icon name="upload" size={13} /> {sendTest.isPending ? 'Sending…' : 'Send test email'}
              </button>
            </div>
          </Field>
        </div>
        <div className="panel-b row settings-actions">
          <div className="grow" />
          {data.source === 'app' && (
            <button className="btn ghost" type="button" disabled={reset.isPending} onClick={remove}>
              Remove saved settings
            </button>
          )}
          <button className="btn primary" type="button" disabled={!ready || save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </section>
    </div>
  );
}
