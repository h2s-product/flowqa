import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { FlowNodeStatus } from '@flowqa/shared';
import { useFlowRun, useRunFlow, useScenarios, useStopFlowRun, useUiTests } from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { BackLink, ErrorBox, Loading, Stat, StatGrid, StatusBadge } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatMs } from '@/lib/format';
import { StopRunButton, StoppedNote } from '@/components/runs/StopRunButton';
import { FlowCanvas, KIND_META } from './FlowCanvas';
import { nodeInfo, type FlowLookups } from './flowNodes';
import { NodeProgressSummary, NodeStepList, useNodeProgress } from './nodeProgress';

/** Hasil satu run E2E Flow: kanvas dengan status tiap node (live) + detail node terpilih. */
export function FlowRunDetailPage() {
  const { runId = '' } = useParams();
  const { projectId = '' } = useWorkspace();
  const { data: run, isLoading, error } = useFlowRun(runId);
  const { data: tests = [] } = useUiTests(projectId);
  const { data: scenarios = [] } = useScenarios(projectId);
  const again = useRunFlow(projectId);
  const stop = useStopFlowRun();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<{ node?: string } | null>(null);
  const progress = useNodeProgress(run?.nodes ?? []);
  const lookups: FlowLookups = useMemo(
    () => ({
      tests: new Map(tests.map((t) => [t.id, t])),
      scenarios: new Map(scenarios.map((s) => [s.id, s])),
    }),
    [tests, scenarios],
  );

  if (isLoading) return <Loading />;
  if (error || !run) return <ErrorBox error={error} />;

  const statuses: Record<string, FlowNodeStatus> = Object.fromEntries(
    run.nodes.map((n) => [n.nodeId, n.status]),
  );
  const count = (s: FlowNodeStatus) => run.nodes.filter((n) => n.status === s).length;
  const running = run.status === 'running';
  const result = selected?.node ? run.nodes.find((n) => n.nodeId === selected.node) : undefined;
  const firstFailed = run.nodes.find((n) => n.status === 'failed');
  const runLink = (kind?: 'ui' | 'api', id?: string) =>
    id ? (kind === 'api' ? `/runs/${id}` : `/ui/runs/${id}`) : null;
  const vars = Object.entries(run.variables ?? {});

  return (
    <>
      <div className="row wrap detail-bar">
        <BackLink to="/e2e/runs" label="Flow runs" />
        <div className="grow" />
        <Link className="btn" to={`/e2e/flows/${run.flowId}`}>
          Open flow
        </Link>
        {running ? (
          <StopRunButton
            pending={stop.isPending}
            what="Every test running in the flow (web, Android, API) is stopped too, and the nodes that have not started are skipped."
            onStop={(done) => stop.mutate(run.id, done)}
          />
        ) : (
          <button
            className="btn primary"
            disabled={again.isPending}
            onClick={() =>
              again.mutate({ id: run.flowId }, { onSuccess: (r) => navigate(`/e2e/runs/${r.id}`) })
            }
          >
            <Icon name="play" size={13} /> Run again
          </button>
        )}
      </div>

      <StatGrid className="mb-16" columns={4}>
        <Stat label="Flow" size="sm" value={run.flowName} sub={run.environmentName} />
        <Stat
          label="Result"
          value={
            <StatusBadge status={run.status}>
              {running ? `Running ${count('passed') + count('failed')}/${run.nodes.length}` : undefined}
            </StatusBadge>
          }
          sub={running ? undefined : `took ${formatMs(run.durationMs)}`}
        />
        <Stat
          label="Nodes"
          size="sm"
          value={`${count('passed')} passed`}
          sub={
            [
              count('failed') && `${count('failed')} failed`,
              count('skipped') && `${count('skipped')} skipped`,
            ]
              .filter(Boolean)
              .join(' · ') || 'all passed so far'
          }
        />
        <Stat label="Started" size="sm" value={<DateTime value={run.startedAt} />} />
      </StatGrid>

      {run.status === 'stopped' && (
        <StoppedNote
          by={run.stoppedBy}
          what="The tests that were running were stopped and the remaining nodes were skipped."
        />
      )}

      {run.failureReason && !running && (
        <div className="mb-16">
          <ErrorBox>
            <b>Why it failed:</b> {run.failureReason}
            {firstFailed && (
              <>
                {' '}
                <button className="link-btn" onClick={() => setSelected({ node: firstFailed.nodeId })}>
                  Show the node
                </button>
              </>
            )}
          </ErrorBox>
        </div>
      )}

      <div className="flow-layout run">
        <FlowCanvas
          nodes={run.graph.nodes}
          edges={run.graph.edges}
          editable={false}
          statuses={statuses}
          progress={progress}
          info={(n) => nodeInfo(n, lookups)}
          selected={selected}
          onSelect={(s) => setSelected(s?.node ? { node: s.node } : null)}
          fitKey={run.id}
        />
        <aside className="flow-inspector panel">
          {result ? (
            <div className="panel-b grid">
              <div className="row" style={{ gap: 8 }}>
                <span className={`flow-node-icon k-${result.kind}`}>
                  <Icon name={KIND_META[result.kind].icon} size={15} />
                </span>
                <b className="grow">{result.label}</b>
                <StatusBadge status={result.status === 'pending' ? 'queued' : result.status} />
              </div>
              <div className="small muted">
                {KIND_META[result.kind].label}
                {result.startedAt && (
                  <>
                    {' '}
                    · <DateTime value={result.startedAt} timeOnly /> ·{' '}
                    {result.finishedAt ? formatMs(result.durationMs) : 'running…'}
                  </>
                )}
              </div>
              {progress[result.nodeId] && (
                <div className="grid" style={{ gap: 6 }}>
                  <NodeProgressSummary p={progress[result.nodeId]} />
                  <NodeStepList p={progress[result.nodeId]} />
                </div>
              )}
              {result.error && <ErrorBox>{result.error}</ErrorBox>}
              {!!result.outputs?.length && (
                <div className="small">
                  <b>Passed on to the next nodes:</b>
                  <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                    {result.outputs.map((o) => (
                      <span key={o} className="chip var-out">{`{{${o}}}`}</span>
                    ))}
                  </div>
                </div>
              )}
              {runLink(result.runKind, result.runId) && (
                <Link className="btn sm" to={runLink(result.runKind, result.runId)!}>
                  <Icon name="eye" size={12} /> Open the {result.runKind === 'api' ? 'API run' : 'UI run'}{' '}
                  (steps, screenshots)
                </Link>
              )}
            </div>
          ) : (
            <div className="panel-b grid">
              <h3 style={{ margin: 0 }}>Nodes</h3>
              <ol className="flow-result-list">
                {run.nodes.map((n) => (
                  <li key={n.nodeId}>
                    <button type="button" onClick={() => setSelected({ node: n.nodeId })}>
                      <span
                        className={`ri ${n.status === 'passed' ? 'passed' : n.status === 'failed' ? 'failed' : n.status === 'running' ? 'running' : 'skipped'}`}
                      >
                        <Icon
                          name={
                            n.status === 'passed'
                              ? 'check'
                              : n.status === 'failed'
                                ? 'x'
                                : n.status === 'running'
                                  ? 'spin'
                                  : n.status === 'stopped'
                                    ? 'stop'
                                    : 'minus'
                          }
                          size={11}
                          strokeWidth={3}
                        />
                      </span>
                      <span className="ellipsis grow">{n.label}</span>
                      <span className="small muted">{n.finishedAt ? formatMs(n.durationMs) : n.status}</span>
                    </button>
                    {n.status === 'running' && progress[n.nodeId] && (
                      <div className="flow-result-progress">
                        <NodeProgressSummary p={progress[n.nodeId]} />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {vars.length > 0 && (
                <details>
                  <summary className="small">Variables at the end ({vars.length})</summary>
                  <table className="t small mt-8">
                    <tbody>
                      {vars.map(([k, v]) => (
                        <tr key={k}>
                          <td className="code">{k}</td>
                          <td className="code ellipsis" style={{ maxWidth: 160 }}>
                            {v}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
