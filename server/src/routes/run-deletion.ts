/**
 * Endpoint hapus run, sama untuk API run dan UI run:
 *   DELETE /{base}/:id                         → hapus satu run (409 bila masih berjalan)
 *   POST   /projects/:projectId/{base}/delete  → hapus banyak run, body { ids: string[] }
 */
import type { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/http';
import { MAX_RUNS_PER_DELETE, type RunKind } from '../services/deletion-service';
import { requireOwned, requireProject, type AppContext } from './context';

export function addRunDeletionRoutes(
  router: Router,
  ctx: AppContext,
  kind: RunKind,
  base: string,
  label: string,
) {
  const repo = kind === 'ui' ? ctx.repos.uiRuns : ctx.repos.runs;

  router.delete(
    `/${base}/:id`,
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, repo.get(req.params.id), label);
      if (run.status === 'running')
        throw new HttpError(409, 'This run is still running. Wait until it finishes.');
      ctx.deletion.deleteRuns(kind, run.projectId, [run.id]);
      res.status(204).end();
    }),
  );

  router.post(
    `/projects/:projectId/${base}/delete`,
    asyncHandler((req, res) => {
      const { projectId } = req.params;
      requireProject(ctx, res, projectId);
      const ids: unknown = req.body?.ids;
      if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string'))
        throw new HttpError(400, 'Choose at least one run to delete');
      if (ids.length > MAX_RUNS_PER_DELETE)
        throw new HttpError(400, `Delete at most ${MAX_RUNS_PER_DELETE} runs at a time`);
      res.json(ctx.deletion.deleteRuns(kind, projectId, ids));
    }),
  );
}
