import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PerfTest } from '@flowqa/shared';
import { peakVus, totalStageSeconds } from '@flowqa/shared';
import {
  useDeletePerfTest,
  usePerfRuns,
  usePerfTests,
  useScenarios,
  useStartPerfRunAndOpen,
  type PerfRunSummary,
} from '@/api/queries';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, IconButton, Loading, StatusBadge } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { PerfTestFormModal } from './PerfTestFormModal';
import { presetLabel } from './presets';
import { DateTime } from '@/components/DateTime';
import { formatDuration, formatNumber, isProdEnv } from '@/lib/format';
import { useConfirm } from '@/context/ConfirmContext';

export function PerformancePage() {
  const { projectId = '', environment } = useWorkspace();
  const { data: tests = [], isLoading, error } = usePerfTests(projectId);
  const { data: runs = [] } = usePerfRuns(projectId, { limit: 25 });
  const { data: scenarios = [] } = useScenarios(projectId);
  const start = useStartPerfRunAndOpen(projectId);
  const confirm = useConfirm();
  const remove = useDeletePerfTest(projectId);
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<PerfTest | 'new' | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const running = runs.find((r) => r.status === 'running');
  const isProd = isProdEnv(environment?.name);

  const run = async (test: PerfTest) => {
    if (!environment) return toast('Add an environment first');
    const peak = peakVus(test.stages);
    const warning = isProd ? '\n\nThis is a PRODUCTION environment. Real users may be affected.' : '';
    if (
      !(await confirm({
        title: 'Start this load test?',
        message: `Up to ${peak} virtual users will call "${environment.name}" (${environment.baseUrl}) for ${formatDuration(totalStageSeconds(test.stages))}.${warning}`,
        confirmLabel: 'Start load test',
        tone: isProd ? 'danger' : 'normal',
      }))
    )
      return;
    start.run({ testId: test.id, environmentId: environment.id });
  };

  return (
    <>
      <div className="row wrap toolbar">
        <p className="muted" style={{ margin: 0 }}>
          Measure how your API behaves when many users hit it at once: response times, throughput and errors.
        </p>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!scenarios.length}>
          <Icon name="plus" size={14} /> New performance test
        </button>
      </div>

      <div className={`banner ${isProd ? 'warn' : ''}`} style={{ marginBottom: 16 }}>
        <Icon name="gauge" size={16} />
        <div>
          Tests run against the environment selected at the top right
          {environment ? (
            <>
              {' '}
              — <b>{environment.name}</b> <span className="code small">{environment.baseUrl}</span>
            </>
          ) : null}
          . Only load test systems you own or are allowed to test.
          {running && (
            <>
              {' '}
              <Link to={`/performance/runs/${running.id}`}>A test is running now →</Link>
            </>
          )}
        </div>
      </div>

      {tests.length ? (
        <div className="panel tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Test</th>
                <th>Scenario</th>
                <th>Profile</th>
                <th>Last result</th>
                <th className="num">p95</th>
                <th className="num">Req/s</th>
                <th className="num">Errors</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => {
                const last = t.lastRun;
                return (
                  <tr key={t.id}>
                    <td>
                      <b>{t.name}</b>
                      <div className="small muted">
                        {presetLabel(t.type)} · updated <DateTime value={t.updatedAt} />
                      </div>
                    </td>
                    <td>
                      {scenarios.find((s) => s.id === t.scenarioId)?.name ?? (
                        <span className="muted">Deleted scenario</span>
                      )}
                    </td>
                    <td className="small">
                      {formatDuration(totalStageSeconds(t.stages))} · up to {peakVus(t.stages)} users
                    </td>
                    <td className="small">
                      {last ? (
                        <Link to={`/performance/runs/${last.id}`}>
                          <StatusBadge status={last.status} /> <DateTime value={last.startedAt} />
                        </Link>
                      ) : (
                        <span className="muted">Never run</span>
                      )}
                    </td>
                    <td className="num">{last ? `${formatNumber(last.totals.latency.p95)} ms` : '-'}</td>
                    <td className="num">{last ? formatNumber(last.totals.rps) : '-'}</td>
                    <td className="num">{last ? `${last.totals.errorRatePct}%` : '-'}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button
                        className="btn sm primary"
                        onClick={() => run(t)}
                        disabled={!!running || start.isPending}
                        title={running ? 'Another performance test is running' : undefined}
                      >
                        <Icon name="play" size={12} /> Run
                      </button>
                      <button className="btn sm ghost" onClick={() => setEditing(t)}>
                        Edit
                      </button>
                      <IconButton
                        icon="trash"
                        label="Delete"
                        onClick={async () =>
                          (await confirm({
                            title: `Delete “${t.name}”?`,
                            message: 'The performance test is deleted. Its past results are kept.',
                          })) && remove.mutate(t.id)
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <EmptyState
            title="No performance tests yet"
            action={
              scenarios.length ? (
                <button className="btn primary" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={14} /> New performance test
                </button>
              ) : undefined
            }
          >
            {scenarios.length
              ? 'Pick a scenario, choose load, stress, spike or soak, and see how the API holds up.'
              : 'Create a test scenario first — performance tests reuse its steps.'}
          </EmptyState>
        </div>
      )}

      {runs.length > 0 && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h">
            <h3>Recent performance runs</h3>
          </div>
          <div className="tbl-wrap">
            <PerfRunTable runs={runs} onOpen={(id) => navigate(`/performance/runs/${id}`)} />
          </div>
        </section>
      )}

      {editing && (
        <PerfTestFormModal test={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function PerfRunTable({ runs, onOpen }: { runs: PerfRunSummary[]; onOpen: (id: string) => void }) {
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Started</th>
          <th>Finished</th>
          <th>Test</th>
          <th>Environment</th>
          <th>Result</th>
          <th className="num">Peak users</th>
          <th className="num">Requests</th>
          <th className="num">Avg</th>
          <th className="num">p95</th>
          <th className="num">Req/s</th>
          <th className="num">Errors</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="click" onClick={() => onOpen(r.id)}>
            <td className="small">
              <DateTime value={r.startedAt} />
            </td>
            <td className="small">
              {r.status === 'running' ? (
                <span className="muted">running…</span>
              ) : (
                <DateTime value={r.finishedAt} />
              )}
            </td>
            <td>
              <b>{r.testName}</b>
              <div className="small muted">{presetLabel(r.type)}</div>
            </td>
            <td>{r.environmentName}</td>
            <td>
              <StatusBadge status={r.status} />
            </td>
            <td className="num">{formatNumber(r.peakVus)}</td>
            <td className="num">{formatNumber(r.totals.requests)}</td>
            <td className="num">{formatNumber(r.totals.latency.avg)} ms</td>
            <td className="num">{formatNumber(r.totals.latency.p95)} ms</td>
            <td className="num">{formatNumber(r.totals.rps)}</td>
            <td className="num">{r.totals.errorRatePct}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
