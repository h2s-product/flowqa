/**
 * LoadRunner menjalankan satu scenario oleh banyak virtual user (VU) secara
 * bersamaan mengikuti profil beban bertahap (stages). Setiap VU mengulang
 * scenario dari awal sampai waktu habis — iterasi dieksekusi oleh ScenarioRunner
 * yang sama dengan run biasa, sehingga capture/assertion tetap berlaku.
 *
 * Kelas ini TIDAK tahu soal database; progres dilaporkan per detik lewat `onTick`.
 */
import type {
  ApiDefinition,
  Environment,
  HttpMethod,
  LatencyStats,
  PerfStage,
  PerfStepStats,
  PerfThresholdResult,
  PerfThresholds,
  PerfTimelinePoint,
  Run,
  Scenario,
  StepResult,
} from '@flowqa/shared';
import { targetVusAt, totalStageSeconds } from '@flowqa/shared';
import type { ScenarioRunner } from './scenario-runner';
import { log } from '../lib/log';

const CONTROL_INTERVAL_MS = 200;
/** Waktu tunggu iterasi yang masih berjalan setelah durasi test habis. */
const GRACEFUL_STOP_MS = 30_000;
const TOTAL_SAMPLES = 20_000;
const STEP_SAMPLES = 5_000;
const TOP_ERRORS = 10;

/* ------------------------------------------------------------------ */
/* Metrik                                                              */
/* ------------------------------------------------------------------ */

const EMPTY_STATS: LatencyStats = { count: 0, min: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/**
 * Mencatat latency dengan count/sum/min/max yang eksak dan reservoir sample
 * berukuran tetap untuk percentile, supaya memori tidak tumbuh selama test panjang.
 */
export class LatencyRecorder {
  private count = 0;
  private sum = 0;
  private min = Infinity;
  private max = 0;
  private readonly samples: number[] = [];

  constructor(private readonly capacity: number) {}

  add(ms: number): void {
    this.count++;
    this.sum += ms;
    if (ms < this.min) this.min = ms;
    if (ms > this.max) this.max = ms;
    if (this.samples.length < this.capacity) this.samples.push(ms);
    else {
      const slot = Math.floor(Math.random() * this.count);
      if (slot < this.capacity) this.samples[slot] = ms;
    }
  }

  stats(): LatencyStats {
    if (!this.count) return { ...EMPTY_STATS };
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      count: this.count,
      min: Math.round(this.min),
      avg: Math.round(this.sum / this.count),
      p50: Math.round(percentile(sorted, 50)),
      p90: Math.round(percentile(sorted, 90)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(this.max),
    };
  }
}

interface StepMeta {
  name: string;
  method: HttpMethod | '';
  path: string;
}

export interface LoadSnapshot {
  elapsedMs: number;
  vus: number;
  peakVus: number;
  iterations: number;
  failedIterations: number;
  requests: number;
  errors: number;
  latency: LatencyStats;
  timeline: PerfTimelinePoint[];
  steps: PerfStepStats[];
  statusCodes: Record<string, number>;
  topErrors: { message: string; count: number }[];
}

export class MetricsCollector {
  private readonly total = new LatencyRecorder(TOTAL_SAMPLES);
  private readonly steps = new Map<string, { meta: StepMeta; errors: number; recorder: LatencyRecorder }>();
  private readonly statusCodes: Record<string, number> = {};
  private readonly errorMessages = new Map<string, number>();
  private readonly timeline: PerfTimelinePoint[] = [];
  private requests = 0;
  private errors = 0;
  iterations = 0;
  failedIterations = 0;
  /** Setelah ditutup, hasil iterasi yang terlambat selesai diabaikan. */
  closed = false;

  private second: number[] = [];
  private secondRequests = 0;
  private secondErrors = 0;

  constructor(private readonly stepMeta: Map<string, StepMeta>) {}

  recordIteration(results: StepResult[]): void {
    if (this.closed) return;
    this.iterations++;
    let failed = false;
    for (const result of results) {
      if (result.status === 'failed') failed = true;
      if (result.type !== 'api' || (result.status !== 'passed' && result.status !== 'failed')) continue;

      const isError = result.status === 'failed';
      const code = result.response
        ? String(result.response.status)
        : result.request
          ? 'network error'
          : 'not sent';
      this.requests++;
      this.secondRequests++;
      this.statusCodes[code] = (this.statusCodes[code] ?? 0) + 1;

      let step = this.steps.get(result.stepId);
      if (!step) {
        step = {
          meta: this.stepMeta.get(result.stepId) ?? { name: result.name, method: '', path: '' },
          errors: 0,
          recorder: new LatencyRecorder(STEP_SAMPLES),
        };
        this.steps.set(result.stepId, step);
      }
      if (result.request) {
        const ms = result.durationMs ?? 0;
        this.total.add(ms);
        step.recorder.add(ms);
        this.second.push(ms);
      }
      if (isError) {
        this.errors++;
        this.secondErrors++;
        step.errors++;
        const message = `${step.meta.name}: ${result.explanation?.title ?? 'Request failed'}`;
        this.errorMessages.set(message, (this.errorMessages.get(message) ?? 0) + 1);
      }
    }
    if (failed) this.failedIterations++;
  }

  /** Tutup bucket satu detik menjadi satu titik timeline. */
  closeSecond(t: number, vus: number): void {
    const sorted = this.second.sort((a, b) => a - b);
    this.timeline.push({
      t,
      vus,
      requests: this.secondRequests,
      errors: this.secondErrors,
      avgMs: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
      p95Ms: Math.round(percentile(sorted, 95)),
    });
    this.second = [];
    this.secondRequests = 0;
    this.secondErrors = 0;
  }

  snapshot(elapsedMs: number, vus: number, peakVus: number): LoadSnapshot {
    return {
      elapsedMs,
      vus,
      peakVus,
      iterations: this.iterations,
      failedIterations: this.failedIterations,
      requests: this.requests,
      errors: this.errors,
      latency: this.total.stats(),
      timeline: [...this.timeline],
      steps: [...this.steps.entries()].map(([stepId, s]) => ({
        stepId,
        ...s.meta,
        errors: s.errors,
        latency: s.recorder.stats(),
      })),
      statusCodes: { ...this.statusCodes },
      topErrors: [...this.errorMessages.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_ERRORS)
        .map(([message, count]) => ({ message, count })),
    };
  }
}

export function evaluateThresholds(
  thresholds: PerfThresholds,
  totals: { requests: number; errorRatePct: number; latency: LatencyStats },
): PerfThresholdResult[] {
  const results: PerfThresholdResult[] = [];
  if (!totals.requests) {
    results.push({ label: 'At least one request was sent', passed: false, actual: '0 requests' });
    return results;
  }
  if (thresholds.p95Ms != null)
    results.push({
      label: `95% of requests faster than ${thresholds.p95Ms} ms`,
      passed: totals.latency.p95 <= thresholds.p95Ms,
      actual: `p95 ${totals.latency.p95} ms`,
    });
  if (thresholds.errorRatePct != null)
    results.push({
      label: `Error rate at most ${thresholds.errorRatePct}%`,
      passed: totals.errorRatePct <= thresholds.errorRatePct,
      actual: `${totals.errorRatePct}% errors`,
    });
  return results;
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface LoadTestOptions {
  stages: PerfStage[];
  thinkTimeMs: number;
  signal?: AbortSignal;
  onTick?: (snapshot: LoadSnapshot) => void;
}

export interface LoadRunnerDependencies {
  runner: ScenarioRunner;
  findApi: (id: string) => ApiDefinition | undefined;
  now?: () => number;
}

export class LoadRunner {
  private readonly now: () => number;

  constructor(private readonly deps: LoadRunnerDependencies) {
    this.now = deps.now ?? (() => performance.now());
  }

  async execute(
    scenario: Scenario,
    environment: Environment,
    options: LoadTestOptions,
  ): Promise<LoadSnapshot & { aborted: boolean }> {
    // Retry dimatikan: pada uji beban, kegagalan harus terlihat, bukan disembunyikan.
    const perfScenario: Scenario = {
      ...scenario,
      steps: scenario.steps.map((s) => (s.type === 'api' ? { ...s, retries: 0 } : s)),
    };
    const stepMeta = new Map<string, StepMeta>(
      perfScenario.steps.map((s) => {
        const api = s.type === 'api' ? this.deps.findApi(s.apiId) : undefined;
        return [s.id, { name: s.name, method: api?.method ?? '', path: api?.path ?? '' }];
      }),
    );
    const metrics = new MetricsCollector(stepMeta);
    const totalMs = totalStageSeconds(options.stages) * 1000;
    const started = this.now();

    let target = 0;
    let active = 0;
    let peak = 0;
    let stopped = false;
    let aborted = false;
    let resolveStop!: () => void;
    const stopSignal = new Promise<void>((resolve) => (resolveStop = resolve));
    const stop = () => {
      if (stopped) return;
      stopped = true;
      resolveStop();
    };
    const inflight = new Set<Promise<void>>();

    const iterate = async () => {
      const run = {
        steps: perfScenario.steps.map((s, index) => ({
          index,
          stepId: s.id,
          name: s.name,
          type: s.type,
          status: 'queued',
        })),
      } as unknown as Run;
      try {
        await this.deps.runner.execute(perfScenario, environment, run, {}, () => {});
      } finally {
        metrics.recordIteration(run.steps);
      }
    };

    const vuLoop = async () => {
      while (!stopped && active <= target) {
        await iterate().catch((error) => log.error('load iteration crashed', error));
        if (options.thinkTimeMs > 0 && !stopped) await sleep(options.thinkTimeMs, stopSignal);
      }
      active--;
    };

    const spawn = () => {
      active++;
      peak = Math.max(peak, active);
      const job: Promise<void> = vuLoop().finally(() => inflight.delete(job));
      inflight.add(job);
    };

    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (options.signal?.aborted) onAbort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let closedSeconds = 0;
    await new Promise<void>((resolve) => {
      const control = () => {
        const elapsed = this.now() - started;
        while (closedSeconds < Math.floor(elapsed / 1000) && closedSeconds * 1000 < totalMs) {
          metrics.closeSecond(closedSeconds, active);
          closedSeconds++;
          options.onTick?.(metrics.snapshot(elapsed, active, peak));
        }
        if (stopped || elapsed >= totalMs) {
          stop();
          clearInterval(timer);
          resolve();
          return;
        }
        target = targetVusAt(options.stages, elapsed / 1000);
        while (active < target) spawn();
      };
      const timer = setInterval(control, CONTROL_INTERVAL_MS);
      control();
    });
    options.signal?.removeEventListener('abort', onAbort);

    // Beri kesempatan iterasi yang sedang berjalan untuk selesai.
    await sleep(GRACEFUL_STOP_MS, Promise.allSettled([...inflight]));
    metrics.closed = true;
    const elapsed = this.now() - started;
    return { ...metrics.snapshot(elapsed, 0, peak), aborted };
  }
}

/** Tunggu `ms`, atau berhenti lebih awal saat `until` selesai (timer selalu dibersihkan). */
function sleep(ms: number, until: Promise<unknown>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    until.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
