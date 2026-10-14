/**
 * Tombol Stop: run yang dihentikan berstatus "stopped", step sisanya dilewati,
 * dan semua proses terkait ikut berhenti — request HTTP dibatalkan, perangkat
 * dilepas / keluar dari antrean, API scenario di dalam UI test dan node E2E Flow
 * ikut dihentikan, sisa batch tidak dijalankan.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { FlowEdge, FlowNode } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `stop-artifacts-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const {
  normalizeApi,
  normalizeEnvironment,
  normalizeFlow,
  normalizeProject,
  normalizeScenario,
  normalizeUiStep,
  normalizeUiTest,
} = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');

const APP = {
  platform: 'android',
  app: '',
  appPackage: 'com.demo',
  appActivity: '',
  deviceName: '',
  platformVersion: '',
  udid: '',
  noReset: false,
  capabilities: '',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(20);
  }
}

function setup() {
  /** Request ke /slow menggantung sampai dibatalkan (atau 20 detik). */
  const requests: { url: string; aborted: boolean }[] = [];
  const http = {
    send(request: { url: string; signal?: AbortSignal }) {
      const entry = { url: request.url, aborted: false };
      requests.push(entry);
      const ok = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: { ok: true },
        sizeBytes: 10,
        durationMs: 1,
      };
      if (!request.url.endsWith('/slow')) return Promise.resolve(ok);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(ok), 20_000);
        request.signal?.addEventListener('abort', () => {
          entry.aborted = true;
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
    },
  };
  const repos = createRepositories(openDatabase(':memory:'));
  const ctx = createAppContext(repos, http as never, null);
  ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
  const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
  const env = repos.environments.save(
    normalizeEnvironment({ name: 'Dev', baseUrl: 'http://api.test' }, projectId),
  );
  const scenario = (name: string, paths: string[]) =>
    repos.scenarios.save(
      normalizeScenario(
        {
          name,
          steps: paths.map((p) => ({
            type: 'api',
            name: `GET ${p}`,
            apiId: repos.apis.save(normalizeApi({ name: p, method: 'GET', path: p }, projectId)).id,
          })),
        },
        projectId,
      ),
    );
  const mobileTest = (name: string, steps: Record<string, unknown>[]) =>
    repos.uiTests.save(
      normalizeUiTest(
        { name, target: 'mobile', mobile: APP, steps: steps.map((s) => normalizeUiStep(s)) },
        projectId,
      ),
    );
  return { repos, ctx, projectId, env, requests, scenario, mobileTest };
}

const node = (id: string, kind: FlowNode['kind'], refId: string | null, config = {}): FlowNode => ({
  id,
  kind,
  refId,
  label: id,
  x: 0,
  y: 0,
  config,
});
const edge = (from: string, to: string): FlowEdge => ({ id: `${from}-${to}`, from, to });

describe('Stop a running test', () => {
  it('stops an API run: cancels the request in flight and skips the remaining steps', async () => {
    const { ctx, env, requests, scenario } = setup();
    const s = scenario('Orders', ['/fast', '/slow', '/after']);
    const started = ctx.runs.start({ scenarioId: s.id, environmentId: env.id });
    await until(() => requests.some((r) => r.url.endsWith('/slow')), 'the slow request');
    const t0 = Date.now();
    ctx.runs.stop(started.id, 'Admin');
    const run = (await ctx.runs.wait(started.id))!;
    assert.ok(Date.now() - t0 < 2_000, 'stops right away');
    assert.equal(run.status, 'stopped');
    assert.equal(run.stoppedBy, 'Admin');
    assert.deepEqual(
      run.steps.map((x) => x.status),
      ['passed', 'skipped', 'skipped'],
    );
    assert.match(run.steps[1].note ?? '', /Stopped by user/);
    assert.ok(requests.find((r) => r.url.endsWith('/slow'))!.aborted, 'the HTTP request was cancelled');
    assert.ok(!requests.some((r) => r.url.endsWith('/after')), 'the next step never ran');
    assert.throws(() => ctx.runs.stop(started.id), /already finished/);
  });

  it('stops a mobile run waiting in the device queue and removes it from the queue', async () => {
    const { ctx, mobileTest } = setup();
    const test = mobileTest('Queued', [{ type: 'wait', value: '100' }]);
    // Kunci perangkat mock seolah dipakai test lain.
    const busy = await ctx.deviceLocks.acquire(['mock-device'], 'Other test');
    const started = ctx.uiRuns.start(test.id, { mode: 'mock' });
    await until(() => ctx.repos.uiRuns.get(started.id)?.status === 'queued', 'the run to queue');
    assert.equal(ctx.deviceLocks.queued(), 1);
    ctx.uiRuns.stop(started.id, 'Admin');
    const run = (await ctx.uiRuns.wait(started.id))!;
    assert.equal(run.status, 'stopped');
    assert.equal(ctx.deviceLocks.queued(), 0, 'left the device queue');
    assert.ok(run.steps.every((x) => x.status === 'skipped'));
    busy.release();
    assert.equal(ctx.deviceLocks.busyIds().size, 0, 'the device is not handed to the stopped run');
  });

  it('stops a running mobile run: the step in progress ends and the device is released', async () => {
    const { ctx, mobileTest } = setup();
    const test = mobileTest('Long wait', [
      { type: 'wait', value: '50' },
      { type: 'wait', value: '20000' },
      { type: 'wait', value: '50' },
    ]);
    const started = ctx.uiRuns.start(test.id, { mode: 'mock' });
    await until(() => ctx.repos.uiRuns.get(started.id)?.steps[1].status === 'running', 'step 2');
    const t0 = Date.now();
    ctx.uiRuns.stop(started.id, 'Admin');
    const run = (await ctx.uiRuns.wait(started.id))!;
    assert.ok(Date.now() - t0 < 3_000, 'does not wait for the 20 s step');
    assert.equal(run.status, 'stopped');
    assert.equal(run.stoppedBy, 'Admin');
    assert.deepEqual(
      run.steps.map((x) => x.status),
      ['passed', 'skipped', 'skipped'],
    );
    assert.match(run.steps[1].error ?? '', /while this step was running/);
    assert.equal(run.failureReason, undefined, 'a stop is not a failure');
    assert.equal(ctx.deviceLocks.busyIds().size, 0, 'the device is free again');
  });

  it('stopping a UI test also stops the API scenario it is running', async () => {
    const { ctx, env, requests, scenario, mobileTest } = setup();
    const api = scenario('Slow API', ['/slow']);
    const test = mobileTest('With API', [
      { type: 'apiScenario', apiScenarioId: api.id },
      { type: 'wait', value: '50' },
    ]);
    const started = ctx.uiRuns.start(test.id, { mode: 'mock', environmentId: env.id });
    await until(() => requests.some((r) => r.url.endsWith('/slow')), 'the API scenario');
    ctx.uiRuns.stop(started.id);
    const run = (await ctx.uiRuns.wait(started.id))!;
    assert.equal(run.status, 'stopped');
    const apiRun = ctx.repos.runs.list().find((r) => r.scenarioId === api.id)!;
    await until(() => ctx.repos.runs.get(apiRun.id)!.status !== 'running', 'the API run to end');
    assert.equal(ctx.repos.runs.get(apiRun.id)!.status, 'stopped');
    assert.ok(requests.find((r) => r.url.endsWith('/slow'))!.aborted);
  });

  it('stops an E2E flow and every test running inside it', async () => {
    const { repos, ctx, projectId, env, requests, scenario, mobileTest } = setup();
    const slow = scenario('Slow API', ['/slow']);
    const android = mobileTest('Android', [{ type: 'wait', value: '20000' }]);
    const after = scenario('After', ['/after']);
    const flow = repos.flows.save(
      normalizeFlow(
        {
          name: 'Parallel',
          environmentId: env.id,
          nodes: [
            node('api', 'api', slow.id),
            node('mob', 'mobile', android.id, { mode: 'mock' }),
            node('next', 'api', after.id),
          ],
          edges: [edge('api', 'next'), edge('mob', 'next')],
        },
        projectId,
      ),
    );
    const started = ctx.flowRuns.start(flow.id);
    await until(
      () =>
        requests.some((r) => r.url.endsWith('/slow')) &&
        ctx.repos.uiRuns.list().some((r) => r.status === 'running' && r.steps[0].status === 'running'),
      'both branches to run',
    );
    const t0 = Date.now();
    ctx.flowRuns.stop(started.id, 'Admin');
    const run = (await ctx.flowRuns.wait(started.id))!;
    assert.ok(Date.now() - t0 < 3_000);
    assert.equal(run.status, 'stopped');
    assert.equal(run.stoppedBy, 'Admin');
    const r = (id: string) => run.nodes.find((n) => n.nodeId === id)!;
    assert.equal(r('api').status, 'stopped');
    assert.equal(r('mob').status, 'stopped');
    assert.equal(r('next').status, 'skipped');
    assert.equal(ctx.repos.runs.get(r('api').runId!)!.status, 'stopped', 'the API run stopped');
    assert.equal(ctx.repos.uiRuns.get(r('mob').runId!)!.status, 'stopped', 'the Android run stopped');
    assert.equal(
      ctx.repos.uiRuns.get(r('mob').runId!)!.stoppedBy,
      'Admin',
      'child runs know who stopped them',
    );
    assert.equal(ctx.repos.runs.get(r('api').runId!)!.stoppedBy, 'Admin');
    assert.ok(!requests.some((x) => x.url.endsWith('/after')), 'the next node never ran');
    assert.equal(ctx.deviceLocks.busyIds().size, 0);
  });

  it('stopping one run of "Run all" stops the rest of the batch', async () => {
    const { ctx, env, requests, scenario } = setup();
    const first = scenario('First', ['/slow']);
    const second = scenario('Second', ['/after']);
    ctx.runs.startBatch([first.id, second.id], env.id);
    await until(() => requests.some((r) => r.url.endsWith('/slow')), 'the first scenario');
    const run = ctx.repos.runs.list().find((r) => r.scenarioId === first.id)!;
    ctx.runs.stop(run.id);
    await ctx.runs.wait(run.id);
    await sleep(300);
    assert.ok(!ctx.repos.runs.list().some((r) => r.scenarioId === second.id), 'the second one never started');
  });
});
