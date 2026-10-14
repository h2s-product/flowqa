/** UI Tester: test case, run, dan screenshot hasil run. */
import fs from 'node:fs';
import { Router } from 'express';
import type { UiTestCase } from '@flowqa/shared';
import { MOBILE_EXECUTION_MODES, UI_RUN_PACES, createId } from '@flowqa/shared';
import { config } from '../config';
import { demoUiTestInput } from '../demo/demo-web';
import { manualBookFileName, renderManualBook } from '../domain/manual-book';
import { normalizeUiTest } from '../domain/normalizers';
import { presentUiTest, restoreUiSecrets, summarizeUiRun } from '../domain/presenters';
import { HttpError, asyncHandler } from '../lib/http';
import { nowIso } from '../lib/time';
import { currentUser, requireOwned, requireProject, type AppContext } from './context';
import { addRunDeletionRoutes } from './run-deletion';

/** Batas jumlah UI test per bulk run. */
const MAX_BATCH_RUN = 200;

export function uiTestRoutes(ctx: AppContext): Router {
  const router = Router();
  const tests = ctx.repos.uiTests;

  /* ------------------------------ test cases ------------------------------ */

  router.get(
    '/projects/:projectId/ui-tests',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(
        tests.list({ project_id: req.params.projectId }).map((t) => {
          const [last] = ctx.repos.uiRuns.recent({ parentId: t.id }, 1);
          return { ...presentUiTest(t), lastRun: last ? summarizeUiRun(last) : null };
        }),
      );
    }),
  );

  router.post(
    '/projects/:projectId/ui-tests',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const test = normalizeUiTest(req.body ?? {}, req.params.projectId);
      ctx.uiFolders.assertFolder(test.projectId, test.folderId);
      res.status(201).json(presentUiTest(tests.save(test)));
    }),
  );

  /** Buat contoh UI test untuk demo shop bawaan (/demo-web). */
  router.post(
    '/projects/:projectId/ui-tests/demo',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const test = normalizeUiTest(demoUiTestInput(config.publicUrl), req.params.projectId);
      res.status(201).json(presentUiTest(tests.save(test)));
    }),
  );

  router.post(
    '/projects/:projectId/ui-tests/move',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json({
        moved: ctx.uiFolders.moveItems(req.params.projectId, req.body?.testIds, req.body?.folderId ?? null),
      });
    }),
  );

  router.get(
    '/ui-tests/:id',
    asyncHandler((req, res) => {
      res.json(presentUiTest(requireOwned(ctx, res, tests.get(req.params.id), 'UI test')));
    }),
  );

  /**
   * Manual Book (HTML mandiri, gambar disisipkan): langkah-langkah test lengkap
   * dengan screenshot. Sumber screenshot: `runId`, atau run terakhir yang lulus,
   * atau run terakhir yang punya screenshot. `inline=1` untuk dibuka di browser.
   */
  router.get(
    '/ui-tests/:id/manual',
    asyncHandler((req, res) => {
      const test = requireOwned(ctx, res, tests.get(req.params.id), 'UI test');
      const runs = ctx.repos.uiRuns.recent({ parentId: test.id }, 100);
      const hasShots = (r: (typeof runs)[number]) => r.steps.some((s) => s.screenshot);
      const wanted = typeof req.query.runId === 'string' ? req.query.runId : '';
      const run = wanted
        ? (runs.find((r) => r.id === wanted) ?? ctx.repos.uiRuns.get(wanted))
        : (runs.find((r) => r.status === 'passed' && hasShots(r)) ?? runs.find(hasShots));
      if (wanted && (!run || run.testCaseId !== test.id))
        throw new HttpError(404, 'That run does not belong to this test.');
      const folders: string[] = [];
      for (let id = test.folderId, guard = 0; id && guard < 20; guard++) {
        const folder = ctx.repos.uiFolders.get(id);
        if (!folder) break;
        folders.unshift(folder.name);
        id = folder.parentId ?? null;
      }
      const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
      const html = renderManualBook({
        test: presentUiTest(test),
        run,
        image: (file) => {
          const full = run ? ctx.uiRuns.screenshotPath(run.id, file) : null;
          if (!full || !fs.existsSync(full)) return null;
          const ext = file.split('.').pop()!.toLowerCase();
          return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${fs.readFileSync(full).toString('base64')}`;
        },
        projectName: ctx.repos.projects.get(test.projectId)?.name ?? '',
        folderPath: folders.join(' › '),
        generatedAt: new Date(),
      });
      const name = manualBookFileName(test);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Disposition',
        `${req.query.inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      res.send(html);
    }),
  );

  router.put(
    '/ui-tests/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, tests.get(req.params.id), 'UI test');
      const test = normalizeUiTest(restoreUiSecrets(req.body ?? {}, existing), existing.projectId, existing);
      ctx.uiFolders.assertFolder(test.projectId, test.folderId);
      res.json(presentUiTest(tests.save(test)));
    }),
  );

  router.post(
    '/ui-tests/:id/duplicate',
    asyncHandler((req, res) => {
      const source = requireOwned(ctx, res, tests.get(req.params.id), 'UI test');
      const now = nowIso();
      const copy: UiTestCase = {
        ...structuredClone(source),
        id: createId('uit'),
        name: `${source.name} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      // Step baru mendapat id baru; rujukan "ulangi dari step X" ikut dipetakan.
      const ids = new Map<string, string>();
      copy.steps.forEach((s) => {
        const id = createId('us');
        ids.set(s.id, id);
        s.id = id;
      });
      copy.steps.forEach((s) => {
        if (s.retryFrom) s.retryFrom = ids.get(s.retryFrom);
      });
      res.status(201).json(presentUiTest(tests.save(copy)));
    }),
  );

  router.delete(
    '/ui-tests/:id',
    asyncHandler((req, res) => {
      tests.delete(requireOwned(ctx, res, tests.get(req.params.id), 'UI test').id);
      res.status(204).end();
    }),
  );

  /* --------------------------------- runs --------------------------------- */

  router.post(
    '/ui-tests/:id/run',
    asyncHandler((req, res) => {
      const test = requireOwned(ctx, res, tests.get(req.params.id), 'UI test');
      const run = ctx.uiRuns.start(test.id, {
        headless: req.body?.headless !== false,
        pace: UI_RUN_PACES.find((p) => p === req.body?.pace),
        environmentId: req.body?.environmentId || null,
        mode: MOBILE_EXECUTION_MODES.find((m) => m === req.body?.mode),
      });
      res.status(202).json(run);
    }),
  );

  /** Jalankan banyak UI test berurutan (bulk run dari UI Test Cases). */
  router.post(
    '/projects/:projectId/ui-tests/run-batch',
    asyncHandler((req, res) => {
      const { projectId } = req.params;
      requireProject(ctx, res, projectId);
      const ids: unknown = req.body?.ids;
      if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string'))
        throw new HttpError(400, 'Choose at least one UI test to run');
      if (ids.length > MAX_BATCH_RUN)
        throw new HttpError(400, `Run at most ${MAX_BATCH_RUN} UI tests at a time`);
      const { queued, skipped } = ctx.uiRuns.startBatch(projectId, ids, {
        headless: req.body?.headless !== false,
        environmentId: req.body?.environmentId || null,
        mode: MOBILE_EXECUTION_MODES.find((m) => m === req.body?.mode),
      });
      if (!queued.length) throw new HttpError(400, 'None of the selected UI tests has steps to run yet');
      res.status(202).json({ queued: queued.length, skipped: skipped.map((t) => t.name) });
    }),
  );

  router.get(
    '/projects/:projectId/ui-runs',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const testId = typeof req.query.testId === 'string' ? req.query.testId : undefined;
      const limit = Math.min(200, Number(req.query.limit) || 100);
      res.json(
        ctx.repos.uiRuns
          .recent({ projectId: req.params.projectId, parentId: testId }, limit)
          .map(summarizeUiRun),
      );
    }),
  );

  router.get(
    '/ui-runs/:id',
    asyncHandler((req, res) => {
      res.json(requireOwned(ctx, res, ctx.repos.uiRuns.get(req.params.id), 'UI run'));
    }),
  );

  /** Stop: hentikan UI run (web/mobile) yang berjalan atau masih antre perangkat. */
  router.post(
    '/ui-runs/:id/stop',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, ctx.repos.uiRuns.get(req.params.id), 'UI run');
      res.status(202).json(ctx.uiRuns.stop(run.id, currentUser(res).name));
    }),
  );

  router.get(
    '/ui-runs/:id/screenshots/:file',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, ctx.repos.uiRuns.get(req.params.id), 'UI run');
      const file = ctx.uiRuns.screenshotPath(run.id, req.params.file);
      if (!file || !fs.existsSync(file)) throw new HttpError(404, 'Screenshot not found');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(file);
    }),
  );

  addRunDeletionRoutes(router, ctx, 'ui', 'ui-runs', 'UI run');

  return router;
}
