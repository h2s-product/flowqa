/**
 * Firebase App Distribution. Koneksi & otomatisasi khusus admin; daftar release,
 * unduh, dan pasang ke perangkat boleh dipakai semua user yang login.
 */
import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { requireAdmin, type AppContext } from './context';

export function firebaseRoutes(ctx: AppContext): Router {
  const router = Router();
  const { firebase } = ctx;

  router.get(
    '/android/firebase',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(firebase.view());
    }),
  );
  router.put(
    '/android/firebase',
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(firebase.save(req.body ?? {}));
    }),
  );
  router.delete(
    '/android/firebase',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(firebase.reset());
    }),
  );
  /** Cek koneksi dengan isian form (boleh belum disimpan). */
  router.post(
    '/android/firebase/test',
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.json(await firebase.test(req.body ?? {}));
    }),
  );
  /** Cek release baru sekarang (unduh → pasang → jadwal, sama dengan pengecekan berkala). */
  router.post(
    '/android/firebase/check',
    asyncHandler(async (_req, res) => {
      requireAdmin(res);
      res.json(await firebase.checkNow());
    }),
  );
  router.get(
    '/android/firebase/events',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(firebase.events());
    }),
  );

  router.get(
    '/android/firebase/releases',
    asyncHandler(async (_req, res) => {
      res.json(await firebase.releases());
    }),
  );
  router.post(
    '/android/firebase/releases/:id/download',
    asyncHandler(async (req, res) => {
      res.json(await firebase.download(req.params.id));
    }),
  );
  router.post(
    '/android/firebase/releases/:id/install',
    asyncHandler(async (req, res) => {
      res.json(await firebase.install(req.params.id, req.body ?? {}));
    }),
  );

  return router;
}
