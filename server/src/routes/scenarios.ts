import { Router } from 'express';
import { createId } from '@flowqa/shared';
import { asyncHandler } from '../lib/http';
import { nowIso } from '../lib/time';
import { normalizeScenario } from '../domain/normalizers';
import { requireOwned, requireProject, type AppContext } from './context';
import { lastRunBrief } from '../domain/presenters';

export function scenarioRoutes(ctx: AppContext): Router {
  const router = Router();
  const repo = ctx.repos.scenarios;

  router.get(
    '/projects/:projectId/scenarios',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const scenarios = repo.list({ project_id: req.params.projectId });
      res.json(
        scenarios.map((s) => {
          return { ...s, lastRun: lastRunBrief(ctx.repos.runs.recent({ parentId: s.id }, 1)[0]) };
        }),
      );
    }),
  );

  router.post(
    '/projects/:projectId/scenarios',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const scenario = normalizeScenario(req.body, req.params.projectId);
      ctx.scenarioFolders.assertFolder(scenario.projectId, scenario.folderId);
      res.status(201).json(repo.save(scenario));
    }),
  );

  /** Pindahkan beberapa scenario sekaligus ke satu folder (null = Unfiled). */
  router.post(
    '/projects/:projectId/scenarios/move',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json({
        moved: ctx.scenarioFolders.moveItems(
          req.params.projectId,
          req.body?.scenarioIds,
          req.body?.folderId ?? null,
        ),
      });
    }),
  );

  router.get(
    '/scenarios/:id',
    asyncHandler((req, res) => {
      const scenario = requireOwned(ctx, res, repo.get(req.params.id), 'Scenario');
      res.json(scenario);
    }),
  );

  router.put(
    '/scenarios/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'Scenario');
      const scenario = normalizeScenario(req.body, existing.projectId, existing);
      ctx.scenarioFolders.assertFolder(scenario.projectId, scenario.folderId);
      res.json(repo.save(scenario));
    }),
  );

  router.post(
    '/scenarios/:id/duplicate',
    asyncHandler((req, res) => {
      const source = requireOwned(ctx, res, repo.get(req.params.id), 'Scenario');
      const now = nowIso();
      const copy = {
        ...structuredClone(source),
        id: createId('scn'),
        name: `${source.name} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      copy.steps.forEach((s) => (s.id = createId('st')));
      res.status(201).json(repo.save(copy));
    }),
  );

  router.delete(
    '/scenarios/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'Scenario');
      ctx.deletion.deleteScenario(existing);
      res.status(204).end();
    }),
  );

  return router;
}
