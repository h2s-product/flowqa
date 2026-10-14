/** UI Tester (mobile): sesi Mobile Inspector — mulai, layar, aksi, hapus step, simpan, tutup. */
import { Router, type Response } from 'express';
import { presentUiTest } from '../domain/presenters';
import { HttpError, asyncHandler } from '../lib/http';
import { requireProject, type AppContext } from './context';

export function mobileInspectorRoutes(ctx: AppContext): Router {
  const router = Router();

  const own = (id: string, res: Response) => {
    const session = ctx.inspector.get(id);
    requireProject(ctx, res, session.projectId);
    return session;
  };

  router.post(
    '/projects/:projectId/mobile-inspector',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.status(201).json(ctx.inspector.start(req.params.projectId, req.body ?? {}));
    }),
  );

  router.get(
    '/mobile-inspector/:id',
    asyncHandler((req, res) => {
      res.json(ctx.inspector.present(own(req.params.id, res)));
    }),
  );

  router.get(
    '/mobile-inspector/:id/screen',
    asyncHandler(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await ctx.inspector.screen(own(req.params.id, res).id));
    }),
  );

  router.post(
    '/mobile-inspector/:id/actions',
    asyncHandler(async (req, res) => {
      res.json(await ctx.inspector.action(own(req.params.id, res).id, req.body ?? {}));
    }),
  );

  /** "Test selector": jumlah elemen yang cocok & posisinya. */
  router.post(
    '/mobile-inspector/:id/selector',
    asyncHandler(async (req, res) => {
      const selector = String(req.body?.selector ?? '').trim();
      if (!selector) throw new HttpError(400, 'Enter a selector to test');
      res.json(await ctx.inspector.testSelector(own(req.params.id, res).id, selector));
    }),
  );

  router.delete(
    '/mobile-inspector/:id/steps/:stepId',
    asyncHandler((req, res) => {
      res.json(ctx.inspector.removeStep(own(req.params.id, res).id, req.params.stepId));
    }),
  );

  router.post(
    '/mobile-inspector/:id/save',
    asyncHandler(async (req, res) => {
      const test = await ctx.inspector.save(own(req.params.id, res).id, req.body ?? {});
      res.status(201).json(presentUiTest(test));
    }),
  );

  router.post(
    '/mobile-inspector/:id/stop',
    asyncHandler(async (req, res) => {
      res.json(await ctx.inspector.stop(own(req.params.id, res).id));
    }),
  );

  router.delete(
    '/mobile-inspector/:id',
    asyncHandler(async (req, res) => {
      await ctx.inspector.cancel(own(req.params.id, res).id);
      res.status(204).end();
    }),
  );

  return router;
}
