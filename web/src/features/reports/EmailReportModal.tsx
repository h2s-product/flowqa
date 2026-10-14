import { useState } from 'react';
import type { Project, ReportKind } from '@flowqa/shared';
import { MAX_NOTIFY_RECIPIENTS } from '@flowqa/shared';
import { useEmailReport, useNotificationStatus } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmailListInput, Field, isValidEmail } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

/**
 * Kirim laporan yang sedang tampil ke email. Lampiran HTML dibuat dari halaman
 * Reports saat tombol Send ditekan (`capture`), jadi tampilannya persis sama.
 */
export function EmailReportModal({
  kind,
  project,
  filter,
  fileName,
  describe,
  capture,
  onClose,
}: {
  kind: ReportKind;
  project: Project;
  filter: { from: string; to: string; environmentId?: string; folderId?: string };
  fileName: string;
  /** Ringkasan isi laporan (periode, folder, filter) untuk ditampilkan di form. */
  describe: string;
  capture: () => Promise<string>;
  onClose: () => void;
}) {
  const { data: status } = useNotificationStatus();
  const send = useEmailReport(project.id);
  const toast = useToast();
  const own = project.notifications?.email.recipients ?? [];
  const [recipients, setRecipients] = useState<string[]>(
    own.length ? own : (status?.defaultRecipients ?? []),
  );
  const [message, setMessage] = useState('');
  const [preparing, setPreparing] = useState(false);
  const valid = recipients.length > 0 && recipients.every(isValidEmail);

  const submit = async () => {
    setPreparing(true);
    try {
      const html = await capture();
      send.mutate(
        { kind, filter, recipients, message, html, fileName },
        {
          onSuccess: ({ sentTo }) => {
            toast(`Report emailed to ${sentTo.join(', ')}`);
            onClose();
          },
        },
      );
    } finally {
      setPreparing(false);
    }
  };
  const busy = preparing || send.isPending;

  return (
    <Modal
      title="Email this report"
      subtitle={describe}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={!valid || busy || !status?.emailConfigured}
          >
            <Icon name="mail" size={14} /> {busy ? 'Sending…' : 'Send report'}
          </button>
        </>
      }
    >
      <div className="grid">
        {status && !status.emailConfigured && (
          <p className="small text-fail" style={{ margin: 0 }}>
            Email is not set up yet. An administrator can set it up in Settings → Email Report.
          </p>
        )}
        <Field group label="Send to" hint="Type an address and press Enter or comma, or paste a list.">
          <EmailListInput
            label="Report recipients"
            value={recipients}
            max={MAX_NOTIFY_RECIPIENTS}
            onChange={setRecipients}
          />
        </Field>
        <Field label="Message (optional)">
          <textarea
            className="in"
            rows={3}
            value={message}
            placeholder="e.g. Weekly UI regression results for the release meeting."
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          <Icon name="upload" size={12} /> Attached as <span className="code">{fileName}</span>: the report
          exactly as shown on this page, with every test opened. It opens in any browser without signing in.
        </p>
      </div>
    </Modal>
  );
}
