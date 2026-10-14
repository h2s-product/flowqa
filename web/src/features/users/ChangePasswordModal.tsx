import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@flowqa/shared';
import { useChangePassword } from '@/api/queries';
import { Modal } from '@/components/Modal';
import { Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

/** Ganti password milik sendiri. Sesi di perangkat lain otomatis dikeluarkan. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const change = useChangePassword();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const problem =
    next && next.length < PASSWORD_MIN_LENGTH
      ? `Use at least ${PASSWORD_MIN_LENGTH} characters.`
      : confirm && next !== confirm
        ? 'The new passwords do not match.'
        : '';

  const submit = () =>
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => (toast('Password changed. Other devices were signed out.'), onClose()),
      },
    );

  return (
    <Modal
      title="Change password"
      onClose={onClose}
      footer={
        <>
          {problem && (
            <span className="small" style={{ marginRight: 'auto', color: 'var(--red)' }}>
              {problem}
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={change.isPending || !current || !next || next !== confirm || !!problem}
          >
            Change password
          </button>
        </>
      }
    >
      <div className="grid">
        <Field label="Current password">
          <input
            className="in"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
          <input
            className="in"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            className="in"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
