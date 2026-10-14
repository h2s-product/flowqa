import type { PerfRun } from '@flowqa/shared';
import { createId, totalStageSeconds } from '@flowqa/shared';
import type { HttpClient } from '../engine/http-client';
import { LoadRunner, evaluateThresholds, type LoadSnapshot } from '../engine/load-runner';
import { ScenarioRunner } from '../engine/scenario-runner';
import { HttpError, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { NotificationService } from './notification-service';
import { log } from '../lib/log';
import { assertProjectEnvironment } from '../domain/guards';
import { config } from '../config';

/**
 * Mengelola siklus hidup performance run: membuat record, menjalankan LoadRunner
 * di background, menyimpan progres tiap detik, dan menilai threshold di akhir.
 * Hanya satu performance run yang boleh berjalan sekaligus supaya server Testora
 * sendiri tidak menjadi bottleneck (dan hasil pengukuran tetap akurat).
 */
export class PerfService {
  private readonly loadRunner: LoadRunner;
  private readonly active = new Map<string, { controller: AbortController; job: Promise<PerfRun> }>();

  constructor(
    private readonly repos: Repositories,
    http: HttpClient,
    private readonly notifier?: NotificationService,
  ) {
    const findApi = (id: string) => repos.apis.get(id);
    this.loadRunner = new LoadRunner({ runner: new ScenarioRunner({ http, findApi }), findApi });
  }

  start(testId: string, environmentId: string): PerfRun {
    const test = this.repos.perfTests.get(testId);
    if (!test) throw notFound('Performance test');
    const scenario = this.repos.scenarios.get(test.scenarioId);
    if (!scenario) throw new HttpError(400, 'The scenario used by this test no longer exists');
    const environment = assertProjectEnvironment(this.repos, test.projectId, environmentId);
    if (!scenario.steps.some((s) => s.type === 'api' && !s.disabled))
      throw new HttpError(400, 'The scenario has no API steps to load test');
    if (this.active.size)
      throw new HttpError(409, 'Another performance test is already running. Stop it or wait until it ends.');

    const now = nowIso();
    const run: PerfRun = {
      id: createId('prf'),
      projectId: test.projectId,
      testId: test.id,
      testName: test.name,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      environmentId: environment.id,
      environmentName: environment.name,
      type: test.type,
      stages: test.stages,
      thinkTimeMs: test.thinkTimeMs,
      thresholds: test.thresholds,
      status: 'running',
      startedAt: now,
      finishedAt: null,
      durationMs: 0,
      plannedDurationSec: totalStageSeconds(test.stages),
      peakVus: 0,
      iterations: 0,
      failedIterations: 0,
      totals: {
        requests: 0,
        errors: 0,
        rps: 0,
        errorRatePct: 0,
        latency: { count: 0, min: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
      },
      timeline: [],
      steps: [],
      statusCodes: {},
      topErrors: [],
      thresholdResults: [],
      createdAt: now,
      updatedAt: now,
    };
    this.persist(run);

    const controller = new AbortController();
    const job = this.loadRunner
      .execute(scenario, environment, {
        stages: test.stages,
        thinkTimeMs: test.thinkTimeMs,
        signal: controller.signal,
        onTick: (snapshot) => {
          this.apply(run, snapshot);
          this.persist(run);
        },
      })
      .then((result) => {
        this.apply(run, result);
        run.thresholdResults = evaluateThresholds(run.thresholds, run.totals);
        const failed = run.thresholdResults.filter((r) => !r.passed);
        run.status = result.aborted ? 'stopped' : failed.length ? 'failed' : 'passed';
        run.failureReason = result.aborted
          ? 'Stopped before the planned end.'
          : failed.length
            ? failed.map((r) => `${r.label} (${r.actual})`).join('; ')
            : undefined;
        return run;
      })
      .catch((error) => {
        log.error('performance test crashed', error);
        run.status = 'failed';
        run.failureReason = 'The load runner crashed. See the server log.';
        return run;
      })
      .then((finished) => {
        finished.finishedAt = nowIso();
        finished.durationMs =
          new Date(finished.finishedAt).getTime() - new Date(finished.startedAt).getTime();
        this.persist(finished);
        this.repos.perfRuns.prune(config.limits.storedPerfRuns);
        this.notifier?.perfRun(finished);
        return finished;
      })
      .finally(() => this.active.delete(run.id));
    this.active.set(run.id, { controller, job });
    return run;
  }

  /** Hentikan run lebih awal. Metrik yang sudah terkumpul tetap disimpan. */
  stop(runId: string): PerfRun {
    const run = this.repos.perfRuns.get(runId);
    if (!run) throw notFound('Performance run');
    this.active.get(runId)?.controller.abort();
    return run;
  }

  /** Tunggu sampai run selesai (dipakai test). */
  wait(runId: string): Promise<PerfRun> | undefined {
    return this.active.get(runId)?.job;
  }

  /** Hentikan semua run saat server dimatikan. */
  stopAll(): void {
    this.active.forEach(({ controller }) => controller.abort());
  }

  private apply(run: PerfRun, s: LoadSnapshot): void {
    const seconds = Math.max(s.elapsedMs / 1000, 1);
    run.peakVus = s.peakVus;
    run.iterations = s.iterations;
    run.failedIterations = s.failedIterations;
    run.totals = {
      requests: s.requests,
      errors: s.errors,
      rps: Math.round((s.requests / seconds) * 10) / 10,
      errorRatePct: s.requests ? Math.round((s.errors / s.requests) * 1000) / 10 : 0,
      latency: s.latency,
    };
    run.timeline = s.timeline;
    run.steps = s.steps;
    run.statusCodes = s.statusCodes;
    run.topErrors = s.topErrors;
    run.durationMs = Math.round(s.elapsedMs);
  }

  private persist(run: PerfRun): void {
    run.updatedAt = nowIso();
    this.repos.perfRuns.save(run);
  }
}
