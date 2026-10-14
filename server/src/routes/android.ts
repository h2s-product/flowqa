/**
 * Android automation (Settings → Mobile (Android)). Pemasangan, server Appium,
 * dan pembuatan emulator khusus admin; daftar perangkat, uji koneksi, emulator
 * start/stop, dan APK boleh dipakai semua user yang login.
 */
import express, { Router } from 'express';
import type { CreateAvdInput } from '@flowqa/shared';
import { HttpError, asyncHandler } from '../lib/http';
import { currentUser, requireAdmin, type AppContext } from './context';

const MAX_APK_BYTES = 500 * 1024 * 1024;

export function androidRoutes(ctx: AppContext): Router {
  const router = Router();
  const { android } = ctx;
  const setupOptions = (body: Record<string, unknown> | undefined) => ({
    acceptLicenses: body?.acceptLicenses === true,
    configureShell: body?.configureShell === true,
  });

  /* ---------------------------- environment ---------------------------- */
  router.get(
    '/android/environment',
    asyncHandler(async (_req, res) => {
      requireAdmin(res);
      res.json(await android.check());
    }),
  );
  router.post(
    '/android/setup/plan',
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.json(await android.plan(setupOptions(req.body)));
    }),
  );
  router.post(
    '/android/setup',
    asyncHandler(async (req, res) => {
      requireAdmin(res);
      res.status(202).json(await android.setup(setupOptions(req.body)));
    }),
  );
  router.get(
    '/android/setup',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(android.setupJob());
    }),
  );

  /* ------------------------------ Appium ------------------------------ */
  router.get(
    '/android/appium',
    asyncHandler(async (_req, res) => {
      res.json(await android.appiumHealth());
    }),
  );
  router.post(
    '/android/appium/start',
    asyncHandler(async (_req, res) => {
      requireAdmin(res);
      res.json(await android.startAppium());
    }),
  );
  router.post(
    '/android/appium/stop',
    asyncHandler(async (_req, res) => {
      requireAdmin(res);
      res.json(await android.stopAppium());
    }),
  );
  router.get(
    '/android/appium/log',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json({ lines: android.appiumLog() });
    }),
  );

  /* ------------------------------ devices ------------------------------ */
  router.get(
    '/android/devices',
    asyncHandler(async (_req, res) => {
      res.json(await android.devices());
    }),
  );
  router.post(
    '/android/emulators/:avd/start',
    asyncHandler(async (req, res) => {
      res.json(await android.startEmulator(req.params.avd));
    }),
  );
  router.post(
    '/android/devices/:serial/stop',
    asyncHandler(async (req, res) => {
      res.json(
        await android.stopEmulator(req.params.serial, {
          force: req.body?.force === true,
          stoppedBy: currentUser(res).name,
        }),
      );
    }),
  );
  router.get(
    '/android/avd/options',
    asyncHandler(async (_req, res) => {
      requireAdmin(res);
      res.json(await android.avdOptions());
    }),
  );
  router.post(
    '/android/avd',
    asyncHandler((req, res) => {
      requireAdmin(res);
      const b = (req.body ?? {}) as Partial<CreateAvdInput>;
      res.status(202).json(
        android.createAvd({
          name: String(b.name ?? '').trim(),
          device: String(b.device ?? ''),
          image: String(b.image ?? ''),
          ramMb: Number(b.ramMb) || 2048,
          storageMb: Number(b.storageMb) || 6144,
        }),
      );
    }),
  );
  router.get(
    '/android/avd/job',
    asyncHandler((_req, res) => {
      requireAdmin(res);
      res.json(android.avdJob());
    }),
  );

  /** Test Android Connection (membuat sesi Appium sungguhan). */
  router.post(
    '/android/test-connection',
    asyncHandler(async (req, res) => {
      res.json(await android.testConnection(req.body ?? {}));
    }),
  );

  /* -------------------------------- APK -------------------------------- */
  router.get(
    '/android/apks',
    asyncHandler((_req, res) => {
      res.json(android.listApks());
    }),
  );
  router.post(
    '/android/apks',
    express.raw({ type: '*/*', limit: MAX_APK_BYTES }),
    asyncHandler((req, res) => {
      const name = String(req.query.name ?? '');
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'The upload is empty.');
      res.status(201).json(android.saveApk(name, req.body));
    }),
  );
  router.delete(
    '/android/apks/:name',
    asyncHandler((req, res) => {
      android.deleteApk(req.params.name);
      res.status(204).end();
    }),
  );

  return router;
}
