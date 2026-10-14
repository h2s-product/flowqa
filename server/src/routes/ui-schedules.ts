import { Router } from 'express';
import type { UiSchedule } from '@flowqa/shared';
import { HttpError, asyncHandler } from '../lib/http';
import { normalizeUiSchedule } from '../domain/normalizers';
import { assertProjectEnvironment } from '../domain/guards';
import { requireOwned, requireProject, type AppContext } from './context';

/** Test Scheduler (UI Tester): jadwal bernama berisi beberapa UI test case. */
export function uiScheduleRoutes(ctx: AppContext): Router {
  const router = Router();
  const repo = ctx.repos.uiSchedules;

  const validate = (schedule: UiSchedule) => {
    if (schedule.environmentId)
      assertProjectEnvironment(ctx.repos, schedule.projectId, schedule.environmentId);
    const foreign = schedule.testIds.find(
      (id) => ctx.repos.uiTests.get(id)?.projectId !== schedule.projectId,
    );
    if (foreign) throw new HttpError(400, 'One of the chosen UI tests does not exist in this project');
  };

  router.get(
    '/projects/:projectId/ui-schedules',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(repo.list({ project_id: req.params.projectId }));
    }),
  );

  router.post(
    '/projects/:projectId/ui-schedules',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const schedule = normalizeUiSchedule(req.body ?? {}, req.params.projectId);
      validate(schedule);
      res.status(201).json(repo.save(ctx.uiSchedules.plan(schedule)));
    }),
  );

  router.put(
    '/ui-schedules/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'Schedule');
      const schedule = normalizeUiSchedule(req.body ?? {}, existing.projectId, existing);
      validate(schedule);
      res.json(repo.save(ctx.uiSchedules.plan(schedule, existing)));
    }),
  );

  /** Jalankan sekarang (di luar jadwal). */
  router.post(
    '/ui-schedules/:id/run',
    asyncHandler((req, res) => {
      const schedule = requireOwned(ctx, res, repo.get(req.params.id), 'Schedule');
      res.status(202).json(ctx.uiSchedules.run(schedule));
    }),
  );

  router.delete(
    '/ui-schedules/:id',
    asyncHandler((req, res) => {
      repo.delete(requireOwned(ctx, res, repo.get(req.params.id), 'Schedule').id);
      res.status(204).end();
    }),
  );

  return router;
}
