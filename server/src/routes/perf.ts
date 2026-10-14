import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/http';
import { normalizePerfTest } from '../domain/normalizers';
import { requireOwned, requireProject, type AppContext } from './context';
import { assertProjectScenario } from '../domain/guards';
import { summarizePerfRun } from '../domain/presenters';

export function perfRoutes(ctx: AppContext): Router {
  const router = Router();
  const tests = ctx.repos.perfTests;

  const validateScenario = (projectId: string, scenarioId: string) =>
    assertProjectScenario(ctx.repos, projectId, scenarioId);

  router.get(
    '/projects/:projectId/perf-tests',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(
        tests.list({ project_id: req.params.projectId }).map((test) => {
          const [last] = ctx.repos.perfRuns.recent({ parentId: test.id }, 1);
          return { ...test, lastRun: last ? summarizePerfRun(last) : null };
        }),
      );
    }),
  );

  router.post(
    '/projects/:projectId/perf-tests',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const test = normalizePerfTest(req.body ?? {}, req.params.projectId);
      validateScenario(test.projectId, test.scenarioId);
      res.status(201).json(tests.save(test));
    }),
  );

  router.put(
    '/perf-tests/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, tests.get(req.params.id), 'Performance test');
      const test = normalizePerfTest(req.body ?? {}, existing.projectId, existing);
      validateScenario(test.projectId, test.scenarioId);
      res.json(tests.save(test));
    }),
  );

  router.delete(
    '/perf-tests/:id',
    asyncHandler((req, res) => {
      tests.delete(requireOwned(ctx, res, tests.get(req.params.id), 'Performance test').id);
      res.status(204).end();
    }),
  );

  router.post(
    '/perf-tests/:id/run',
    asyncHandler((req, res) => {
      const environmentId = req.body?.environmentId;
      if (!environmentId) throw new HttpError(400, '"environmentId" is required');
      const test = requireOwned(ctx, res, tests.get(req.params.id), 'Performance test');
      res.status(202).json(ctx.perf.start(test.id, environmentId));
    }),
  );

  router.get(
    '/projects/:projectId/perf-runs',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const testId = typeof req.query.testId === 'string' ? req.query.testId : undefined;
      const limit = Math.min(200, Number(req.query.limit) || 50);
      res.json(
        ctx.repos.perfRuns
          .recent({ projectId: req.params.projectId, parentId: testId }, limit)
          .map(summarizePerfRun),
      );
    }),
  );

  router.get(
    '/perf-runs/:id',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, ctx.repos.perfRuns.get(req.params.id), 'Performance run');
      res.json(run);
    }),
  );

  router.post(
    '/perf-runs/:id/stop',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, ctx.repos.perfRuns.get(req.params.id), 'Performance run');
      res.status(202).json(summarizePerfRun(ctx.perf.stop(run.id)));
    }),
  );

  return router;
}
