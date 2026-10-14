import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { normalizeEnvironment, presentEnvironment } from '../domain/normalizers';
import { requireOwned, requireProject, type AppContext } from './context';

export function environmentRoutes(ctx: AppContext): Router {
  const router = Router();
  const repo = ctx.repos.environments;

  router.get(
    '/projects/:projectId/environments',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(repo.list({ project_id: req.params.projectId }).map(presentEnvironment));
    }),
  );

  router.post(
    '/projects/:projectId/environments',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res
        .status(201)
        .json(presentEnvironment(repo.save(normalizeEnvironment(req.body, req.params.projectId))));
    }),
  );

  router.put(
    '/environments/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'Environment');
      res.json(presentEnvironment(repo.save(normalizeEnvironment(req.body, existing.projectId, existing))));
    }),
  );

  router.delete(
    '/environments/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'Environment');
      ctx.deletion.deleteEnvironment(existing);
      res.status(204).end();
    }),
  );

  return router;
}
