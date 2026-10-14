import type { ReactNode } from 'react';
import type {
  HttpMethod,
  PerfRunStatus,
  RecordingStatus,
  RunStatus,
  StepStatus,
  UiRunStatus,
  UiStepStatus,
} from '@flowqa/shared';
import { Icon, type IconName } from '../Icon';

/** Semua status yang bisa ditampilkan sebagai badge/ikon. */
export type AnyStatus = RunStatus | UiRunStatus | StepStatus | UiStepStatus | PerfRunStatus | RecordingStatus;

const STATUS_LABEL: Record<AnyStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  error: 'Error',
  running: 'Running',
  skipped: 'Skipped',
  queued: 'Waiting',
  'not-run': 'Not run',
  stopped: 'Stopped',
  starting: 'Starting',
  'signing-in': 'Signing in',
  replaying: 'Replaying',
  recording: 'Recording',
};

/** Label HTTP method berwarna (GET, POST, …). */
export const MethodBadge = ({ method }: { method: HttpMethod }) => (
  <span className={`method m-${method}`}>{method}</span>
);

/** Badge status berwarna. `children` mengganti teks bawaan (mis. "Running 3/9"). */
export const StatusBadge = ({ status, children }: { status: AnyStatus; children?: ReactNode }) => (
  <span className={`status st-${status}`}>{children ?? STATUS_LABEL[status]}</span>
);

const STATUS_ICON: Partial<Record<AnyStatus, IconName>> = {
  passed: 'check',
  failed: 'x',
  error: 'x',
  running: 'spin',
};

/** Ikon status bulat kecil untuk daftar step/run. */
export function StatusIcon({ status }: { status: AnyStatus }) {
  return (
    <span className={`ri ${status}`} role="img" aria-label={STATUS_LABEL[status]}>
      <Icon name={STATUS_ICON[status] ?? 'minus'} size={12} strokeWidth={3.2} />
    </span>
  );
}
