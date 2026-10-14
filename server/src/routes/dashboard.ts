import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { buildDashboard } from '../services/dashboard-service';
import { requireProject, type AppContext } from './context';

export function dashboardRoutes(ctx: AppContext): Router {
  const router = Router();
  /** Dashboard untuk project yang dipilih (hanya bila user punya akses ke project itu). */
  router.get(
    '/projects/:projectId/dashboard',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(buildDashboard(ctx.repos, req.params.projectId));
    }),
  );
  return router;
}
