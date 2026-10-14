import type { NotifyWhen } from '@flowqa/shared';
import { MAX_NOTIFY_RECIPIENTS } from '@flowqa/shared';
import { useNotificationStatus, useSendTestEmail } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { EmailListInput, Field, Toggle, isValidEmail } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { Link } from 'react-router-dom';

export interface EmailDraft {
  enabled: boolean;
  recipients: string[];
  when: NotifyWhen;
}

/** Pengaturan "kirim hasil test ke email" untuk satu project (bagian dari form project). */
export function NotificationSettings({
  projectId,
  value,
  onChange,
}: {
  /** Kosong untuk project baru (tombol email percobaan disembunyikan). */
  projectId?: string;
  value: EmailDraft;
  onChange: (patch: Partial<EmailDraft>) => void;
}) {
  const { data: status } = useNotificationStatus();
  const isAdmin = useAuth().user?.role === 'admin';
  const sendTest = useSendTestEmail(projectId ?? '');
  const toast = useToast();
  const defaults = status?.defaultRecipients ?? [];
  // Daftar kosong = penerima default dari Settings → Email Report.
  const recipients = value.recipients.length ? value.recipients : defaults;
  const allValid = recipients.every(isValidEmail);

  const test = () =>
    sendTest.mutate(recipients, {
      onSuccess: ({ sentTo }) =>
        toast(`Test email sent to ${sentTo.join(', ')}. Check the inbox (and spam folder).`),
    });

  return (
    <div className="rec-login">
      <Toggle checked={value.enabled} onChange={(enabled) => onChange({ enabled })}>
        <span>
          <b>Email test results</b>
          <span className="small muted">
            {' '}
            — every API, UI and performance run of this project is emailed when it finishes. A bulk run sends
            one summary email.
          </span>
        </span>
      </Toggle>
      {status && !status.emailConfigured && (
        <p className="small text-fail" style={{ margin: '10px 0 0' }}>
          Email is not set up yet.{' '}
          {isAdmin ? (
            <>
              Set up the mail server in <Link to="/settings/email">Settings → Email Report</Link>.
            </>
          ) : (
            <>Ask an administrator to set it up in Settings → Email Report.</>
          )}{' '}
          Settings saved here start working after that.
        </p>
      )}
      {value.enabled && (
        <div className="grid mt-12">
          <Field
            group
            label="Send to"
            hint={
              defaults.length
                ? `Type an address and press Enter or comma, or paste a list. Leave empty to use the default recipients from Settings → Email Report: ${defaults.join(', ')}.`
                : 'Type an address and press Enter or comma. You can also paste a list.'
            }
          >
            <EmailListInput
              label="Email recipients"
              value={value.recipients}
              max={MAX_NOTIFY_RECIPIENTS}
              placeholder="qa@company.com"
              onChange={(recipients) => onChange({ recipients })}
            />
          </Field>
          <div className="row wrap" style={{ gap: 10 }}>
            <Field label="When">
              <select
                className="in"
                value={value.when}
                onChange={(e) => onChange({ when: e.target.value as NotifyWhen })}
              >
                <option value="always">After every run</option>
                <option value="failed">Only when a test fails</option>
              </select>
            </Field>
            <div className="grow" />
            {projectId && status?.emailConfigured && (
              <button
                className="btn sm"
                type="button"
                style={{ alignSelf: 'flex-end' }}
                disabled={!recipients.length || !allValid || sendTest.isPending}
                onClick={test}
              >
                <Icon name="upload" size={13} /> {sendTest.isPending ? 'Sending…' : 'Send test email'}
              </button>
            )}
          </div>
          {status?.emailConfigured && (
            <p className="small muted" style={{ margin: 0 }}>
              Sent from <span className="code">{status.from}</span>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
