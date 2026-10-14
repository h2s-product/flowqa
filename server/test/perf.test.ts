import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ApiDefinition, Environment, Scenario } from '@flowqa/shared';
import { targetVusAt, totalStageSeconds } from '@flowqa/shared';
import type { HttpClient, HttpRequest } from '../src/engine/http-client';
import { LatencyRecorder, LoadRunner, evaluateThresholds, percentile } from '../src/engine/load-runner';
import { ScenarioRunner } from '../src/engine/scenario-runner';
import { normalizePerfTest } from '../src/domain/normalizers';

const env: Environment = {
  id: 'env',
  projectId: 'p',
  name: 'Test',
  baseUrl: 'http://load.test',
  timeoutMs: 1000,
  verifySsl: true,
  proxy: '',
  variables: [],
  headers: [],
  createdAt: '',
  updatedAt: '',
};

const api: ApiDefinition = {
  id: 'api_1',
  projectId: 'p',
  name: 'Health',
  description: '',
  folderId: null,
  method: 'GET',
  path: '/health',
  auth: 'none',
  contentType: 'application/json',
  headers: [],
  query: [],
  body: [],
  exampleResponse: {},
  createdAt: '',
  updatedAt: '',
};

const scenario: Scenario = {
  id: 'scn',
  projectId: 'p',
  name: 'Health check',
  description: '',
  folderId: null,
  continueOnFailure: false,
  steps: [
    {
      id: 'st_1',
      type: 'api',
      name: 'Health',
      disabled: false,
      continueOnFailure: false,
      apiId: api.id,
      bodyMode: 'visual',
      body: [],
      bodyJson: '',
      query: [],
      headers: [],
      pathParams: {},
      tokenVariable: 'auth_token',
      captures: [],
      assertions: [],
      retries: 3,
      repeat: 1,
      timeoutMs: null,
    },
  ],
  createdAt: '',
  updatedAt: '',
};

/** Server palsu: setiap request ke-n yang habis dibagi `failEvery` mengembalikan 500. */
class FakeHttp implements HttpClient {
  calls = 0;
  inflight = 0;
  maxInflight = 0;
  constructor(private readonly failEvery = 0) {}
  async send(_request: HttpRequest) {
    const n = ++this.calls;
    this.inflight++;
    this.maxInflight = Math.max(this.maxInflight, this.inflight);
    await new Promise((r) => setTimeout(r, 20));
    this.inflight--;
    const fail = this.failEvery > 0 && n % this.failEvery === 0;
    return {
      status: fail ? 500 : 200,
      statusText: fail ? 'Internal Server Error' : 'OK',
      headers: { 'content-type': 'application/json' },
      body: { ok: !fail },
      sizeBytes: 10,
      durationMs: 20,
    };
  }
}

const loadRunner = (http: HttpClient) => {
  const findApi = (id: string) => (id === api.id ? api : undefined);
  return new LoadRunner({ runner: new ScenarioRunner({ http, findApi, sleep: async () => {} }), findApi });
};

describe('load profile', () => {
  const stages = [
    { durationSec: 10, targetVus: 10 },
    { durationSec: 10, targetVus: 10 },
    { durationSec: 5, targetVus: 0 },
  ];
  it('ramps linearly between stage targets', () => {
    assert.equal(targetVusAt(stages, 0), 0);
    assert.equal(targetVusAt(stages, 5), 5);
    assert.equal(targetVusAt(stages, 15), 10);
    assert.equal(targetVusAt(stages, 22.5), 5);
    assert.equal(targetVusAt(stages, 30), 0);
    assert.equal(totalStageSeconds(stages), 25);
  });
});

describe('metrics', () => {
  it('computes percentiles', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(sorted, 50), 50);
    assert.equal(percentile(sorted, 95), 95);
    assert.equal(percentile(sorted, 100), 100);
    assert.equal(percentile([], 95), 0);
  });
  it('keeps exact min/max/avg with a bounded sample', () => {
    const rec = new LatencyRecorder(10);
    for (let i = 1; i <= 1000; i++) rec.add(i);
    const stats = rec.stats();
    assert.equal(stats.count, 1000);
    assert.equal(stats.min, 1);
    assert.equal(stats.max, 1000);
    assert.equal(stats.avg, 501);
  });
  it('evaluates thresholds', () => {
    const latency = { count: 10, min: 1, avg: 50, p50: 40, p90: 90, p95: 120, p99: 200, max: 250 };
    const results = evaluateThresholds(
      { p95Ms: 100, errorRatePct: 5 },
      { requests: 10, errorRatePct: 2, latency },
    );
    assert.deepEqual(
      results.map((r) => r.passed),
      [false, true],
    );
    assert.equal(
      evaluateThresholds({ p95Ms: null, errorRatePct: null }, { requests: 0, errorRatePct: 0, latency })[0]
        .passed,
      false,
    );
  });
});

describe('LoadRunner', () => {
  it('runs concurrent virtual users and collects metrics', async () => {
    const http = new FakeHttp(4);
    const ticks: number[] = [];
    const result = await loadRunner(http).execute(scenario, env, {
      stages: [{ durationSec: 2, targetVus: 4 }],
      thinkTimeMs: 0,
      onTick: (s) => ticks.push(s.timeline.length),
    });
    assert.equal(result.aborted, false);
    assert.ok(result.peakVus >= 3, `peak ${result.peakVus}`);
    assert.ok(http.maxInflight > 1, 'requests should overlap');
    assert.equal(result.requests, http.calls, 'retries must be disabled under load');
    assert.equal(result.errors, Math.floor(http.calls / 4));
    assert.equal(result.statusCodes['500'], result.errors);
    assert.equal(result.steps[0].path, '/health');
    assert.equal(result.timeline.length, 2);
    assert.deepEqual(ticks, [1, 2]);
    assert.ok(result.topErrors[0].message.startsWith('Health:'));
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    const result = await loadRunner(new FakeHttp()).execute(scenario, env, {
      stages: [{ durationSec: 30, targetVus: 2 }],
      thinkTimeMs: 5000,
      signal: controller.signal,
    });
    assert.equal(result.aborted, true);
    assert.ok(Date.now() - started < 2000);
  });
});

describe('normalizePerfTest', () => {
  it('fills defaults and clamps values', () => {
    const test = normalizePerfTest(
      {
        name: 'Load',
        scenarioId: 'scn',
        stages: [{ durationSec: 10, targetVus: 9999 }],
        thresholds: { p95Ms: '' },
      },
      'p',
    );
    assert.equal(test.stages[0].targetVus, 500);
    assert.equal(test.type, 'load');
    assert.equal(test.thresholds.p95Ms, null);
  });
  it('rejects a profile without virtual users', () => {
    assert.throws(() =>
      normalizePerfTest({ name: 'x', scenarioId: 's', stages: [{ durationSec: 10, targetVus: 0 }] }, 'p'),
    );
  });
});
