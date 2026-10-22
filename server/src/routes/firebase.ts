/**
 * Aplikasi project (Android / Web) dan Firebase App Distribution per app Android.
 * Mengubah app & koneksi Firebase khusus admin; daftar app, release, unduh, dan
 * pasang ke perangkat boleh dipakai semua user yang bisa mengakses project itu.
 */
import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../lib/http';
import { requireAdmin, requireProject, type AppContext } from './context';

export function firebaseRoutes(ctx: AppContext): Router {
  const router = Router();
  const { firebase, apps } = ctx;
  const appOf = (req: Request, res: Response) =>
    apps.get(requireProject(ctx, res, String(req.params.projectId)).id, String(req.params.appId));

  router.get(
    '/projects/:projectId/apps',
    asyncHandler((req, res) => {
      res.json(apps.list(requireProject(ctx, res, req.params.projectId).id));
    }),
  );
  router.post(
    '/projects/:projectId/apps',
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.status(201).json(apps.save(requireProject(ctx, res, req.params.projectId).id, req.body ?? {}));
    }),
  );
  router.put(
    '/projects/:projectId/apps/:appId',
    asyncHandler((req, res) => {
      requireAdmin(res);
      const app = appOf(req, res);
      res.json(apps.save(app.projectId, req.body ?? {}, app));
    }),
  );
  router.delete(
    '/projects/:projectId/apps/:appId',
    asyncHandler((req, res) => {
      requireAdmin(res);
      const app = appOf(req, res);
      apps.delete(app.projectId, app.id);
      res.status(204).end();
    }),
  );

  const base = '/projects/:projectId/apps/:appId/firebase';
  router.get(
    base,
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(firebase.view(appOf(req, res).id));
    }),
  );
  router.put(
    base,
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(firebase.save(appOf(req, res).id, req.body ?? {}));
    }),
  );
  router.delete(
    base,
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(firebase.reset(appOf(req, res).id));
    }),
  );
  /** Cek koneksi dengan isian form (boleh belum disimpan). */
  router.post(
    `${base}/test`,
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.json(await firebase.test(appOf(req, res).id, req.body ?? {}));
    }),
  );
  /** Cek release baru sekarang (unduh → pasang → jadwal, sama dengan pengecekan berkala). */
  router.post(
    `${base}/check`,
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.json(await firebase.checkNow(appOf(req, res).id));
    }),
  );
  router.get(
    `${base}/events`,
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(firebase.events(appOf(req, res).id));
    }),
  );
  router.get(
    `${base}/releases`,
    asyncHandler(async (req, res) => {
      res.json(await firebase.releases(appOf(req, res).id));
    }),
  );
  router.post(
    `${base}/releases/:id/download`,
    asyncHandler(async (req, res) => {
      res.json(await firebase.download(appOf(req, res).id, req.params.id));
    }),
  );
  router.post(
    `${base}/releases/:id/install`,
    asyncHandler(async (req, res) => {
      res.json(await firebase.install(appOf(req, res).id, req.params.id, req.body ?? {}));
    }),
  );

  return router;
}
