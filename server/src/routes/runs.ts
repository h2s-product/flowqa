import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/http';
import { descendantIds } from '../services/folder-service';
import { currentUser, requireOwned, requireProject, type AppContext } from './context';
import { addRunDeletionRoutes } from './run-deletion';
import { assertProjectEnvironment } from '../domain/guards';
import { summarizeRun } from '../domain/presenters';

export function runRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post(
    '/runs',
    asyncHandler((req, res) => {
      const { scenarioId, environmentId, fromStep, onlySteps } = req.body ?? {};
      if (!scenarioId || !environmentId)
        throw new HttpError(400, '"scenarioId" and "environmentId" are required');
      requireOwned(ctx, res, ctx.repos.scenarios.get(scenarioId), 'Scenario');
      const run = ctx.runs.start({
        scenarioId,
        environmentId,
        fromStep: Number.isInteger(fromStep) ? fromStep : undefined,
        onlySteps: Array.isArray(onlySteps) ? onlySteps.filter(Number.isInteger) : undefined,
      });
      res.status(202).json(run);
    }),
  );

  /**
   * Jalankan semua scenario project secara berurutan. `folderId` (opsional)
   * membatasi ke scenario di folder itu beserta semua subfoldernya.
   */
  router.post(
    '/projects/:projectId/run-all',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      // Validasi sebelum merespons: error setelah 202 tidak bisa lagi dikirim ke client.
      const environmentId = assertProjectEnvironment(
        ctx.repos,
        req.params.projectId,
        req.body?.environmentId,
      ).id;
      const folderId = ctx.scenarioFolders.assertFolder(req.params.projectId, req.body?.folderId);
      const inFolder = folderId
        ? new Set([folderId, ...descendantIds(ctx.scenarioFolders.list(req.params.projectId), folderId)])
        : null;
      const scenarios = ctx.repos.scenarios
        .list({ project_id: req.params.projectId })
        .filter((s) => s.steps.length && (!inFolder || (s.folderId && inFolder.has(s.folderId))));
      ctx.runs.startBatch(
        scenarios.map((s) => s.id),
        environmentId,
      );
      res.status(202).json({ queued: scenarios.length });
    }),
  );

  router.get(
    '/projects/:projectId/runs',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const status =
        typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : undefined;
      const scenarioId = typeof req.query.scenarioId === 'string' ? req.query.scenarioId : undefined;
      const limit = Math.min(500, Number(req.query.limit) || 100);
      res.json(
        ctx.repos.runs
          .recent({ projectId: req.params.projectId, status, parentId: scenarioId }, limit)
          .map(summarizeRun),
      );
    }),
  );

  router.get(
    '/projects/:projectId/runs.csv',
    asyncHandler((req, res) => {
      const project = requireProject(ctx, res, req.params.projectId);
      const rows = [
        [
          'Started',
          'Finished',
          'Scenario',
          'Environment',
          'Trigger',
          'Mode',
          'Result',
          'Passed',
          'Failed',
          'Skipped',
          'Duration ms',
          'Failed step',
          'Reason',
        ],
        ...ctx.repos.runs
          .recent({ projectId: project.id }, 5000)
          .filter((r) => r.status !== 'running')
          .map((r) => [
            r.startedAt,
            r.finishedAt ?? '',
            r.scenarioName,
            r.environmentName,
            r.trigger,
            r.mode,
            r.status,
            r.counts.passed,
            r.counts.failed,
            r.counts.skipped,
            r.durationMs,
            r.failedStep ?? '',
            r.failureReason ?? '',
          ]),
      ];
      const csv = rows
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const filename = `testora-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-runs.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    }),
  );

  router.get(
    '/runs/:id',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, ctx.repos.runs.get(req.params.id), 'Run');
      res.json(run);
    }),
  );

  /** Stop: hentikan run yang sedang berjalan (request yang berjalan dibatalkan). */
  router.post(
    '/runs/:id/stop',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, ctx.repos.runs.get(req.params.id), 'Run');
      res.status(202).json(ctx.runs.stop(run.id, currentUser(res).name));
    }),
  );

  addRunDeletionRoutes(router, ctx, 'api', 'runs', 'Run');

  return router;
}
