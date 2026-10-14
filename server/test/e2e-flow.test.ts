/**
 * E2E Flow lintas platform: API scenario → test Android (Mock Mode) → API scenario,
 * dengan variabel yang mengalir mengikuti panah, cabang paralel, jeda, node yang
 * dilewati saat pendahulunya gagal, "continue on fail", dan validasi graf.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { FlowEdge, FlowNode } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `e2e-artifacts-${process.pid}`, 'ui');
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

function setup() {
  const requests: { url: string; body?: unknown }[] = [];
  const http = {
    async send(request: { url: string; body?: unknown }) {
      requests.push({ url: request.url, body: request.body });
      const fail = request.url.endsWith('/fail');
      return {
        status: fail ? 500 : 201,
        statusText: fail ? 'Internal Server Error' : 'Created',
        headers: { 'content-type': 'application/json' },
        body: fail ? { error: 'boom' } : { id: 'ORD-77', token: 'tok-secret-123' },
        sizeBytes: 20,
        durationMs: 5,
      };
    },
  };
  const repos = createRepositories(openDatabase(':memory:'));
  const ctx = createAppContext(repos, http as never, null);
  // Test Android di node memakai Mock Mode (tanpa perangkat); jangan pernah menyalakan Appium sungguhan.
  ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
  const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
  const env = repos.environments.save(
    normalizeEnvironment({ name: 'Dev', baseUrl: 'http://api.test' }, projectId),
  );
  const scenario = (
    name: string,
    apiPath: string,
    body: string,
    captures: { field: string; variable: string }[] = [],
  ) => {
    const api = repos.apis.save(normalizeApi({ name, method: 'POST', path: apiPath }, projectId));
    return repos.scenarios.save(
      normalizeScenario(
        {
          name,
          steps: [
            {
              type: 'api',
              name,
              apiId: api.id,
              bodyMode: 'json',
              bodyJson: body,
              captures,
              assertions: [{ kind: 'status', operator: 'equals', expected: '201' }],
            },
          ],
        },
        projectId,
      ),
    );
  };
  const mobileTest = (name: string, steps: Record<string, unknown>[]) =>
    repos.uiTests.save(
      normalizeUiTest(
        { name, target: 'mobile', mobile: APP, steps: steps.map((s) => normalizeUiStep(s)) },
        projectId,
      ),
    );
  return { repos, ctx, projectId, env, requests, scenario, mobileTest };
}

const node = (
  id: string,
  kind: FlowNode['kind'],
  refId: string | null,
  label: string,
  config: FlowNode['config'] = {},
): FlowNode => ({
  id,
  kind,
  refId,
  label,
  x: 0,
  y: 0,
  config,
});
const edge = (from: string, to: string): FlowEdge => ({ id: `${from}-${to}`, from, to });

describe('E2E Flow', () => {
  it('passes variables across platforms: API → Android → API', async () => {
    const { repos, ctx, projectId, env, requests, scenario, mobileTest } = setup();
    const create = scenario('Mobile API: create order', '/orders', '{"customer":"Budi"}', [
      { field: 'id', variable: 'order_id' },
      { field: 'token', variable: 'auth_token' },
    ]);
    const android = mobileTest('Android: check order', [
      { type: 'fill', selectors: ['id=com.demo:id/email'], value: '{{order_id}}' },
      { type: 'fill', selectors: ['id=com.demo:id/password'], value: 'pw', sensitive: true },
      { type: 'click', selectors: ['~login'] },
      { type: 'assertText', selectors: ['id=com.demo:id/welcome'], value: 'ORD-77' },
      { type: 'setVariable', saveAs: 'approval', value: 'APPROVED-{{order_id}}' },
    ]);
    const approve = scenario(
      'Backoffice API: approve',
      '/approve',
      '{"order":"{{order_id}}","note":"{{approval}}"}',
    );
    const flow = repos.flows.save(
      normalizeFlow(
        {
          name: 'Order approval',
          environmentId: env.id,
          nodes: [
            node('s', 'start', null, 'Start'),
            node('a', 'api', create.id, create.name),
            node('m', 'mobile', android.id, android.name, { mode: 'mock' }),
            node('w', 'wait', null, 'Wait', { waitMs: 50 }),
            node('b', 'api', approve.id, approve.name),
          ],
          edges: [edge('s', 'a'), edge('a', 'm'), edge('m', 'w'), edge('w', 'b')],
        },
        projectId,
      ),
    );
    const run = (await ctx.flowRuns.wait(ctx.flowRuns.start(flow.id).id))!;
    assert.equal(run.status, 'passed', JSON.stringify(run.nodes, null, 1));
    const result = (id: string) => run.nodes.find((n) => n.nodeId === id)!;
    assert.deepEqual(
      run.nodes.map((n) => n.status),
      ['passed', 'passed', 'passed', 'passed', 'passed'],
    );
    assert.deepEqual(result('a').outputs?.sort(), ['auth_token', 'order_id']);
    assert.equal(result('a').runKind, 'api');
    assert.equal(result('m').runKind, 'ui');
    assert.deepEqual(result('m').outputs, ['approval'], 'the Android test produced a new variable');
    // Node terakhir menerima variabel dari API pertama dan dari test Android.
    assert.deepEqual(requests.at(-1)!.body, { order: 'ORD-77', note: 'APPROVED-ORD-77' });
    // Urutan: node mulai setelah pendahulunya selesai.
    assert.ok(result('m').startedAt! >= result('a').finishedAt!);
    assert.ok(result('b').startedAt! >= result('w').finishedAt!);
    // Variabel akhir disimpan, yang rahasia disamarkan.
    assert.equal(run.variables.order_id, 'ORD-77');
    assert.equal(run.variables.auth_token, '****');
    assert.ok(
      !JSON.stringify(repos.flowRuns.get(run.id)).includes('tok-secret-123'),
      'the token is not stored',
    );
    const uiRun = repos.uiRuns.get(result('m').runId!)!;
    assert.equal(uiRun.trigger, 'flow');
    assert.equal(uiRun.variables?.auth_token, '****');
  });

  it('runs branches in parallel, skips after a failure, and honours "continue on fail"', async () => {
    const { repos, ctx, projectId, env, scenario } = setup();
    const ok = scenario('OK', '/orders', '{}');
    const broken = scenario('Broken', '/fail', '{}');
    const flow = repos.flows.save(
      normalizeFlow(
        {
          name: 'Branches',
          environmentId: env.id,
          nodes: [
            node('w1', 'wait', null, 'Wait A', { waitMs: 300 }),
            node('w2', 'wait', null, 'Wait B', { waitMs: 300 }),
            node('join', 'api', ok.id, 'After both'),
            node('bad', 'api', broken.id, 'Broken'),
            node('afterBad', 'api', ok.id, 'After broken'),
            node('soft', 'api', broken.id, 'Broken but continue', { continueOnFail: true }),
            node('afterSoft', 'api', ok.id, 'After soft failure'),
          ],
          edges: [edge('w1', 'join'), edge('w2', 'join'), edge('bad', 'afterBad'), edge('soft', 'afterSoft')],
        },
        projectId,
      ),
    );
    const started = Date.now();
    const run = (await ctx.flowRuns.wait(ctx.flowRuns.start(flow.id).id))!;
    const r = (id: string) => run.nodes.find((n) => n.nodeId === id)!;
    assert.ok(Date.now() - started < 1_500, 'the two 300 ms waits ran at the same time');
    assert.equal(r('join').status, 'passed', 'runs after BOTH branches');
    assert.ok(r('join').startedAt! >= r('w1').finishedAt! && r('join').startedAt! >= r('w2').finishedAt!);
    assert.equal(r('bad').status, 'failed');
    assert.equal(r('afterBad').status, 'skipped');
    assert.equal(r('soft').status, 'failed');
    assert.equal(r('afterSoft').status, 'passed', 'continue on fail lets the next node run');
    assert.equal(run.status, 'failed');
    assert.match(run.failureReason!, /Broken/);
  });

  it('validates the graph', () => {
    const { repos, ctx, projectId, env, scenario } = setup();
    const ok = scenario('OK', '/orders', '{}');
    assert.throws(
      () =>
        normalizeFlow(
          {
            name: 'Loop',
            nodes: [node('a', 'wait', null, 'A'), node('b', 'wait', null, 'B')],
            edges: [edge('a', 'b'), edge('b', 'a')],
          },
          projectId,
        ),
      /loop/,
    );
    const cleaned = normalizeFlow(
      {
        name: 'Clean',
        nodes: [node('a', 'wait', null, 'A')],
        edges: [edge('a', 'a'), edge('a', 'gone'), edge('a', 'a')],
      },
      projectId,
    );
    assert.deepEqual(cleaned.edges, [], 'self, dangling and duplicate arrows are dropped');
    const noEnv = repos.flows.save(
      normalizeFlow({ name: 'No env', nodes: [node('a', 'api', ok.id, 'OK')] }, projectId),
    );
    assert.throws(() => ctx.flowRuns.start(noEnv.id), /Choose an environment/);
    const missing = repos.flows.save(
      normalizeFlow(
        { name: 'Missing', environmentId: env.id, nodes: [node('a', 'web', 'uit_gone', 'Deleted test')] },
        projectId,
      ),
    );
    assert.throws(() => ctx.flowRuns.start(missing.id), /no longer exists/);
    const empty = repos.flows.save(
      normalizeFlow({ name: 'Empty', nodes: [node('s', 'start', null, 'Start')] }, projectId),
    );
    assert.throws(() => ctx.flowRuns.start(empty.id), /at least one test case/);
  });
});
