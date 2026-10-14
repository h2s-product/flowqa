import { Link, useParams } from 'react-router-dom';
import type { PerfRun } from '@flowqa/shared';
import { usePerfRun, useStartPerfRunAndOpen, useStopPerfRun } from '@/api/queries';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { Icon } from '@/components/Icon';
import {
  BackLink,
  ErrorBox,
  Loading,
  MethodBadge,
  Stat,
  StatGrid,
  type StatTone,
  StatusBadge,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { presetLabel } from './presets';
import { DateTime } from '@/components/DateTime';
import { formatDuration, formatNumber } from '@/lib/format';

export function PerfRunDetailPage() {
  const { runId = '' } = useParams();
  const { data: run, isLoading, error } = usePerfRun(runId);
  const stop = useStopPerfRun();
  const start = useStartPerfRunAndOpen(run?.projectId ?? '');
  const toast = useToast();

  if (isLoading) return <Loading />;
  if (error || !run) return <ErrorBox error={error} />;

  const running = run.status === 'running';
  const elapsedSec = run.durationMs / 1000;
  const progress = Math.min(100, (elapsedSec / Math.max(run.plannedDurationSec, 1)) * 100);
  const t = run.totals;

  const rerun = () => start.run({ testId: run.testId, environmentId: run.environmentId });

  const stats: [string, string, StatTone?][] = [
    ['Peak virtual users', formatNumber(run.peakVus)],
    ['Requests', formatNumber(t.requests)],
    ['Throughput', `${formatNumber(t.rps)} req/s`],
    ['Average', `${formatNumber(t.latency.avg)} ms`],
    ['p95', `${formatNumber(t.latency.p95)} ms`],
    ['p99', `${formatNumber(t.latency.p99)} ms`],
    ['Error rate', `${t.errorRatePct}%`, t.requests ? (t.errors ? 'r' : 'g') : undefined],
    [
      'Iterations',
      `${formatNumber(run.iterations)}${run.failedIterations ? ` (${formatNumber(run.failedIterations)} failed)` : ''}`,
    ],
  ];

  return (
    <>
      <div className="row wrap detail-bar">
        <BackLink to="/performance" label="Performance" />
        <div className="grow" />
        <Link className="btn" to={`/scenarios/${run.scenarioId}`}>
          Open scenario
        </Link>
        {running ? (
          <button
            className="btn danger"
            onClick={() =>
              stop.mutate(run.id, { onSuccess: () => toast('Stopping… collected results are kept') })
            }
            disabled={stop.isPending}
          >
            <Icon name="stop" size={13} /> Stop test
          </button>
        ) : (
          <button className="btn primary" onClick={rerun} disabled={start.isPending}>
            <Icon name="play" size={13} /> Run again
          </button>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-b">
          <div className="row wrap" style={{ gap: 10 }}>
            <b style={{ fontSize: 17 }}>{run.testName}</b>
            <StatusBadge status={run.status} />
            <span className="small muted">
              {presetLabel(run.type)} · {run.scenarioName} · {run.environmentName} · started{' '}
              <DateTime value={run.startedAt} />
              {run.finishedAt && (
                <>
                  {' '}
                  · finished <DateTime value={run.finishedAt} />
                </>
              )}
            </span>
            <div className="grow" />
            <span className="small muted">
              {formatDuration(elapsedSec)} of {formatDuration(run.plannedDurationSec)}
            </span>
          </div>
          {running && (
            <div className="ratio" style={{ marginTop: 10, height: 8 }}>
              <div
                style={{ width: `${progress}%`, background: 'var(--blue)', transition: 'width .8s linear' }}
              />
            </div>
          )}
          {run.failureReason && !running && (
            <div
              className="small"
              style={{ marginTop: 8, color: run.status === 'failed' ? 'var(--red)' : 'var(--amber)' }}
            >
              {run.failureReason}
            </div>
          )}
        </div>
      </div>

      <StatGrid>
        {stats.map(([label, value, tone]) => (
          <Stat key={label} label={label} tone={tone} value={value} />
        ))}
      </StatGrid>

      <Charts run={run} />

      <div className="dash-grid">
        <section className="panel c-8">
          <div className="panel-h">
            <h3>Response time per step</h3>
          </div>
          <div className="tbl-wrap">
            <StepTable run={run} />
          </div>
        </section>
        <section className="panel c-4">
          <div className="panel-h">
            <h3>Pass criteria</h3>
          </div>
          <div className="panel-b">
            {run.thresholdResults.length ? (
              run.thresholdResults.map((r) => (
                <div className="threshold" key={r.label}>
                  <StatusBadge status={r.passed ? 'passed' : 'failed'} />
                  <div className="grow">{r.label}</div>
                  <span className="small muted num">{r.actual}</span>
                </div>
              ))
            ) : (
              <div className="small muted">
                {running
                  ? 'Checked when the test ends.'
                  : run.status === 'stopped'
                    ? 'Not checked because the test was stopped early.'
                    : 'No pass criteria set for this test.'}
              </div>
            )}
          </div>
        </section>
        <section className="panel c-6">
          <div className="panel-h">
            <h3>Status codes</h3>
          </div>
          <div className="panel-b">
            <StatusCodes run={run} />
          </div>
        </section>
        <section className="panel c-6">
          <div className="panel-h">
            <h3>Most common errors</h3>
          </div>
          <div className="panel-b">
            {run.topErrors.length ? (
              run.topErrors.map((e) => (
                <div className="threshold" key={e.message}>
                  <div className="grow">{e.message}</div>
                  <b className="num">{formatNumber(e.count)}×</b>
                </div>
              ))
            ) : (
              <div className="small muted">No errors{running ? ' so far' : ''}.</div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Charts({ run }: { run: PerfRun }) {
  const times = run.timeline.map((p) => p.t);
  if (!times.length)
    return (
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-b small muted">Charts appear after the first second of the test…</div>
      </div>
    );
  return (
    <div className="dash-grid">
      <section className="panel c-4">
        <div className="panel-h">
          <h3>Virtual users</h3>
        </div>
        <div className="panel-b">
          <TimeSeriesChart
            label="Active virtual users per second"
            times={times}
            series={[
              {
                label: 'Users',
                color: 'var(--violet)',
                fill: 'var(--violet-soft)',
                values: run.timeline.map((p) => p.vus),
              },
            ]}
          />
        </div>
      </section>
      <section className="panel c-4">
        <div className="panel-h">
          <h3>Throughput</h3>
        </div>
        <div className="panel-b">
          <TimeSeriesChart
            label="Requests and errors per second"
            times={times}
            unit="/s"
            series={[
              {
                label: 'Requests',
                color: 'var(--blue)',
                bars: true,
                values: run.timeline.map((p) => p.requests),
              },
              { label: 'Errors', color: 'var(--red)', bars: true, values: run.timeline.map((p) => p.errors) },
            ]}
          />
        </div>
      </section>
      <section className="panel c-4">
        <div className="panel-h">
          <h3>Response time</h3>
        </div>
        <div className="panel-b">
          <TimeSeriesChart
            label="Average and p95 response time per second"
            times={times}
            unit=" ms"
            series={[
              { label: 'p95', color: 'var(--amber)', values: run.timeline.map((p) => p.p95Ms) },
              { label: 'Average', color: 'var(--green)', values: run.timeline.map((p) => p.avgMs) },
            ]}
          />
        </div>
      </section>
    </div>
  );
}

function StepTable({ run }: { run: PerfRun }) {
  if (!run.steps.length) return <div className="panel-b small muted">No requests yet.</div>;
  return (
    <table className="t">
      <thead>
        <tr>
          <th>Step</th>
          <th className="num">Requests</th>
          <th className="num">Errors</th>
          <th className="num">Min</th>
          <th className="num">Avg</th>
          <th className="num">p90</th>
          <th className="num">p95</th>
          <th className="num">p99</th>
          <th className="num">Max</th>
        </tr>
      </thead>
      <tbody>
        {run.steps.map((s) => (
          <tr key={s.stepId}>
            <td>
              <b>{s.name}</b>
              {s.method && (
                <div className="row small" style={{ gap: 6, marginTop: 2 }}>
                  <MethodBadge method={s.method} />
                  <span className="code muted">{s.path}</span>
                </div>
              )}
            </td>
            <td className="num">{formatNumber(s.latency.count || s.errors)}</td>
            <td className="num" style={s.errors ? { color: 'var(--red)' } : undefined}>
              {formatNumber(s.errors)}
            </td>
            <td className="num">{formatNumber(s.latency.min)}</td>
            <td className="num">{formatNumber(s.latency.avg)}</td>
            <td className="num">{formatNumber(s.latency.p90)}</td>
            <td className="num">
              <b>{formatNumber(s.latency.p95)}</b>
            </td>
            <td className="num">{formatNumber(s.latency.p99)}</td>
            <td className="num">{formatNumber(s.latency.max)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="small muted" colSpan={9}>
            All times in milliseconds.
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function StatusCodes({ run }: { run: PerfRun }) {
  const entries = Object.entries(run.statusCodes).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (!total) return <div className="small muted">No responses yet.</div>;
  const color = (code: string) =>
    /^2/.test(code)
      ? 'var(--green)'
      : /^3/.test(code)
        ? 'var(--blue)'
        : /^4/.test(code)
          ? 'var(--amber)'
          : 'var(--red)';
  return (
    <>
      <div className="ratio" style={{ marginBottom: 12 }}>
        {entries.map(([code, n]) => (
          <div
            key={code}
            title={`${code}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, background: color(code) }}
          />
        ))}
      </div>
      {entries.map(([code, n]) => (
        <div className="threshold" key={code}>
          <span className="legend">
            <span>
              <i style={{ background: color(code) }} />
              <b className="code">{code}</b>
            </span>
          </span>
          <div className="grow" />
          <span className="num">
            {formatNumber(n)} <span className="muted small">({Math.round((n / total) * 1000) / 10}%)</span>
          </span>
        </div>
      ))}
    </>
  );
}
