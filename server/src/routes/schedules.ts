import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { normalizeSchedule } from '../domain/normalizers';
import { computeNextRun } from '../domain/schedule-time';
import { requireOwned, requireProject, type AppContext } from './context';
import { assertProjectEnvironment, assertProjectScenario } from '../domain/guards';
import { nowIso } from '../lib/time';

export function scheduleRoutes(ctx: AppContext): Router {
  const router = Router();
  const repo = ctx.repos.schedules;

  const validate = (projectId: string, scenarioId: string, environmentId: string) => {
    assertProjectScenario(ctx.repos, projectId, scenarioId);
    assertProjectEnvironment(ctx.repos, projectId, environmentId);
  };

  router.get(
    '/projects/:projectId/schedules',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(
        repo.list({ project_id: req.params.projectId }).map((s) =>
          // Jadwal lama belum menyimpan lastRunAt: ambil dari run terakhirnya.
          s.lastRunId && !s.lastRunAt
            ? { ...s, lastRunAt: ctx.repos.runs.get(s.lastRunId)?.startedAt ?? null }
            : s,
        ),
      );
    }),
  );

  router.post(
    '/projects/:projectId/schedules',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const schedule = normalizeSchedule(req.body, req.params.projectId);
      validate(schedule.projectId, schedule.scenarioId, schedule.environmentId);
      schedule.nextRunAt = schedule.enabled ? computeNextRun(schedule) : null;
      res.status(201).json(repo.save(schedule));
    }),
  );

  router.put(
    '/schedules/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'Schedule');
      const schedule = normalizeSchedule(req.body, existing.projectId, existing);
      validate(schedule.projectId, schedule.scenarioId, schedule.environmentId);
      const timingChanged = schedule.frequency !== existing.frequency || schedule.time !== existing.time;
      if (!schedule.enabled) schedule.nextRunAt = null;
      else if (!existing.enabled || timingChanged || !schedule.nextRunAt)
        schedule.nextRunAt = computeNextRun(schedule);
      res.json(repo.save(schedule));
    }),
  );

  router.post(
    '/schedules/:id/run',
    asyncHandler((req, res) => {
      const schedule = requireOwned(ctx, res, repo.get(req.params.id), 'Schedule');
      const run = ctx.runs.start(
        { scenarioId: schedule.scenarioId, environmentId: schedule.environmentId },
        'schedule',
      );
      repo.save({
        ...schedule,
        lastRunId: run.id,
        lastRunAt: run.startedAt,
        updatedAt: nowIso(),
      });
      res.status(202).json(run);
    }),
  );

  router.delete(
    '/schedules/:id',
    asyncHandler((req, res) => {
      repo.delete(requireOwned(ctx, res, repo.get(req.params.id), 'Schedule').id);
      res.status(204).end();
    }),
  );

  return router;
}
