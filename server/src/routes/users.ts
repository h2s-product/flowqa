import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { readSessionToken } from './auth';
import { currentUser, requireAdmin, type AppContext } from './context';

/** User Administration (khusus admin) dan pengaturan akun milik sendiri. */
export function userRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/users',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(ctx.users.list());
    }),
  );

  router.post(
    '/users',
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.status(201).json(await ctx.users.create(req.body ?? {}));
    }),
  );

  router.put(
    '/users/:id',
    asyncHandler(async (req, res) => {
      const actor = requireAdmin(res);
      res.json(await ctx.users.update(actor, req.params.id, req.body ?? {}));
    }),
  );

  router.delete(
    '/users/:id',
    asyncHandler((req, res) => {
      ctx.users.delete(requireAdmin(res), req.params.id);
      res.status(204).end();
    }),
  );

  /** Ganti password sendiri; sesi di perangkat lain dikeluarkan. */
  router.post(
    '/account/password',
    asyncHandler(async (req, res) => {
      await ctx.auth.changePassword(
        currentUser(res).id,
        readSessionToken(req),
        req.body?.currentPassword,
        req.body?.newPassword,
      );
      res.status(204).end();
    }),
  );

  return router;
}
