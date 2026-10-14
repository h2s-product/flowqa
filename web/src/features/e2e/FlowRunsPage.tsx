import { useNavigate } from 'react-router-dom';
import { useDeleteFlowRun, useFlowRuns, useStopFlowRun } from '@/api/queries';
import { StopRunButton } from '@/components/runs/StopRunButton';
import { DateTime } from '@/components/DateTime';
import { EmptyState, ErrorBox, IconButton, Loading, StatusBadge } from '@/components/ui';
import { useConfirm } from '@/context/ConfirmContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatMs } from '@/lib/format';
import { NodeProgressSummary, useNodeProgress } from './nodeProgress';

/** Riwayat run E2E Flow. */
export function FlowRunsPage() {
  const { projectId = '' } = useWorkspace();
  const { data: runs = [], isLoading, error } = useFlowRuns(projectId, { limit: 200 });
  const remove = useDeleteFlowRun(projectId);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const stop = useStopFlowRun();
  // Node yang sedang berjalan di run yang masih berjalan: tampilkan step yang sedang dikerjakan.
  const liveNodes = runs
    .filter((r) => r.status === 'running')
    .flatMap((r) => r.nodes.filter((n) => n.status === 'running'));
  const progress = useNodeProgress(liveNodes, (n) => n.runId ?? n.nodeId);
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!runs.length)
    return (
      <div className="panel">
        <EmptyState title="No flow runs yet">Open a flow in E2E Flows and click Run flow.</EmptyState>
      </div>
    );
  return (
    <div className="panel tbl-wrap">
      <table className="t">
        <thead>
          <tr>
            <th>Flow</th>
            <th>Result</th>
            <th>Nodes</th>
            <th>Environment</th>
            <th>Started</th>
            <th>Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const count = (s: string) => r.nodes.filter((n) => n.status === s).length;
            return (
              <tr key={r.id} className="click" onClick={() => navigate(`/e2e/runs/${r.id}`)}>
                <td>
                  <b>{r.flowName}</b>
                  {r.failureReason && (
                    <div className="small text-fail ellipsis" style={{ maxWidth: 360 }}>
                      {r.failureReason}
                    </div>
                  )}
                </td>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <StatusBadge status={r.status} />
                    {r.status === 'running' && (
                      <StopRunButton
                        compact
                        pending={stop.isPending && stop.variables === r.id}
                        what="Every test running in the flow (web, Android, API) is stopped too, and the nodes that have not started are skipped."
                        onStop={(done) => stop.mutate(r.id, done)}
                      />
                    )}
                  </span>
                </td>
                <td className="small">
                  <span className="text-pass">{count('passed')} passed</span>
                  {count('failed') > 0 && <span className="text-fail"> · {count('failed')} failed</span>}
                  {count('skipped') > 0 && <span className="muted"> · {count('skipped')} skipped</span>}
                  {r.status === 'running' &&
                    r.nodes
                      .filter((n) => n.status === 'running')
                      .map((n) => (
                        <div key={n.nodeId} className="flow-run-live">
                          <div className="ellipsis">
                            <b>{n.label}</b>
                          </div>
                          {n.runId && progress[n.runId] ? (
                            <NodeProgressSummary p={progress[n.runId]} />
                          ) : (
                            <span className="muted">Starting…</span>
                          )}
                        </div>
                      ))}
                </td>
                <td className="small">{r.environmentName}</td>
                <td className="small">
                  <DateTime value={r.startedAt} />
                </td>
                <td className="small">{r.status === 'running' ? '…' : formatMs(r.durationMs)}</td>
                <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'right' }}>
                  <IconButton
                    icon="trash"
                    label={r.status === 'running' ? 'A running flow cannot be deleted' : 'Delete run'}
                    disabled={r.status === 'running'}
                    onClick={async () =>
                      (await confirm({
                        title: 'Delete this flow run?',
                        message: 'The runs of its test cases stay in their own run history.',
                      })) && remove.mutate(r.id)
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
