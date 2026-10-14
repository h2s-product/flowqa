import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { normalizeNotifications } from '../domain/normalizers';
import { requireProject, type AppContext } from './context';

export function notificationRoutes(ctx: AppContext): Router {
  const router = Router();

  /** Apakah server sudah bisa mengirim email (SMTP terisi). Tanpa detail rahasia. */
  router.get(
    '/notifications/status',
    asyncHandler((_req, res) => {
      res.json(ctx.notifications.status());
    }),
  );

  /** Kirim email percobaan ke penerima di form (belum perlu disimpan) atau penerima project. */
  router.post(
    '/projects/:projectId/notifications/test',
    asyncHandler(async (req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const recipients =
        req.body?.recipients !== undefined
          ? normalizeNotifications({ email: { recipients: req.body.recipients } }).email.recipients
          : undefined;
      res.json({ sentTo: await ctx.notifications.sendTest(req.params.projectId, recipients) });
    }),
  );

  return router;
}
