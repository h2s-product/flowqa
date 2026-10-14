/** UI Tester: sesi rekaman (mulai, pantau, hapus step, simpan, batalkan). */
import { Router, type Response } from 'express';
import { presentUiTest } from '../domain/presenters';
import { asyncHandler } from '../lib/http';
import { requireProject, type AppContext } from './context';

export function uiRecordingRoutes(ctx: AppContext): Router {
  const router = Router();

  /** Sesi rekaman hanya boleh diakses user yang punya akses ke project-nya. */
  const ownSession = (id: string, res: Response) => {
    const session = ctx.recorder.get(id);
    requireProject(ctx, res, session.projectId);
    return session;
  };

  router.post(
    '/projects/:projectId/ui-recordings',
    asyncHandler(async (req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.status(201).json(await ctx.recorder.start(req.params.projectId, req.body ?? {}));
    }),
  );

  router.get(
    '/ui-recordings/:id',
    asyncHandler((req, res) => {
      res.json(ctx.recorder.present(ownSession(req.params.id, res)));
    }),
  );

  router.post(
    '/ui-recordings/:id/stop',
    asyncHandler(async (req, res) => {
      res.json(await ctx.recorder.stop(ownSession(req.params.id, res).id));
    }),
  );

  router.delete(
    '/ui-recordings/:id/steps/:stepId',
    asyncHandler((req, res) => {
      res.json(ctx.recorder.removeStep(ownSession(req.params.id, res).id, req.params.stepId));
    }),
  );

  router.post(
    '/ui-recordings/:id/save',
    asyncHandler(async (req, res) => {
      const test = await ctx.recorder.save(ownSession(req.params.id, res).id, req.body ?? {});
      res.status(201).json(presentUiTest(test));
    }),
  );

  router.delete(
    '/ui-recordings/:id',
    asyncHandler(async (req, res) => {
      await ctx.recorder.cancel(ownSession(req.params.id, res).id);
      res.status(204).end();
    }),
  );

  return router;
}
