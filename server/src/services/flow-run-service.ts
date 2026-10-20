/**
 * E2E Flow: menjalankan node di kanvas (UI test web, UI test Android, API
 * scenario, jeda) mengikuti panah. Node mulai setelah SEMUA node sebelumnya
 * selesai (lulus, atau gagal dengan "continue on fail"); cabang yang tidak saling
 * bergantung berjalan paralel. Variabel hasil tiap node (Set a value, Pick an
 * option, capture API) diteruskan ke node sesudahnya sebagai {{nama}}.
 * Nilai asli variabel hanya ada di memori; yang disimpan disamarkan.
 */
import type { E2EFlow, FlowNode, FlowNodeResult, FlowRun, FlowRunOptions, RunTrigger } from '@flowqa/shared';
import { MOBILE_EXECUTION_MODES, createId } from '@flowqa/shared';
import { assertProjectEnvironment } from '../domain/guards';
import { HttpError, notFound } from '../lib/http';
import { log } from '../lib/log';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import type { NotificationService } from './notification-service';
import type { RunService } from './run-service';
import { maskVariables, type UiRunService } from './ui-run-service';
import { StoppedError, isStopped, untilStopped } from '../lib/stop';

const MAX_WAIT_MS = 10 * 60_000;
const STORED_FLOW_RUNS = 300;

/** Masalah struktur flow (untuk ditampilkan sebelum dijalankan). */
export function validateFlow(
  flow: Pick<E2EFlow, 'nodes' | 'edges'>,
  repos?: Repositories,
  projectId?: string,
): string[] {
  const problems: string[] = [];
  const ids = new Set(flow.nodes.map((n) => n.id));
  const runnable = flow.nodes.filter((n) => n.kind !== 'start');
  if (!runnable.length) problems.push('Add at least one test case to the canvas.');
  for (const e of flow.edges)
    if (!ids.has(e.from) || !ids.has(e.to)) problems.push('An arrow points to a node that no longer exists.');
  if (hasCycle(flow)) problems.push('The arrows form a loop. A flow must go one way (no cycles).');
  if (repos && projectId)
    for (const n of flow.nodes) {
      if (n.kind === 'web' || n.kind === 'mobile') {
        const test = n.refId ? repos.uiTests.get(n.refId) : undefined;
        if (!test || test.projectId !== projectId)
          problems.push(`"${n.label}": the UI test case no longer exists.`);
        else if ((test.target === 'mobile') !== (n.kind === 'mobile'))
          problems.push(`"${n.label}" is a ${test.target === 'mobile' ? 'mobile' : 'web'} test.`);
      }
      if (n.kind === 'api') {
        const scenario = n.refId ? repos.scenarios.get(n.refId) : undefined;
        if (!scenario || scenario.projectId !== projectId)
          problems.push(`"${n.label}": the API scenario no longer exists.`);
      }
    }
  return [...new Set(problems)];
}

/**
 * Pilihan Run yang berlaku: hanya yang dikenal dan relevan dengan node di flow
 * (tanpa node web, "tampilkan browser" diabaikan). Undefined = tidak ada pilihan.
 */
export function runOptions(input: unknown, flow: Pick<E2EFlow, 'nodes'>): FlowRunOptions | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Record<string, unknown>;
  const out: FlowRunOptions = {};
  if (typeof raw.visible === 'boolean' && flow.nodes.some((n) => n.kind === 'web')) out.visible = raw.visible;
  if (MOBILE_EXECUTION_MODES.includes(raw.mode as never) && flow.nodes.some((n) => n.kind === 'mobile'))
    out.mode = raw.mode as FlowRunOptions['mode'];
  return Object.keys(out).length ? out : undefined;
}

export function hasCycle(flow: Pick<E2EFlow, 'nodes' | 'edges'>): boolean {
  const next = new Map<string, string[]>();
  for (const e of flow.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const to of next.get(id) ?? []) if (visit(to)) return true;
    state.set(id, 2);
    return false;
  };
  return flow.nodes.some((n) => visit(n.id));
}

export class FlowRunService {
  private readonly active = new Map<string, Promise<FlowRun>>();
  /** Flow run yang sedang berjalan → pengendali Stop-nya. */
  private readonly controllers = new Map<string, { controller: AbortController; run: FlowRun }>();

  constructor(
    private readonly repos: Repositories,
    private readonly uiRuns: UiRunService,
    private readonly apiRuns: RunService,
    private readonly notifier?: NotificationService,
  ) {}

  wait(runId: string): Promise<FlowRun> | undefined {
    return this.active.get(runId);
  }

  start(
    flowId: string,
    options: { environmentId?: string | null; trigger?: RunTrigger; run?: FlowRunOptions } = {},
  ): FlowRun {
    const flow = this.repos.flows.get(flowId);
    if (!flow) throw notFound('E2E flow');
    const problems = validateFlow(flow, this.repos, flow.projectId);
    if (problems.length) throw new HttpError(400, problems.join(' '));
    const environmentId = options.environmentId ?? flow.environmentId;
    const environment = environmentId
      ? assertProjectEnvironment(this.repos, flow.projectId, environmentId)
      : null;
    if (!environment && flow.nodes.some((n) => n.kind === 'api'))
      throw new HttpError(
        400,
        'Choose an environment: API scenario nodes need one to know which server to call.',
      );

    const choices = runOptions(options.run, flow);
    const now = nowIso();
    const run: FlowRun = {
      id: createId('fr'),
      projectId: flow.projectId,
      flowId: flow.id,
      flowName: flow.name,
      status: 'running',
      trigger: options.trigger ?? 'manual',
      startedAt: now,
      finishedAt: null,
      durationMs: 0,
      environmentName: environment?.name ?? 'No environment',
      nodes: flow.nodes.map((n) => ({
        nodeId: n.id,
        kind: n.kind,
        label: n.label,
        status: 'pending',
        startedAt: null,
        finishedAt: null,
        durationMs: 0,
      })),
      graph: { nodes: flow.nodes, edges: flow.edges },
      variables: {},
      ...(choices ? { options: choices } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.persist(run);
    const controller = new AbortController();
    this.controllers.set(run.id, { controller, run });
    const job = this.execute(flow, run, environment?.id ?? null, controller.signal)
      .catch((error) => {
        log.error('E2E flow crashed', error);
        run.failureReason = (error as Error).message;
        return run;
      })
      .then(() => this.finish(run, controller.signal.aborted))
      .finally(() => {
        this.active.delete(run.id);
        this.controllers.delete(run.id);
      });
    this.active.set(run.id, job);
    return run;
  }

  /**
   * Hentikan flow: node yang sedang berjalan (UI test web/Android, API scenario,
   * jeda) ikut dihentikan beserta run di bawahnya; node berikutnya tidak dijalankan.
   */
  stop(runId: string, stoppedBy?: string): FlowRun {
    const active = this.controllers.get(runId);
    if (!active) {
      const run = this.repos.flowRuns.get(runId);
      if (!run) throw notFound('E2E flow run');
      throw new HttpError(409, 'This flow run has already finished.');
    }
    active.run.stoppedBy ??= stoppedBy;
    active.controller.abort(stoppedBy ?? 'user');
    this.persist(active.run);
    return active.run;
  }

  /** Jalankan node yang semua pendahulunya sudah selesai, berulang sampai tidak ada lagi. */
  private async execute(
    flow: E2EFlow,
    run: FlowRun,
    environmentId: string | null,
    signal: AbortSignal,
  ): Promise<void> {
    const parents = new Map<string, string[]>();
    for (const n of flow.nodes) parents.set(n.id, []);
    for (const e of flow.edges) parents.get(e.to)?.push(e.from);
    const result = (id: string) => run.nodes.find((r) => r.nodeId === id)!;
    const node = (id: string) => flow.nodes.find((n) => n.id === id)!;
    // Variabel asli per node (hanya di memori); node menerima gabungan semua leluhurnya.
    const outputs = new Map<string, Record<string, string>>();
    const inputsOf = (id: string): Record<string, string> => {
      const merged: Record<string, string> = {};
      const seen = new Set<string>();
      const walk = (nid: string) => {
        for (const p of parents.get(nid) ?? []) {
          if (seen.has(p)) continue;
          seen.add(p);
          walk(p);
          Object.assign(merged, outputs.get(p) ?? {});
        }
      };
      walk(id);
      return merged;
    };
    const ok = (id: string) => {
      const r = result(id);
      return r.status === 'passed' || (r.status === 'failed' && !!node(id).config.continueOnFail);
    };
    const running = new Map<string, Promise<void>>();

    for (;;) {
      // Stop: node yang belum mulai tidak dijalankan lagi.
      if (signal.aborted)
        for (const r of run.nodes)
          if (r.status === 'pending') {
            r.status = 'skipped';
            r.error = 'Stopped by user';
          }
      // Node yang pendahulunya gagal (tanpa continue on fail) dilewati.
      for (const r of run.nodes)
        if (r.status === 'pending') {
          const ps = parents.get(r.nodeId) ?? [];
          const done = ps.every((p) => !['pending', 'running'].includes(result(p).status));
          if (done && ps.some((p) => !ok(p))) {
            r.status = 'skipped';
            r.error = 'Skipped because an earlier node failed';
          }
        }
      const ready = run.nodes.filter(
        (r) => r.status === 'pending' && (parents.get(r.nodeId) ?? []).every((p) => ok(p)),
      );
      for (const r of ready) {
        r.status = 'running';
        r.startedAt = nowIso();
        this.persist(run);
        const task = this.runNode(node(r.nodeId), r, inputsOf(r.nodeId), flow, run, environmentId, signal)
          .then((vars) => {
            outputs.set(r.nodeId, vars);
          })
          .catch((error) => {
            if (isStopped(error) || signal.aborted) {
              r.status = 'stopped';
              r.error = 'Stopped by user';
              return;
            }
            r.status = 'failed';
            r.error = (error as Error).message;
          })
          .finally(() => {
            r.finishedAt = nowIso();
            r.durationMs = new Date(r.finishedAt).getTime() - new Date(r.startedAt!).getTime();
            running.delete(r.nodeId);
            this.persist(run);
          });
        running.set(r.nodeId, task);
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }
    // Variabel akhir (gabungan semua node, disamarkan).
    const all: Record<string, string> = {};
    for (const n of flow.nodes) Object.assign(all, outputs.get(n.id) ?? {});
    run.variables = maskVariables(all, this.secretsOf(environmentId));
  }

  private secretsOf(environmentId: string | null): string[] {
    const env = environmentId ? this.repos.environments.get(environmentId) : undefined;
    return env?.variables.filter((v) => v.secret).map((v) => v.value) ?? [];
  }

  /** Jalankan satu node; mengembalikan variabel keluarannya (nilai asli). */
  private async runNode(
    node: FlowNode,
    result: FlowNodeResult,
    inputs: Record<string, string>,
    flow: E2EFlow,
    run: FlowRun,
    environmentId: string | null,
    signal: AbortSignal,
  ): Promise<Record<string, string>> {
    const produced = (before: Record<string, string>, after: Record<string, string>) => {
      const changed = Object.entries(after).filter(([k, v]) => before[k] !== v);
      result.outputs = changed.map(([k]) => k);
      return after;
    };
    switch (node.kind) {
      case 'start':
        result.status = 'passed';
        return inputs;
      case 'wait': {
        const ms = Math.min(Math.max(Number(node.config.waitMs) || 0, 0), MAX_WAIT_MS);
        await untilStopped(new Promise((r) => setTimeout(r, ms)), signal);
        result.status = 'passed';
        return inputs;
      }
      case 'api': {
        const { run: apiRun, variables } = await this.apiRuns.runEmbedded({
          scenarioId: node.refId!,
          environmentId: environmentId!,
          variables: inputs,
          label: `From E2E flow "${flow.name}"`,
          signal,
        });
        result.runId = apiRun.id;
        result.runKind = 'api';
        if (apiRun.status === 'stopped') throw new StoppedError();
        result.status = apiRun.status === 'passed' ? 'passed' : 'failed';
        if (result.status === 'failed')
          result.error = `${apiRun.failedStep ? `${apiRun.failedStep}: ` : ''}${apiRun.failureReason ?? 'failed'}`;
        const after = Object.fromEntries(
          Object.entries({ ...inputs, ...variables }).map(([k, v]) => [
            k,
            typeof v === 'string' ? v : JSON.stringify(v),
          ]),
        );
        return produced(inputs, after);
      }
      case 'web':
      case 'mobile': {
        let variables: Record<string, string> = inputs;
        const started = this.uiRuns.start(node.refId!, {
          environmentId,
          trigger: 'flow',
          notify: false,
          headless: node.kind === 'web' ? !(run.options?.visible ?? node.config.visible) : true,
          ...(node.kind === 'mobile' && (run.options?.mode ?? node.config.mode)
            ? { mode: run.options?.mode ?? node.config.mode }
            : {}),
          initialVariables: inputs,
          onVariables: (v) => (variables = v),
          signal,
        });
        result.runId = started.id;
        result.runKind = 'ui';
        this.persist(run);
        const done = (await this.uiRuns.wait(started.id)) ?? started;
        if (done.status === 'stopped') throw new StoppedError();
        result.status = done.status === 'passed' ? 'passed' : 'failed';
        if (result.status === 'failed')
          result.error = done.failureReason ?? `The test ended as ${done.status}`;
        return produced(inputs, { ...inputs, ...variables });
      }
    }
  }

  private finish(run: FlowRun, stopped = false): FlowRun {
    // Node yang tidak pernah bisa jalan (mis. menunggu node yang gagal) ditandai dilewati.
    for (const n of run.nodes) if (n.status === 'pending' || n.status === 'running') n.status = 'skipped';
    const failed = run.nodes.find((n) => n.status === 'failed');
    run.status = stopped ? 'stopped' : failed || run.failureReason ? 'failed' : 'passed';
    if (!stopped) run.failureReason ??= failed ? `${failed.label}: ${failed.error ?? 'failed'}` : undefined;
    run.finishedAt = nowIso();
    run.durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    this.persist(run);
    this.repos.flowRuns.prune(STORED_FLOW_RUNS);
    if (!stopped) this.notifier?.flowRun(run);
    return run;
  }

  private persist(run: FlowRun) {
    run.updatedAt = nowIso();
    this.repos.flowRuns.save(run);
  }
}
