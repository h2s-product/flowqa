import type { StepResult } from '@flowqa/shared';
import { StatusIcon } from '@/components/ui';
import { formatMs } from '@/lib/format';
import { DateTime } from '@/components/DateTime';

/** Satu baris hasil step di panel hasil run. */
export function StepResultRow({ result, onOpen }: { result: StepResult; onOpen?: () => void }) {
  const failedCheck = result.assertions?.find((a) => !a.passed);
  return (
    <div
      className="res-row"
      onClick={result.response || result.request ? onOpen : undefined}
      style={{ cursor: result.response || result.request ? 'pointer' : 'default' }}
    >
      <StatusIcon
        status={result.status === 'queued' || result.status === 'not-run' ? 'skipped' : result.status}
      />
      <div style={{ minWidth: 0 }}>
        <b>
          {result.index + 1}. {result.name}
        </b>
        <div className="small muted">
          {result.status === 'failed' && failedCheck
            ? `${failedCheck.label} — got ${failedCheck.actual}`
            : result.response
              ? `${result.response.status} ${result.response.statusText}${result.attempts && result.attempts > 1 ? ` · ${result.attempts} attempts` : ''}`
              : (result.note ?? (result.status === 'queued' ? 'Waiting' : ''))}
        </div>
      </div>
      <span className="code small muted" style={{ textAlign: 'right' }}>
        {result.durationMs != null && result.status !== 'skipped' ? formatMs(result.durationMs) : ''}
        {result.startedAt && (
          <div>
            <DateTime value={result.startedAt} timeOnly />
          </div>
        )}
      </span>
    </div>
  );
}
