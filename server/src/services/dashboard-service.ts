import type { DashboardData, Run } from '@flowqa/shared';
import type { Repositories } from '../repositories';
import { averageDuration, percent } from '../domain/run-stats';

const DAYS = 14;

/** Ringkasan dashboard untuk satu project: 14 hari terakhir + jadwal berikutnya. */
export function buildDashboard(repos: Repositories, projectId: string): DashboardData {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const since = new Date(startOfToday);
  since.setDate(since.getDate() - (DAYS - 1));

  const runs = repos.runs.between(projectId, since.toISOString(), new Date().toISOString());
  const today = runs.filter((r) => new Date(r.startedAt) >= startOfToday);
  const passedRuns = runs.filter((r) => r.status === 'passed').length;
  const scenarios = repos.scenarios.list({ project_id: projectId });

  const trend = Array.from({ length: DAYS }, (_, i) => {
    const day = new Date(since);
    day.setDate(since.getDate() + i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const dayRuns = runs.filter((r) => new Date(r.startedAt) >= day && new Date(r.startedAt) < next);
    return {
      date: day.toISOString(),
      passed: dayRuns.filter((r) => r.status === 'passed').length,
      failed: dayRuns.filter((r) => r.status === 'failed').length,
    };
  });

  const timings = new Map<string, number[]>();
  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  for (const run of runs) {
    const scenario = scenarioById.get(run.scenarioId);
    run.steps.forEach((result, i) => {
      const step = scenario?.steps[i];
      if (step?.type === 'api' && result.response) {
        timings.set(step.apiId, [...(timings.get(step.apiId) ?? []), result.response.durationMs]);
      }
    });
  }
  const apiResponseTimes = [...timings.entries()]
    .map(([apiId, values]) => ({
      apiId,
      name: repos.apis.get(apiId)?.name ?? 'Deleted API',
      averageMs: values.reduce((a, b) => a + b, 0) / values.length,
    }))
    .sort((a, b) => b.averageMs - a.averageMs)
    .slice(0, 8);

  const envNames = new Map(repos.environments.list({ project_id: projectId }).map((e) => [e.id, e.name]));
  const upcomingSchedules = repos.schedules
    .list({ project_id: projectId })
    .filter((s) => s.enabled && s.nextRunAt)
    .sort((a, b) => (a.nextRunAt! < b.nextRunAt! ? -1 : 1))
    .slice(0, 5)
    .map((s) => ({
      ...s,
      scenarioName: scenarioById.get(s.scenarioId)?.name ?? 'Deleted scenario',
      environmentName: envNames.get(s.environmentId) ?? '—',
    }));

  const sum = (list: Run[], key: 'passed' | 'failed' | 'skipped') =>
    list.reduce((acc, r) => acc + r.counts[key], 0);
  const strip = (r: Run): Run => ({ ...r, steps: [] }); // ringkasan saja, tanpa detail request/response

  return {
    totals: {
      apis: repos.apis.count({ project_id: projectId }),
      scenarios: scenarios.length,
      testCases: scenarios.reduce(
        (acc, s) => acc + s.steps.reduce((n, st) => n + (st.type === 'api' ? st.assertions.length : 0), 0),
        0,
      ),
      runsToday: today.length,
      stepsPassedToday: sum(today, 'passed'),
      stepsFailedToday: sum(today, 'failed'),
      stepsSkippedToday: sum(today, 'skipped'),
      passRate: percent(passedRuns, runs.length),
      averageDurationMs: averageDuration(runs),
      totalRuns: runs.length,
      passedRuns,
    },
    trend,
    apiResponseTimes,
    recentRuns: runs.slice(0, 6).map(strip),
    recentFailures: runs
      .filter((r) => r.status === 'failed')
      .slice(0, 5)
      .map(strip),
    upcomingSchedules,
  };
}
