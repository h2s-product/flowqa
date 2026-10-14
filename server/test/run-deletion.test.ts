/** Hapus UI run: data di database dan screenshot di disk ikut terhapus. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { UiRun } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-artifacts-'));
const { config } = await import('../src/config');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject } = await import('../src/domain/normalizers');
const { DeletionService } = await import('../src/services/deletion-service');

describe('DeletionService.deleteRuns', () => {
  it('removes UI runs with their screenshots, but not running ones', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const now = new Date().toISOString();
    const uiRun = (id: string, status: UiRun['status']) => {
      repos.uiRuns.save({
        id,
        projectId,
        testCaseId: 'uit_x',
        testName: 'X',
        status,
        trigger: 'manual',
        headless: true,
        browser: 'Google Chrome',
        startedAt: now,
        finishedAt: now,
        durationMs: 1,
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        steps: [],
        createdAt: now,
        updatedAt: now,
      });
      const dir = path.join(config.uiArtifactsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'step-1.jpg'), 'x');
      return dir;
    };
    const doneDir = uiRun('uir_done', 'passed');
    const runningDir = uiRun('uir_running', 'running');

    const result = new DeletionService(repos).deleteRuns('ui', projectId, ['uir_done', 'uir_running']);
    assert.deepEqual(result, { deleted: 1, running: 1 });
    assert.equal(repos.uiRuns.get('uir_done'), undefined);
    assert.equal(fs.existsSync(doneDir), false, 'screenshots are removed');
    assert.ok(repos.uiRuns.get('uir_running') && fs.existsSync(runningDir));
    fs.rmSync(config.uiArtifactsDir, { recursive: true, force: true });
  });
});
