/**
 * Test Case ID (TC-xxxx): berurutan, unik, tidak berubah saat test diedit,
 * duplikat mendapat ID baru, nomor test yang dihapus tidak dipakai ulang, dan
 * test lama diberi ID otomatis sesuai urutan dibuat.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { UiTestCase } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `test-code-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');

const web = (name: string) => ({
  name,
  startUrl: 'https://example.test',
  steps: [{ type: 'wait', value: '1' }],
});

describe('Test Case ID (TC-xxxx)', () => {
  it('numbers new tests in order and never changes or reuses an ID', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const a = repos.uiTests.save(normalizeUiTest(web('A'), projectId));
    const b = repos.uiTests.save(normalizeUiTest(web('B'), projectId));
    assert.equal(a.code, 'TC-0001');
    assert.equal(b.code, 'TC-0002');

    // Edit (termasuk mencoba mengganti code lewat input) tidak mengubah ID.
    const edited = repos.uiTests.save(
      normalizeUiTest({ ...web('A renamed'), code: 'TC-9999' }, projectId, a),
    );
    assert.equal(edited.code, 'TC-0001');
    assert.equal(repos.uiTests.get(a.id)!.code, 'TC-0001');
    // Dokumen tanpa code (mis. dibangun ulang) tetap memakai code lamanya.
    const { code: _drop, ...rebuilt } = repos.uiTests.get(a.id)!;
    assert.equal(repos.uiTests.save(rebuilt as UiTestCase).code, 'TC-0001');

    // Duplikat yang menyalin code → diberi ID baru.
    const copy = repos.uiTests.save({ ...structuredClone(b), id: 'uit_copy', name: 'B (copy)' });
    assert.equal(copy.code, 'TC-0003');
    assert.equal(repos.uiTests.get(b.id)!.code, 'TC-0002', 'the original keeps its ID');

    // Nomor test yang dihapus tidak dipakai ulang.
    repos.uiTests.delete(copy.id);
    assert.equal(repos.uiTests.save(normalizeUiTest(web('C'), projectId)).code, 'TC-0004');
    assert.equal(repos.uiTests.findByCode('tc-0002')!.id, b.id);
  });

  it('gives existing tests an ID once, in the order they were created', () => {
    const db = openDatabase(':memory:');
    const first = createRepositories(db);
    const projectId = first.projects.save(normalizeProject({ name: 'P' })).id;
    // Test lama dari sebelum fitur ini: tanpa code.
    for (const [id, name, createdAt] of [
      ['uit_new', 'Newer', '2026-09-02T00:00:00.000Z'],
      ['uit_old', 'Older', '2026-09-01T00:00:00.000Z'],
    ])
      db.prepare(
        'INSERT INTO ui_tests (id, project_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(
        id,
        projectId,
        JSON.stringify({ ...normalizeUiTest(web(name), projectId), id, createdAt, updatedAt: createdAt }),
        createdAt,
        createdAt,
      );
    const repos = createRepositories(db); // saat server start
    assert.equal(repos.uiTests.get('uit_old')!.code, 'TC-0001');
    assert.equal(repos.uiTests.get('uit_new')!.code, 'TC-0002');
    assert.equal(createRepositories(db).uiTests.get('uit_old')!.code, 'TC-0001', 'stable across restarts');
  });

  it('shows the Test Case ID on the run', async () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, {} as never, null);
    ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'M',
          target: 'mobile',
          mobile: { platform: 'android', app: '', appPackage: 'com.demo' },
          steps: [{ type: 'wait', value: '1' }],
        },
        projectId,
      ),
    );
    const run = (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, { mode: 'mock' }).id))!;
    assert.equal(run.testCode, test.code);
  });
});
