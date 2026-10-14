import { Router } from 'express';
import { asyncHandler, notFound } from '../lib/http';
import { normalizeEnvironment, normalizeProject } from '../domain/normalizers';
import { currentUser, requireAdmin, requireProject, type AppContext } from './context';
import { lastRunBrief } from '../domain/presenters';

export function projectRoutes(ctx: AppContext): Router {
  const router = Router();
  const { projects, environments, apis, scenarios } = ctx.repos;

  router.get(
    '/projects',
    asyncHandler((_req, res) => {
      const access = ctx.users.accessibleProjectIds(currentUser(res));
      const visible =
        access === 'all' ? projects.list() : projects.list().filter((p) => access.includes(p.id));
      res.json(
        visible.map((p) => ({
          ...p,
          stats: {
            apis: apis.count({ project_id: p.id }),
            scenarios: scenarios.count({ project_id: p.id }),
            environments: environments.count({ project_id: p.id }),
            lastRun: lastRunBrief(ctx.repos.runs.recent({ projectId: p.id }, 1)[0]),
          },
        })),
      );
    }),
  );

  router.post(
    '/projects',
    asyncHandler((req, res) => {
      const project = projects.save(normalizeProject(req.body));
      ctx.users.grantCreator(currentUser(res), project.id);
      // Setiap project baru mendapat satu environment awal agar bisa langsung dipakai.
      environments.save(
        normalizeEnvironment(
          { name: 'Development', baseUrl: 'https://dev-api.example.com', variables: [] },
          project.id,
        ),
      );
      res.status(201).json(project);
    }),
  );

  router.get(
    '/projects/:id',
    asyncHandler((req, res) => {
      res.json(requireProject(ctx, res, req.params.id));
    }),
  );

  router.put(
    '/projects/:id',
    asyncHandler((req, res) => {
      const existing = requireProject(ctx, res, req.params.id);
      res.json(projects.save(normalizeProject(req.body, existing)));
    }),
  );

  router.delete(
    '/projects/:id',
    asyncHandler((req, res) => {
      requireAdmin(res);
      if (!ctx.deletion.deleteProject(req.params.id)) throw notFound('Project');
      res.status(204).end();
    }),
  );

  return router;
}
