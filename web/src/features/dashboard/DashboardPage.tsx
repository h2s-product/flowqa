import { Link, useNavigate } from 'react-router-dom';
import { useDashboard } from '@/api/queries';
import { RunTrendChart } from '@/components/charts/RunTrendChart';
import { FailureRateChart } from '@/components/charts/FailureRateChart';
import { EmptyState, ErrorBox, Loading, Stat, StatGrid, type StatTone, StatusIcon } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatMs } from '@/lib/format';
import { RunTable } from '@/components/runs/RunTable';
import { DateTime } from '@/components/DateTime';
import { PASS_RATE_TARGET, describeSchedule } from '@/lib/labels';

export function DashboardPage() {
  const { project, projectId, loading } = useWorkspace();
  const { data, isLoading, error } = useDashboard(projectId);
  const navigate = useNavigate();
  if (loading || isLoading) return <Loading />;
  if (!projectId)
    return (
      <div className="panel">
        <EmptyState
          title="No project yet"
          action={
            <Link className="btn primary" to="/projects">
              Go to Projects
            </Link>
          }
        >
          Create a project, or ask an administrator to give you access to one.
        </EmptyState>
      </div>
    );
  if (error || !data) return <ErrorBox error={error} />;

  const t = data.totals;
  const failedRuns = t.totalRuns - t.passedRuns;
  const maxTime = Math.max(1, ...data.apiResponseTimes.map((a) => a.averageMs));
  const stats: [string, string | number, StatTone?][] = [
    ['APIs', t.apis],
    ['Test scenarios', t.scenarios],
    ['Test cases', t.testCases],
    ['Runs today', t.runsToday],
    ['Steps passed today', t.stepsPassedToday, 'g'],
    ['Steps failed today', t.stepsFailedToday, 'r'],
    ['Steps skipped today', t.stepsSkippedToday],
    [
      'Pass rate (14 days)',
      `${t.passRate}%`,
      t.totalRuns ? (t.passRate >= PASS_RATE_TARGET ? 'g' : 'r') : undefined,
    ],
    ['Avg run time', t.totalRuns ? formatMs(t.averageDurationMs) : '—'],
  ];

  return (
    <>
      <p className="muted small" style={{ margin: '0 0 12px' }}>
        Showing <b style={{ color: 'var(--ink)' }}>{project?.name}</b> only · switch project in the sidebar to
        see another one.
      </p>
      <StatGrid>
        {stats.map(([label, value, tone]) => (
          <Stat key={label} label={label} tone={tone} value={value} />
        ))}
      </StatGrid>

      <div className="dash-grid">
        <section className="panel c-8">
          <div className="panel-h">
            <h3>Test runs, last 14 days</h3>
            <div className="grow" />
            <div className="legend">
              <span>
                <i style={{ background: 'var(--green)' }} />
                Passed
              </span>
              <span>
                <i style={{ background: 'var(--red)' }} />
                Failed
              </span>
            </div>
          </div>
          <div className="panel-b">
            <RunTrendChart days={data.trend} />
          </div>
        </section>

        <section className="panel c-4">
          <div className="panel-h">
            <h3>Passed vs failed</h3>
          </div>
          <div className="panel-b">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <b style={{ fontSize: 30, letterSpacing: '-.02em' }}>{t.passRate}%</b>
              <span className="muted">of {t.totalRuns} runs passed</span>
            </div>
            <div className="ratio" role="img" aria-label={`${t.passedRuns} passed, ${failedRuns} failed`}>
              <div style={{ width: `${t.totalRuns ? t.passRate : 0}%`, background: 'var(--green)' }} />
              <div style={{ width: `${t.totalRuns ? 100 - t.passRate : 0}%`, background: 'var(--red)' }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span className="small">
                <b className="text-pass">{t.passedRuns}</b> passed
              </span>
              <span className="small">
                <b className="text-fail">{failedRuns}</b> failed
              </span>
            </div>
            <div className="sep" />
            <h4 style={{ margin: '0 0 6px', fontSize: 13 }}>Failure rate trend</h4>
            <FailureRateChart
              values={data.trend.map((d) =>
                d.passed + d.failed ? (d.failed / (d.passed + d.failed)) * 100 : 0,
              )}
            />
          </div>
        </section>

        <section className="panel c-6">
          <div className="panel-h">
            <h3>Recent test runs</h3>
            <div className="grow" />
            <Link className="btn sm ghost" to="/runs">
              View all
            </Link>
          </div>
          <RunTable runs={data.recentRuns} compact />
        </section>

        <section className="panel c-6">
          <div className="panel-h">
            <h3>Recent failures</h3>
          </div>
          {data.recentFailures.length ? (
            <div className="run-list">
              {data.recentFailures.map((r) => (
                <div className="r" key={r.id} onClick={() => navigate(`/runs/${r.id}`)}>
                  <StatusIcon status="failed" />
                  <div>
                    <b>{r.scenarioName}</b>{' '}
                    <span className="muted small">
                      · step “{r.failedStep}” · {r.environmentName}
                    </span>
                    <div className="small" style={{ color: 'var(--ink2)' }}>
                      {r.failureReason}
                    </div>
                  </div>
                  <span className="small">
                    <DateTime value={r.startedAt} relative />
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No failures in the last 14 days" />
          )}
        </section>

        <section className="panel c-6">
          <div className="panel-h">
            <h3>Average API response time</h3>
          </div>
          <div className="panel-b">
            {data.apiResponseTimes.length ? (
              data.apiResponseTimes.map((a) => (
                <div className="hbar" key={a.apiId}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.name}
                  </span>
                  <div className="track">
                    <div
                      style={{
                        width: `${(a.averageMs / maxTime) * 100}%`,
                        background: a.averageMs > 400 ? 'var(--amber)' : 'var(--blue)',
                      }}
                    />
                  </div>
                  <span className="code" style={{ textAlign: 'right' }}>
                    {formatMs(a.averageMs)}
                  </span>
                </div>
              ))
            ) : (
              <div className="muted">Run a scenario to see timings.</div>
            )}
          </div>
        </section>

        <section className="panel c-6">
          <div className="panel-h">
            <h3>Scheduled tests</h3>
            <div className="grow" />
            <Link className="btn sm ghost" to="/schedules">
              Manage
            </Link>
          </div>
          <div className="panel-b" style={{ paddingTop: 6 }}>
            {data.upcomingSchedules.length ? (
              data.upcomingSchedules.map((s) => (
                <div className="health" key={s.id}>
                  <span className="dot" style={{ background: 'var(--blue)' }} />
                  <span className="grow">
                    <b>{s.scenarioName}</b> <span className="muted">on {s.environmentName}</span>
                  </span>
                  <span className="small muted">
                    {describeSchedule(s)} · next <DateTime value={s.nextRunAt} relative />
                  </span>
                </div>
              ))
            ) : (
              <div className="muted">No active schedules.</div>
            )}
            <h4 style={{ margin: '18px 0 4px', fontSize: 13 }}>System health</h4>
            {[
              ['API server', 'Operational'],
              ['Test runner', 'Ready'],
              ['Scheduler', 'Checking for due schedules'],
              ['Secrets', 'Masked in all run logs'],
            ].map(([a, b]) => (
              <div className="health" key={a}>
                <span className="dot" style={{ background: 'var(--green)' }} />
                <span className="grow">{a}</span>
                <span className="small muted">{b}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
