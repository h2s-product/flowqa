import type { MouseEvent } from 'react';
import { Icon } from '../Icon';
import { IconButton } from '../ui/IconButton';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';

type StopHandler = (done: { onSuccess: () => void; onError: (error: Error) => void }) => void;

/** Konfirmasi lalu hentikan run; `what` menjelaskan apa saja yang ikut berhenti. */
function useStopRun(onStop: StopHandler, what: string) {
  const confirm = useConfirm();
  const toast = useToast();
  return async (event: MouseEvent) => {
    // Di dalam baris tabel: jangan ikut membuka detail run.
    event.stopPropagation();
    const ok = await confirm({
      title: 'Stop this run?',
      message: `${what} The results collected so far are kept.`,
      confirmLabel: 'Stop run',
    });
    if (ok)
      onStop({
        onSuccess: () => toast('Stopping the run…'),
        onError: (error) => toast(error.message),
      });
  };
}

/**
 * Tombol "Stop" untuk run yang sedang berjalan (API, UI web/mobile, E2E Flow).
 * `compact` = ikon kecil untuk baris tabel daftar run.
 */
export function StopRunButton({
  onStop,
  pending,
  what,
  compact,
}: {
  onStop: StopHandler;
  pending: boolean;
  /** Mis. "The browser closes and the remaining steps are skipped." */
  what: string;
  compact?: boolean;
}) {
  const stop = useStopRun(onStop, what);
  if (compact)
    return (
      <IconButton
        icon={pending ? 'spin' : 'stop'}
        label="Stop this run"
        className="danger"
        size={12}
        disabled={pending}
        onClick={stop}
      />
    );
  return (
    <button type="button" className="btn danger" disabled={pending} onClick={stop}>
      <Icon name={pending ? 'spin' : 'stop'} size={13} /> {pending ? 'Stopping…' : 'Stop'}
    </button>
  );
}

/** Keterangan untuk run yang dihentikan dengan tombol Stop. */
export function StoppedNote({ by, what }: { by?: string; what: string }) {
  return (
    <div className="banner mb-16" role="status">
      <Icon name="stop" size={14} />
      <span>
        <b>Stopped{by ? ` by ${by}` : ''}.</b> {what}
      </span>
    </div>
  );
}
