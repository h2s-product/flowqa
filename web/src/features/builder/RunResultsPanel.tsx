import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Run } from '@flowqa/shared';
import { displayValue } from '@flowqa/shared';
import { EmptyState, StatusBadge } from '@/components/ui';
import { formatMs } from '@/lib/format';
import { FailureBox } from '@/components/runs/FailureBox';
import { ResponseViewerModal } from '@/components/runs/ResponseViewerModal';
import { StepResultRow } from '@/components/runs/StepResultRow';
import { DateTime } from '@/components/DateTime';
import { useStopRun } from '@/api/queries';
import { StopRunButton } from '@/components/runs/StopRunButton';

/** Ringkasan hasil run di panel kanan builder, diperbarui langsung selama run berjalan. */
export function RunResultsPanel({ run }: { run?: Run }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const stop = useStopRun();
  if (!run)
    return (
      <EmptyState title="No results yet">
        Select Run test to execute this scenario on the selected environment.
      </EmptyState>
    );

  const inScope = run.steps.filter((s) => s.status !== 'not-run');
  const done = inScope.filter((s) => !['queued', 'running'].includes(s.status)).length;
  const failed = run.steps.find((s) => s.status === 'failed');
  const variables = Object.entries(run.variables ?? {});

  return (
    <>
      <div className="cfg-section">
        <div className="row">
          <StatusBadge status={run.status}>
            {run.status === 'running' ? `Running ${done}/${inScope.length}` : undefined}
          </StatusBadge>
          <span className="small muted grow">
            {run.mode} · {run.environmentName} · <DateTime value={run.startedAt} relative />
          </span>
          {run.status === 'running' && (
            <StopRunButton
              compact
              pending={stop.isPending}
              what="The request in progress is cancelled and the remaining steps are skipped."
              onStop={(done) => stop.mutate(run.id, done)}
            />
          )}
          <Link className="btn sm ghost" to={`/runs/${run.id}`}>
            Full report
          </Link>
        </div>
        <div className="progress" style={{ marginTop: 10 }}>
          <div
            style={{
              width: `${inScope.length ? (done / inScope.length) * 100 : 0}%`,
              background: run.status === 'failed' ? 'var(--red)' : 'var(--green)',
            }}
          />
        </div>
        {run.status !== 'running' && (
          <div className="small" style={{ marginTop: 8, color: 'var(--ink2)' }}>
            {run.counts.passed} passed · {run.counts.failed} failed · {run.counts.skipped} skipped ·{' '}
            {formatMs(run.durationMs)}
          </div>
        )}
      </div>

      {failed?.explanation && (
        <div className="cfg-section">
          <FailureBox
            explanation={failed.explanation}
            stepLabel={`Step ${failed.index + 1} · ${failed.name}`}
          />
        </div>
      )}

      <div className="cfg-section" style={{ padding: 0 }}>
        {run.steps.map((s) => (
          <StepResultRow key={s.stepId} result={s} onOpen={() => setViewing(s.index)} />
        ))}
      </div>

      {variables.length > 0 && (
        <div className="cfg-section">
          <h4>Values captured in this run</h4>
          {variables.map(([k, v]) => (
            <div key={k} className="tree-row">
              <span className="k code">{k}</span>
              <span className="v">{displayValue(v)}</span>
            </div>
          ))}
        </div>
      )}

      {viewing !== null && (
        <ResponseViewerModal run={run} initialIndex={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}
