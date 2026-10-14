import type { Run, RunTrigger, StartRunRequest } from '@flowqa/shared';
import { createId } from '@flowqa/shared';
import { config } from '../config';
import { SecretMasker } from '../engine/masking';
import { ScenarioRunner } from '../engine/scenario-runner';
import type { HttpClient } from '../engine/http-client';
import { HttpError, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { NotificationService } from './notification-service';
import { log } from '../lib/log';
import { assertProjectEnvironment } from '../domain/guards';
import { linkSignal, stoppedByOf } from '../lib/stop';

/**
 * Mengelola siklus hidup run: membuat record, menjalankan ScenarioRunner di
 * background, menyimpan progres ke database, dan merangkum hasil akhirnya.
 * UI memantau progres dengan polling GET /api/runs/:id.
 */
export class RunService {
  private readonly runner: ScenarioRunner;
  private readonly active = new Map<string, Promise<Run>>();
  /** Run yang sedang berjalan → pengendali Stop-nya. */
  private readonly controllers = new Map<string, { controller: AbortController; run: Run }>();

  constructor(
    private readonly repos: Repositories,
    http: HttpClient,
    private readonly notifier?: NotificationService,
  ) {
    this.runner = new ScenarioRunner({ http, findApi: (id) => repos.apis.get(id) });
  }

  /**
   * Mulai run dan langsung kembalikan record awal (status running).
   * `notify: false` = jangan kirim email untuk run ini (bulk run mengirim ringkasan sendiri).
   */
  start(
    request: StartRunRequest,
    trigger: RunTrigger = 'manual',
    options: {
      notify?: boolean;
      /** Variabel awal (mis. dari UI test yang menjalankan scenario ini). */
      initialVariables?: Record<string, unknown>;
      /** Label mode di daftar run, mis. 'From UI test "Login"'. */
      mode?: string;
      /** Variabel akhir (belum disamarkan) setelah scenario selesai. */
      onVariables?: (variables: Record<string, unknown>) => void;
      /** Run induk (UI test / E2E Flow) dihentikan → run ini ikut berhenti. */
      signal?: AbortSignal;
    } = {},
  ): Run {
    const scenario = this.repos.scenarios.get(request.scenarioId);
    if (!scenario) throw notFound('Scenario');
    const environment = assertProjectEnvironment(this.repos, scenario.projectId, request.environmentId);
    if (!scenario.steps.length) throw new HttpError(400, 'This scenario has no steps yet');

    const partial = request.fromStep !== undefined || (request.onlySteps?.length ?? 0) > 0;
    const mode =
      options.mode ??
      (trigger === 'schedule'
        ? 'Scheduled run'
        : request.onlySteps?.length
          ? `Selected steps (${request.onlySteps.length})`
          : request.fromStep !== undefined
            ? `From step ${request.fromStep + 1}`
            : 'Full run');

    const now = nowIso();
    const run: Run = {
      id: createId('run'),
      projectId: scenario.projectId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      environmentId: environment.id,
      environmentName: environment.name,
      status: 'running',
      trigger,
      mode,
      startedAt: now,
      finishedAt: null,
      durationMs: 0,
      steps: scenario.steps.map((s, index) => ({
        index,
        stepId: s.id,
        name: s.name,
        type: s.type,
        status: 'queued',
      })),
      counts: { total: scenario.steps.length, passed: 0, failed: 0, skipped: 0 },
      variables: {},
      createdAt: now,
      updatedAt: now,
    };
    this.persist(run);

    const controller = new AbortController();
    linkSignal(controller, options.signal);
    this.controllers.set(run.id, { controller, run });
    const initialVariables =
      options.initialVariables ?? (partial ? this.repos.scenarioState.get(scenario.id) : {});
    const job = this.runner
      .execute(
        scenario,
        environment,
        run,
        {
          fromStep: request.fromStep,
          onlySteps: request.onlySteps,
          initialVariables,
          signal: controller.signal,
        },
        (r) => this.persist(r),
      )
      .then((variables) => {
        options.onVariables?.(variables);
        if (controller.signal.aborted) run.stoppedBy ??= stoppedByOf(controller.signal);
        this.finish(run, variables, new SecretMasker(environment), controller.signal.aborted);
        return run;
      })
      .catch((error) => {
        log.error('run crashed', error);
        run.status = 'failed';
        run.failureReason = 'The test runner crashed. See the server log.';
        run.finishedAt = nowIso();
        this.persist(run);
        return run;
      })
      .then((finished) => {
        // Run yang sengaja dihentikan tidak dikirim lewat email.
        if (options.notify !== false && finished.status !== 'stopped') this.notifier?.apiRun(finished);
        return finished;
      })
      .finally(() => {
        this.active.delete(run.id);
        this.controllers.delete(run.id);
      });
    this.active.set(run.id, job);
    return run;
  }

  /**
   * Jalankan beberapa scenario berurutan di latar belakang (Run all / Run folder).
   * Kegagalan satu scenario tidak menghentikan yang lain.
   */
  startBatch(scenarioIds: string[], environmentId: string): void {
    void (async () => {
      const finished: Run[] = [];
      for (const scenarioId of scenarioIds) {
        try {
          const run = await this.wait(
            this.start({ scenarioId, environmentId }, 'manual', { notify: false }).id,
          );
          if (run) finished.push(run);
          // Satu run di batch dihentikan → sisa batch juga tidak dijalankan (dan tidak ada email).
          if (run?.status === 'stopped') return;
        } catch (error) {
          log.warn(`batch run skipped scenario ${scenarioId}: ${(error as Error).message}`);
        }
      }
      // Satu email ringkasan, bukan satu email per scenario.
      if (finished.length) this.notifier?.apiBatch(finished[0].projectId, finished);
    })();
  }

  /**
   * Jalankan scenario dari dalam UI test (step "Run API scenario") dan tunggu
   * hasilnya. Run tetap tersimpan di Test Runs; email tidak dikirim terpisah.
   */
  async runEmbedded(request: {
    scenarioId: string;
    environmentId: string;
    variables: Record<string, unknown>;
    label: string;
    /** Run induk dihentikan → scenario ini ikut berhenti. */
    signal?: AbortSignal;
  }): Promise<{ run: Run; variables: Record<string, unknown> }> {
    let variables: Record<string, unknown> = {};
    const started = this.start(
      { scenarioId: request.scenarioId, environmentId: request.environmentId },
      'manual',
      {
        notify: false,
        initialVariables: request.variables,
        mode: request.label,
        onVariables: (v) => (variables = v),
        signal: request.signal,
      },
    );
    const run = (await this.wait(started.id)) ?? started;
    return { run, variables };
  }

  /**
   * Hentikan run yang sedang berjalan. Step yang belum jalan dilewati, request
   * yang sedang berjalan dibatalkan, dan run berstatus "stopped".
   */
  stop(runId: string, stoppedBy?: string): Run {
    const active = this.controllers.get(runId);
    if (!active) {
      const run = this.repos.runs.get(runId);
      if (!run) throw notFound('Run');
      throw new HttpError(409, 'This run has already finished.');
    }
    active.run.stoppedBy ??= stoppedBy;
    active.controller.abort(stoppedBy ?? 'user');
    this.persist(active.run);
    return active.run;
  }

  /** Tunggu sampai run selesai (dipakai scheduler & test). */
  wait(runId: string): Promise<Run> | undefined {
    return this.active.get(runId);
  }

  private finish(run: Run, variables: Record<string, unknown>, masker: SecretMasker, stopped = false): void {
    const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
    for (const step of run.steps) {
      if (step.status === 'not-run') continue;
      counts.total++;
      if (step.status === 'passed' || step.status === 'failed' || step.status === 'skipped')
        counts[step.status]++;
    }
    const failed = run.steps.find((s) => s.status === 'failed');
    run.counts = counts;
    run.status = stopped ? 'stopped' : counts.failed ? 'failed' : 'passed';
    run.finishedAt = nowIso();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    run.failedStep = failed?.name;
    run.failureReason = failed?.explanation?.title;
    run.variables = masker.value(variables);
    this.repos.scenarioState.merge(run.scenarioId, variables);
    this.persist(run);
    this.repos.runs.prune(config.limits.storedRuns);
  }

  private persist(run: Run): void {
    run.updatedAt = nowIso();
    this.repos.runs.save(run);
  }
}
