/**
 * "Bila step gagal, ulangi dari step X": penjalan kembali ke step X, dan
 * "Save element text" di bagian yang diulang memakai nilai lain yang belum
 * dicoba di run ini (mis. pelanggan berikutnya bila unitnya habis).
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `retry-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');

function setup() {
  const repos = createRepositories(openDatabase(':memory:'));
  const ctx = createAppContext(repos, {} as never, null);
  ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
  const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
  /** Login → simpan pesanan → cek pesanan (gagal sampai `wanted`), bila gagal ulangi dari "simpan pesanan". */
  const make = (wanted: string, retryMax: number) => {
    const steps = [
      { type: 'fill', selectors: ['id=com.demo:id/email'], value: 'qa@demo.test' },
      { type: 'fill', selectors: ['id=com.demo:id/password'], value: 'pw', sensitive: true },
      { type: 'click', selectors: ['~login'] },
      { type: 'saveText', selectors: ['id=com.demo:id/order'], saveAs: 'order' },
      { type: 'assertText', selectors: ['text={{order}}'], value: wanted, timeoutMs: 500 },
    ].map((s) => normalizeUiStep(s));
    steps[4] = normalizeUiStep({ ...steps[4], retryFrom: steps[3].id, retryMax });
    return repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Retry',
          target: 'mobile',
          mobile: { platform: 'android', app: '', appPackage: 'com.demo' },
          steps,
        },
        projectId,
      ),
    );
  };
  const run = async (testId: string) =>
    (await ctx.uiRuns.wait(ctx.uiRuns.start(testId, { mode: 'mock' }).id))!;
  return { make, run };
}

describe('Retry from an earlier step', () => {
  it('goes back and tries the next value until the check passes', async () => {
    const { make, run } = setup();
    const result = await run(make('Order 3 - Paid', 5).id);
    assert.equal(result.status, 'passed', result.failureReason);
    assert.equal(result.variables?.order, 'Order 3 - Paid', 'orders 1 and 2 were tried and skipped');
    assert.match(result.steps[3].detail ?? '', /skipped 2 already used/);
    assert.match(result.steps[4].detail ?? '', /passed on attempt 3/);
    assert.ok(result.steps.every((s) => s.status === 'passed'));
  });

  it('stops after the allowed number of retries and explains every attempt', async () => {
    const { make, run } = setup();
    const result = await run(make('Order 99 - Paid', 2).id);
    assert.equal(result.status, 'failed');
    assert.equal(result.variables?.order, 'Order 3 - Paid', 'tried orders 1, 2 and 3');
    assert.match(result.steps[4].error ?? '', /after 2 retries: attempt 1 failed: .* \| attempt 2 failed/);
  });
});
