import { useNavigate } from 'react-router-dom';
import type { Run } from '@flowqa/shared';
import { EmptyState, RunCounts, SelectCell, StatusBadge } from '@/components/ui';
import type { Selection } from '@/hooks/useSelection';
import { formatMs } from '@/lib/format';
import { DateTime } from '@/components/DateTime';
import { useStopRun } from '@/api/queries';
import { StopRunButton } from './StopRunButton';

/**
 * Tabel ringkas daftar run; klik baris membuka detail run. Dengan `selection`,
 * muncul kolom centang (run yang masih berjalan tidak bisa dipilih).
 */
export function RunTable({
  runs,
  compact,
  selection,
}: {
  runs: Run[];
  compact?: boolean;
  selection?: Selection;
}) {
  const navigate = useNavigate();
  const stop = useStopRun();
  if (!runs.length) return <EmptyState title="No runs yet">Open a scenario and select Run test.</EmptyState>;
  const selectable = runs.filter((r) => r.status !== 'running').map((r) => r.id);
  const all = selection?.stateOf(selectable);
  return (
    <div className="tbl-wrap">
      <table className="t">
        <thead>
          <tr>
            {selection && (
              <SelectCell
                header
                checked={!!all?.all}
                indeterminate={all?.some}
                disabled={!selectable.length}
                onChange={() => selection.setMany(selectable, !all?.all)}
                label="Select all finished runs"
              />
            )}
            <th>Scenario</th>
            <th>Result</th>
            {!compact && <th>Steps</th>}
            {!compact && <th>Mode</th>}
            <th>Environment</th>
            <th>Duration</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="click" onClick={() => navigate(`/runs/${r.id}`)}>
              {selection && (
                <SelectCell
                  checked={selection.selected.has(r.id)}
                  disabled={r.status === 'running'}
                  onChange={() => selection.toggle(r.id)}
                  label={
                    r.status === 'running'
                      ? 'Running runs cannot be deleted'
                      : `Select run of ${r.scenarioName}`
                  }
                />
              )}
              <td>
                <b>{r.scenarioName}</b>{' '}
                {r.trigger === 'schedule' && <span className="chip plain">scheduled</span>}
              </td>
              <td>
                <span className="row" style={{ gap: 6 }}>
                  <StatusBadge status={r.status} />
                  {r.status === 'running' && (
                    <StopRunButton
                      compact
                      pending={stop.isPending && stop.variables === r.id}
                      what="The request in progress is cancelled and the remaining steps are skipped."
                      onStop={(done) => stop.mutate(r.id, done)}
                    />
                  )}
                </span>
              </td>
              {!compact && (
                <td className="small">
                  <RunCounts passed={r.counts.passed} failed={r.counts.failed} skipped={r.counts.skipped} />
                </td>
              )}
              {!compact && <td className="small muted">{r.mode}</td>}
              <td>{r.environmentName}</td>
              <td className="code">{r.status === 'running' ? '…' : formatMs(r.durationMs)}</td>
              <td className="small">
                <DateTime value={r.startedAt} relative={!compact} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
