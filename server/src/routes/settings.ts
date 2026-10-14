import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { requireAdmin, type AppContext } from './context';

/** Pengaturan aplikasi (khusus admin): Settings → Email Report & Mobile (Android). */
export function settingsRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/settings/email',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(ctx.emailSettings.view());
    }),
  );

  router.put(
    '/settings/email',
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(ctx.emailSettings.save(req.body ?? {}));
    }),
  );

  /** Hapus pengaturan dari aplikasi (kembali ke .env, atau email mati). */
  router.delete(
    '/settings/email',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(ctx.emailSettings.reset());
    }),
  );

  /** Kirim email percobaan dengan isian form (boleh belum disimpan). */
  router.post(
    '/settings/email/test',
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      // Satu alamat (string) atau banyak (array / dipisah koma).
      const raw: unknown = req.body?.to;
      const to = [
        ...new Set(
          (Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;]+/))
            .map((v) => String(v).trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      res.json({ sentTo: await ctx.emailSettings.sendTest(to, req.body?.settings) });
    }),
  );

  /* ---------------------------- Mobile (Appium) ---------------------------- */

  router.get(
    '/settings/appium',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(ctx.appium.view());
    }),
  );

  router.put(
    '/settings/appium',
    asyncHandler((req, res) => {
      requireAdmin(res);
      res.json(ctx.appium.save(req.body ?? {}));
    }),
  );

  router.delete(
    '/settings/appium',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(ctx.appium.reset());
    }),
  );

  /** Cek koneksi ke server Appium (isian form boleh belum disimpan). */
  router.post(
    '/settings/appium/test',
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.json(await ctx.appium.test(req.body?.settings));
    }),
  );

  return router;
}
