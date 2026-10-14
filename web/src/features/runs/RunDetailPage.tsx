import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { displayValue } from '@flowqa/shared';
import { useRun, useStartRunAndOpen, useStopRun } from '@/api/queries';
import { Icon } from '@/components/Icon';
import {
  BackLink,
  ErrorBox,
  IconButton,
  Loading,
  RunCounts,
  Stat,
  StatGrid,
  StatusBadge,
} from '@/components/ui';
import { useRunDeletion } from '@/components/runs/useRunDeletion';
import { formatMs, formatNumber, timeAgo } from '@/lib/format';
import { FailureBox } from '@/components/runs/FailureBox';
import { ResponseViewerModal } from '@/components/runs/ResponseViewerModal';
import { StepResultRow } from '@/components/runs/StepResultRow';
import { DateTime } from '@/components/DateTime';
import { StopRunButton, StoppedNote } from '@/components/runs/StopRunButton';

export function RunDetailPage() {
  const { runId = '' } = useParams();
  const { data: run, isLoading, error } = useRun(runId);
  const startRun = useStartRunAndOpen();
  const [viewing, setViewing] = useState<number | null>(null);
  const deletion = useRunDeletion('api');
  const stop = useStopRun();
  const navigate = useNavigate();

  if (isLoading) return <Loading />;
  if (error || !run) return <ErrorBox error={error} />;

  const failed = run.steps.find((s) => s.status === 'failed');
  const rerun = () => startRun.run({ scenarioId: run.scenarioId, environmentId: run.environmentId });

  return (
    <>
      <div className="row wrap detail-bar">
        <BackLink to="/runs" label="Test runs" />
        <div className="grow" />
        <IconButton
          icon="trash"
          label={run.status === 'running' ? 'A running test cannot be deleted' : 'Delete run'}
          className="danger"
          disabled={run.status === 'running' || deletion.deleting}
          onClick={() => deletion.remove(run.projectId, [run.id], () => navigate('/runs'))}
        />
        <Link className="btn" to={`/scenarios/${run.scenarioId}`}>
          Open scenario
        </Link>
        {run.status === 'running' ? (
          <StopRunButton
            pending={stop.isPending}
            what="The request in progress is cancelled and the remaining steps are skipped."
            onStop={(done) => stop.mutate(run.id, done)}
          />
        ) : (
          <button className="btn primary" onClick={rerun}>
            <Icon name="play" size={13} /> Run again
          </button>
        )}
      </div>

      <StatGrid className="mb-16" columns={3}>
        <Stat label="Scenario" size="sm" value={run.scenarioName} />
        <Stat
          label="Result"
          value={<StatusBadge status={run.status} />}
          sub={run.status === 'running' ? undefined : `took ${formatMs(run.durationMs)}`}
        />
        <Stat
          label="Steps"
          size="sm"
          value={formatNumber(run.steps.length)}
          sub={
            <RunCounts passed={run.counts.passed} failed={run.counts.failed} skipped={run.counts.skipped} />
          }
        />
        <Stat label="Environment" size="sm" value={run.environmentName} sub={run.mode} />
        <Stat
          label="Started"
          size="sm"
          value={<DateTime value={run.startedAt} />}
          sub={timeAgo(run.startedAt)}
        />
        <Stat
          label="Finished"
          size="sm"
          value={run.status === 'running' ? '…' : <DateTime value={run.finishedAt} />}
        />
      </StatGrid>

      {run.status === 'stopped' && (
        <StoppedNote by={run.stoppedBy} what="The steps that had not run yet were skipped." />
      )}

      {failed?.explanation && (
        <div style={{ marginBottom: 16 }}>
          <FailureBox
            explanation={failed.explanation}
            stepLabel={`Step ${failed.index + 1} · ${failed.name}`}
          />
        </div>
      )}

      <div className="dash-grid">
        <section className="panel c-8">
          <div className="panel-h">
            <h3>Steps</h3>
            <span className="small muted">
              {run.mode} · {run.trigger === 'schedule' ? 'scheduled' : 'manual'}
            </span>
          </div>
          {run.steps.map((s) => (
            <StepResultRow key={s.stepId} result={s} onOpen={() => setViewing(s.index)} />
          ))}
        </section>
        <section className="panel c-4">
          <div className="panel-h">
            <h3>Captured values</h3>
          </div>
          <div className="panel-b">
            {Object.keys(run.variables ?? {}).length ? (
              Object.entries(run.variables).map(([k, v]) => (
                <div key={k} className="tree-row">
                  <span className="k code">{k}</span>
                  <span className="v">{displayValue(v)}</span>
                </div>
              ))
            ) : (
              <div className="muted small">No values captured.</div>
            )}
          </div>
        </section>
      </div>

      {viewing !== null && (
        <ResponseViewerModal run={run} initialIndex={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}
