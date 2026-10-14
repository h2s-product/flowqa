/**
 * ScenarioRunner mengeksekusi langkah-langkah sebuah scenario secara berurutan.
 * Kelas ini TIDAK tahu soal database — persistensi & progres ditangani RunService
 * lewat callback `onProgress`. Ini membuatnya mudah dites secara terisolasi.
 */
import type {
  ApiDefinition,
  ApiStep,
  CaptureResult,
  ConditionStep,
  Environment,
  Run,
  Scenario,
  SetVariableStep,
  Step,
  StepResult,
  WaitStep,
} from '@flowqa/shared';
import { compareValues, getByPath, pathParameters } from '@flowqa/shared';
import { defaultSuccessAssertion, evaluateAssertion } from './assertions';
import { explainFailure, explainMissingVariables, explainNetworkError } from './explain';
import { NetworkError, type HttpClient } from './http-client';
import { SecretMasker } from './masking';
import { VariableContext } from './variable-context';
import { isStopped, untilStopped } from '../lib/stop';

export interface RunnerDependencies {
  http: HttpClient;
  findApi: (id: string) => ApiDefinition | undefined;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunOptions {
  fromStep?: number;
  onlySteps?: number[];
  /** Variabel awal (mis. dari run sebelumnya untuk "Run from step"). */
  initialVariables?: Record<string, unknown>;
  /** Tombol Stop: step berikutnya tidak dijalankan, request yang berjalan dibatalkan. */
  signal?: AbortSignal;
}

type StepOutcome = Omit<StepResult, 'index' | 'stepId' | 'name' | 'type'> & { skipNext?: number };

const MAX_WAIT_MS = 60_000;
const MAX_RETRIES = 5;
const MAX_REPEAT = 50;
const BODY_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export class ScenarioRunner {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: RunnerDependencies) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Jalankan scenario. `run` dimutasi langsung dan `onProgress` dipanggil
   * setiap kali status step berubah. Mengembalikan variabel mentah (belum disamarkan).
   */
  async execute(
    scenario: Scenario,
    environment: Environment,
    run: Run,
    options: RunOptions,
    onProgress: (run: Run) => void,
  ): Promise<Record<string, unknown>> {
    const variables = new VariableContext(environment, options.initialVariables);
    const masker = new SecretMasker(environment);
    const only = options.onlySteps ? new Set(options.onlySteps) : null;
    let stopAfterFailure = false;
    let skipRemaining = 0;

    for (let index = 0; index < scenario.steps.length; index++) {
      const step = scenario.steps[index];
      const result = run.steps[index];
      const inScope =
        (options.fromStep === undefined || index >= options.fromStep) && (!only || only.has(index));

      if (options.signal?.aborted && inScope && !step.disabled) {
        Object.assign(result, { status: 'skipped', note: 'Stopped by user' });
        continue;
      }
      if (!inScope) {
        Object.assign(result, { status: 'not-run', note: 'Not part of this run' });
        continue;
      }
      if (step.disabled) {
        Object.assign(result, { status: 'skipped', note: 'Step is turned off' });
        continue;
      }
      if (stopAfterFailure) {
        Object.assign(result, { status: 'skipped', note: 'Skipped because an earlier step failed' });
        continue;
      }
      if (skipRemaining > 0) {
        skipRemaining--;
        Object.assign(result, { status: 'skipped', note: 'Skipped by a condition' });
        continue;
      }

      result.status = 'running';
      result.startedAt = new Date().toISOString();
      onProgress(run);

      let outcome: StepOutcome;
      try {
        outcome = await untilStopped(
          this.executeStep(step, index, scenario, environment, variables, masker, options.signal),
          options.signal,
        );
      } catch (error) {
        if (isStopped(error)) {
          Object.assign(result, {
            status: 'skipped',
            note: 'Stopped by user while this step was running',
            finishedAt: new Date().toISOString(),
          });
          onProgress(run);
          continue;
        }
        outcome = {
          status: 'failed',
          durationMs: 0,
          explanation: {
            title: 'Unexpected error while running this step',
            detail: (error as Error).message,
            fix: 'Check the step configuration.',
          },
        };
      }
      const { skipNext, ...stepResult } = outcome;
      Object.assign(result, stepResult, { finishedAt: new Date().toISOString() });
      if (skipNext) skipRemaining = skipNext;
      if (outcome.status === 'failed' && !step.continueOnFailure && !scenario.continueOnFailure)
        stopAfterFailure = true;
      onProgress(run);
    }

    return variables.snapshot();
  }

  private executeStep(
    step: Step,
    index: number,
    scenario: Scenario,
    environment: Environment,
    variables: VariableContext,
    masker: SecretMasker,
    signal?: AbortSignal,
  ): Promise<StepOutcome> {
    switch (step.type) {
      case 'wait':
        return this.executeWait(step);
      case 'setVariable':
        return Promise.resolve(this.executeSetVariable(step, index, scenario, variables, masker));
      case 'condition':
        return Promise.resolve(this.executeCondition(step, variables));
      case 'api':
        return this.executeApiWithRetries(step, index, scenario, environment, variables, masker, signal);
    }
  }

  private async executeWait(step: WaitStep): Promise<StepOutcome> {
    const ms = Math.min(Math.max(0, Number(step.durationMs) || 0), MAX_WAIT_MS);
    await this.sleep(ms);
    return { status: 'passed', durationMs: ms, note: `Waited ${ms} ms` };
  }

  private executeSetVariable(
    step: SetVariableStep,
    index: number,
    scenario: Scenario,
    variables: VariableContext,
    masker: SecretMasker,
  ): StepOutcome {
    if (!step.variable) {
      return {
        status: 'failed',
        durationMs: 0,
        explanation: {
          title: 'This step has no variable name',
          detail: '',
          fix: 'Give the variable a name, for example customer_email.',
        },
      };
    }
    const missing: string[] = [];
    const value = variables.resolve(step.value ?? '', missing);
    if (missing.length)
      return {
        status: 'failed',
        durationMs: 0,
        explanation: explainMissingVariables(missing, scenario, index),
      };
    variables.set(step.variable, value);
    const shown = masker.text(value);
    return {
      status: 'passed',
      durationMs: 0,
      note: `Saved {{${step.variable}}} = ${shown}`,
      captures: [{ field: '(set)', variable: step.variable, ok: true, value: shown }],
    };
  }

  private executeCondition(step: ConditionStep, variables: VariableContext): StepOutcome {
    const left = variables.resolve(step.left ?? '');
    const right = variables.resolve(step.right ?? '');
    const met = compareValues(left, step.operator, right);
    const skip = Math.max(1, Number(step.skipCount) || 1);
    return {
      status: 'passed',
      durationMs: 0,
      note: met
        ? `Condition met (${left} ${step.operator} ${right}), continuing`
        : `Condition not met (${left} ${step.operator} ${right}), skipping next ${skip} step${skip > 1 ? 's' : ''}`,
      skipNext: met ? 0 : skip,
    };
  }

  private async executeApiWithRetries(
    step: ApiStep,
    index: number,
    scenario: Scenario,
    environment: Environment,
    variables: VariableContext,
    masker: SecretMasker,
    signal?: AbortSignal,
  ): Promise<StepOutcome> {
    const attempts = 1 + Math.min(MAX_RETRIES, Math.max(0, Number(step.retries) || 0));
    const repeat = Math.min(MAX_REPEAT, Math.max(1, Number(step.repeat) || 1));
    let last: StepOutcome = { status: 'failed' };

    for (let r = 0; r < repeat; r++) {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (signal?.aborted) return last;
        last = await this.executeApi(step, index, scenario, environment, variables, masker, signal);
        last.attempts = attempt;
        if (last.status === 'passed') break;
        if (attempt < attempts) await this.sleep(500 * attempt);
      }
      if (last.status !== 'passed') break;
      if (repeat > 1) last.note = `Repeated ${r + 1} of ${repeat} times`;
    }
    return last;
  }

  private async executeApi(
    step: ApiStep,
    index: number,
    scenario: Scenario,
    environment: Environment,
    variables: VariableContext,
    masker: SecretMasker,
    signal?: AbortSignal,
  ): Promise<StepOutcome> {
    const api = this.deps.findApi(step.apiId);
    if (!api) {
      return {
        status: 'failed',
        durationMs: 0,
        explanation: {
          title: 'This step points to an API that no longer exists',
          detail: '',
          fix: 'Pick another API on the Request tab.',
        },
      };
    }

    const missing: string[] = [];
    const url = this.buildUrl(api, step, environment, variables, missing);
    const headers = this.buildHeaders(api, step, environment, variables, missing);

    let body: unknown;
    if (BODY_METHODS.includes(api.method)) {
      try {
        body = variables.buildBody(step, missing);
        headers['Content-Type'] = api.contentType || 'application/json';
      } catch (error) {
        return {
          status: 'failed',
          durationMs: 0,
          explanation: {
            title: 'The request body is not valid JSON',
            detail: (error as Error).message,
            fix: 'Fix the JSON in Advanced JSON mode, or switch back to the visual builder.',
          },
        };
      }
    }

    const request = {
      method: api.method,
      url: masker.text(url),
      headers: masker.headers(headers),
      body: masker.value(body),
    };
    if (missing.length) {
      return {
        status: 'failed',
        durationMs: 0,
        request,
        explanation: explainMissingVariables(missing, scenario, index),
      };
    }

    let response;
    try {
      response = await this.deps.http.send({
        method: api.method,
        url,
        headers,
        body,
        timeoutMs: Number(step.timeoutMs) || environment.timeoutMs || 30_000,
        verifySsl: environment.verifySsl,
        proxy: environment.proxy,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof NetworkError) {
        return {
          status: 'failed',
          durationMs: error.durationMs,
          request,
          explanation: explainNetworkError(error.kind, error.message, request.url),
        };
      }
      throw error;
    }

    // Capture dulu, supaya assertion bisa memakai variabel yang baru saja disimpan.
    const captures: CaptureResult[] = step.captures
      .filter((c) => c.field && c.variable)
      .map((c) => {
        const value = getByPath(response.body, c.field);
        if (value === undefined) return { field: c.field, variable: c.variable, ok: false };
        variables.set(c.variable, value);
        return { field: c.field, variable: c.variable, ok: true, value: masker.value(value) };
      });

    const snapshot = { status: response.status, body: response.body, durationMs: response.durationMs };
    const assertions = step.assertions.map((a) => evaluateAssertion(a, snapshot, variables));
    if (!step.assertions.some((a) => a.kind === 'status'))
      assertions.unshift(defaultSuccessAssertion(response.status));

    const failedAssertions = assertions.filter((a) => !a.passed);
    const failedCaptures = captures.filter((c) => !c.ok);
    const status = failedAssertions.length || failedCaptures.length ? 'failed' : 'passed';

    return {
      status,
      durationMs: Math.round(response.durationMs),
      request,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: masker.headers(response.headers),
        body: masker.value(response.body),
        sizeBytes: response.sizeBytes,
        durationMs: Math.round(response.durationMs),
      },
      assertions,
      captures,
      explanation:
        status === 'failed'
          ? explainFailure({
              step,
              api,
              scenario,
              index,
              status: response.status,
              body: response.body,
              failedAssertions,
              failedCaptures,
            })
          : undefined,
    };
  }

  private buildUrl(
    api: ApiDefinition,
    step: ApiStep,
    env: Environment,
    vars: VariableContext,
    missing: string[],
  ): string {
    let path = api.path;
    for (const param of pathParameters(api.path)) {
      const template = step.pathParams?.[param] || `{{${param}}}`;
      path = path.replace(`{${param}}`, encodeURIComponent(vars.resolve(template, missing)));
    }
    const query = [...(api.query ?? []), ...(step.query ?? [])]
      .filter((q) => q.key)
      .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(vars.resolve(q.value, missing))}`);
    const base = vars.resolve(env.baseUrl, missing).replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}${query.length ? `?${query.join('&')}` : ''}`;
  }

  private buildHeaders(
    api: ApiDefinition,
    step: ApiStep,
    env: Environment,
    vars: VariableContext,
    missing: string[],
  ) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const apply = (list: { key: string; value: string }[] = []) =>
      list.filter((h) => h.key).forEach((h) => (headers[h.key] = vars.resolve(h.value, missing)));
    apply(env.headers);
    apply(api.headers);
    if (api.auth === 'bearer') {
      headers.Authorization = `Bearer ${vars.resolve(`{{${step.tokenVariable || 'auth_token'}}}`, missing)}`;
    }
    apply(step.headers);
    return headers;
  }
}
