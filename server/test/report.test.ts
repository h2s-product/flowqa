import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Run, StepStatus, UiRun, UiStepStatus } from '@flowqa/shared';
import { openDatabase } from '../src/db/database';
import { createRepositories } from '../src/repositories';
import { FolderService } from '../src/services/folder-service';
import { normalizeProject, normalizeScenario, normalizeUiTest } from '../src/domain/normalizers';
import { buildApiReport, buildUiReport } from '../src/services/report-service';

function setup() {
  const repos = createRepositories(openDatabase(':memory:'));
  const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
  const folders = new FolderService(repos.scenarioFolders, repos.scenarios, 'scenario');
  const smoke = folders.create(projectId, { name: 'Smoke' });
  const nested = folders.create(projectId, { name: 'Nested', parentId: smoke.id });
  const scenario = (name: string, folderId: string | null) =>
    repos.scenarios.save(
      normalizeScenario(
        {
          name,
          folderId,
          steps: [
            { type: 'wait', name: 'First', durationMs: 0 },
            { type: 'wait', name: 'Second', durationMs: 0 },
          ],
        },
        projectId,
      ),
    );
  let n = 0;
  const run = (
    s: ReturnType<typeof scenario>,
    statuses: StepStatus[],
    startedAt: string,
    environmentId = 'env_a',
  ): Run => {
    const failed = statuses.includes('failed');
    return repos.runs.save({
      id: `run_${++n}`,
      projectId,
      scenarioId: s.id,
      scenarioName: s.name,
      environmentId,
      environmentName: environmentId,
      status: failed ? 'failed' : 'passed',
      trigger: 'manual',
      mode: 'Full run',
      startedAt,
      finishedAt: startedAt,
      durationMs: 100 * n,
      steps: s.steps.map((st, index) => ({
        index,
        stepId: st.id,
        name: st.name,
        type: st.type,
        status: statuses[index],
        startedAt: statuses[index] === 'skipped' ? undefined : startedAt,
        durationMs: 10,
        explanation:
          statuses[index] === 'failed' ? { title: 'Status was 500', detail: '', fix: '' } : undefined,
      })),
      counts: { total: 2, passed: 0, failed: 0, skipped: 0 },
      variables: {},
      createdAt: startedAt,
      updatedAt: startedAt,
    });
  };
  return { repos, projectId, scenario, run, smoke, nested };
}

const period = {
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-09-30T23:59:59.999Z',
  environmentId: null,
  folderId: null,
};

describe('buildApiReport', () => {
  it('summarises runs and the status of every step', () => {
    const { repos, projectId, scenario, run } = setup();
    const checkout = scenario('Checkout', null);
    const login = scenario('Login', null);
    scenario('Never run', null);
    run(checkout, ['passed', 'passed'], '2026-09-10T10:00:00.000Z');
    run(checkout, ['passed', 'failed'], '2026-09-11T10:00:00.000Z');
    run(login, ['passed', 'skipped'], '2026-09-12T10:00:00.000Z');
    run(login, ['passed', 'passed'], '2026-08-01T10:00:00.000Z'); // di luar periode

    const report = buildApiReport(repos, projectId, period);
    assert.equal(report.summary.runs, 3);
    assert.equal(report.summary.passRate, 66.7);
    assert.deepEqual(report.summary.steps, { passed: 4, failed: 1, skipped: 1, notRun: 0 });
    assert.deepEqual(report.itemStatus, { passing: 1, failing: 1, notExecuted: 1 });
    assert.deepEqual(
      report.items.map((s) => s.name),
      ['Checkout', 'Login', 'Never run'],
      'failing first, never-run last',
    );

    const c = report.items[0];
    assert.equal(c.runs, 2);
    assert.equal(c.lastRun?.status, 'failed');
    assert.deepEqual(
      c.steps.map((s) => [s.name, s.lastStatus, s.passed, s.failed]),
      [
        ['First', 'passed', 2, 0],
        ['Second', 'failed', 1, 1],
      ],
    );
    assert.equal(c.steps[1].lastNote, 'Status was 500');
    assert.equal(c.steps[0].lastStartedAt, '2026-09-11T10:00:00.000Z', 'time the step ran in the last run');
    assert.equal(report.items[2].lastRun, null);
    assert.equal(report.items[2].steps[0].lastStatus, null);
  });

  it('filters by environment and by folder (including subfolders)', () => {
    const { repos, projectId, scenario, run, smoke, nested } = setup();
    const inSmoke = scenario('In smoke', smoke.id);
    const inNested = scenario('In nested', nested.id);
    const outside = scenario('Outside', null);
    run(inSmoke, ['passed', 'passed'], '2026-09-10T10:00:00.000Z', 'env_a');
    run(inNested, ['passed', 'passed'], '2026-09-10T11:00:00.000Z', 'env_b');
    run(outside, ['passed', 'passed'], '2026-09-10T12:00:00.000Z', 'env_a');

    const byEnv = buildApiReport(repos, projectId, { ...period, environmentId: 'env_a' });
    assert.equal(byEnv.summary.runs, 2);

    const byFolder = buildApiReport(repos, projectId, { ...period, folderId: smoke.id });
    assert.deepEqual(byFolder.items.map((s) => s.name).sort(), ['In nested', 'In smoke']);
    assert.equal(byFolder.summary.runs, 2);
  });
});

describe('buildUiReport', () => {
  it('reports UI test cases with the same shape, per folder, with the browser as run target', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const folders = new FolderService(repos.uiFolders, repos.uiTests, 'UI test');
    const shop = folders.create(projectId, { name: 'Shop' });
    const test = (name: string, folderId: string | null) =>
      repos.uiTests.save(
        normalizeUiTest(
          {
            name,
            folderId,
            startUrl: 'https://shop.example.com',
            steps: [
              { type: 'navigate', value: 'https://shop.example.com', description: 'Open shop' },
              { type: 'click', selectors: ['#buy'], description: 'Click "Buy" button' },
            ],
          },
          projectId,
        ),
      );
    let n = 0;
    const run = (t: ReturnType<typeof test>, statuses: UiStepStatus[], startedAt: string): UiRun =>
      repos.uiRuns.save({
        id: `uir_${++n}`,
        projectId,
        testCaseId: t.id,
        testName: t.name,
        status: statuses.includes('failed') ? 'failed' : 'passed',
        trigger: 'manual',
        headless: true,
        browser: 'Google Chrome 153.0.1',
        startedAt,
        finishedAt: startedAt,
        durationMs: 1000,
        counts: { total: 2, passed: 0, failed: 0, skipped: 0 },
        steps: t.steps.map((st, index) => ({
          index,
          stepId: st.id,
          description: st.description,
          type: st.type,
          status: statuses[index],
          startedAt,
          durationMs: 50,
          error: statuses[index] === 'failed' ? 'Could not find the element' : undefined,
        })),
        createdAt: startedAt,
        updatedAt: startedAt,
      });

    const buy = test('Buy', shop.id);
    const other = test('Other', null);
    const recovered = test('Recovered', null);
    test('Never run', null);
    run(buy, ['passed', 'passed'], '2026-09-10T10:00:00.000Z');
    run(buy, ['passed', 'failed'], '2026-09-11T10:00:00.000Z');
    run(other, ['passed', 'passed'], '2026-09-12T10:00:00.000Z');
    run(recovered, ['passed', 'failed'], '2026-09-12T10:00:00.000Z');
    run(recovered, ['passed', 'passed'], '2026-09-13T10:00:00.000Z');

    const report = buildUiReport(repos, projectId, period);
    assert.equal(report.kind, 'ui');
    assert.equal(report.summary.runs, 5);
    // Status = run terbaru: "Recovered" gagal dulu lalu lulus → passing.
    assert.deepEqual(report.itemStatus, { passing: 2, failing: 1, notExecuted: 1 });
    assert.deepEqual(
      report.items.map((i) => [i.name, i.status]),
      [
        ['Buy', 'failing'],
        ['Other', 'passing'],
        ['Recovered', 'passing'],
        ['Never run', 'not-executed'],
      ],
    );
    const [first] = report.items;
    assert.equal(first.lastRun?.target, 'Google Chrome · headless');
    assert.equal(first.lastRun?.failedStep, 'Click "Buy" button');
    assert.deepEqual(
      first.steps.map((s) => [s.name, s.lastStatus, s.passed, s.failed, s.lastNote]),
      [
        ['Open shop', 'passed', 2, 0, null],
        ['Click "Buy" button', 'failed', 1, 1, 'Could not find the element'],
      ],
    );

    const inShop = buildUiReport(repos, projectId, { ...period, folderId: shop.id });
    assert.deepEqual(
      inShop.items.map((i) => i.name),
      ['Buy'],
    );
    assert.equal(inShop.summary.runs, 2);
  });
});
