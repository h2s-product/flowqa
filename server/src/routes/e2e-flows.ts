/** E2E Flow: kanvas lintas platform (web, Android, API) dan hasil run-nya. */
import { Router } from 'express';
import type { E2EFlow } from '@flowqa/shared';
import { createId } from '@flowqa/shared';
import { assertProjectEnvironment } from '../domain/guards';
import { normalizeFlow } from '../domain/normalizers';
import { HttpError, asyncHandler } from '../lib/http';
import { nowIso } from '../lib/time';
import { validateFlow } from '../services/flow-run-service';
import { currentUser, requireOwned, requireProject, type AppContext } from './context';

export function e2eFlowRoutes(ctx: AppContext): Router {
  const router = Router();
  const flows = ctx.repos.flows;
  const runs = ctx.repos.flowRuns;

  const checkEnvironment = (flow: E2EFlow) => {
    if (flow.environmentId) assertProjectEnvironment(ctx.repos, flow.projectId, flow.environmentId);
  };
  const present = (flow: E2EFlow) => ({ ...flow, problems: validateFlow(flow, ctx.repos, flow.projectId) });

  router.get(
    '/projects/:projectId/e2e-flows',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const last = new Map<string, unknown>();
      for (const r of runs.recent({ projectId: req.params.projectId }, 500))
        if (!last.has(r.flowId))
          last.set(r.flowId, {
            id: r.id,
            status: r.status,
            startedAt: r.startedAt,
            durationMs: r.durationMs,
          });
      res.json(
        flows
          .list({ project_id: req.params.projectId })
          .map((f) => ({ ...present(f), lastRun: last.get(f.id) ?? null })),
      );
    }),
  );

  router.post(
    '/projects/:projectId/e2e-flows',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const flow = normalizeFlow(req.body ?? {}, req.params.projectId);
      checkEnvironment(flow);
      res.status(201).json(present(flows.save(flow)));
    }),
  );

  router.get(
    '/e2e-flows/:id',
    asyncHandler((req, res) => {
      res.json(present(requireOwned(ctx, res, flows.get(req.params.id), 'E2E flow')));
    }),
  );

  router.put(
    '/e2e-flows/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, flows.get(req.params.id), 'E2E flow');
      const flow = normalizeFlow(req.body ?? {}, existing.projectId, existing);
      checkEnvironment(flow);
      res.json(present(flows.save(flow)));
    }),
  );

  router.post(
    '/e2e-flows/:id/duplicate',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, flows.get(req.params.id), 'E2E flow');
      const now = nowIso();
      const copy: E2EFlow = {
        ...existing,
        id: createId('flow'),
        name: `${existing.name} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      res.status(201).json(present(flows.save(copy)));
    }),
  );

  router.delete(
    '/e2e-flows/:id',
    asyncHandler((req, res) => {
      const flow = requireOwned(ctx, res, flows.get(req.params.id), 'E2E flow');
      flows.delete(flow.id);
      res.status(204).end();
    }),
  );

  router.post(
    '/e2e-flows/:id/run',
    asyncHandler((req, res) => {
      const flow = requireOwned(ctx, res, flows.get(req.params.id), 'E2E flow');
      res
        .status(202)
        .json(ctx.flowRuns.start(flow.id, { environmentId: req.body?.environmentId || undefined }));
    }),
  );

  router.get(
    '/projects/:projectId/e2e-runs',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const flowId = typeof req.query.flowId === 'string' ? req.query.flowId : undefined;
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);
      res.json(
        runs
          .recent({ projectId: req.params.projectId, ...(flowId ? { parentId: flowId } : {}) }, limit)
          .map(({ graph: _graph, variables: _variables, ...r }) => r),
      );
    }),
  );

  router.get(
    '/e2e-runs/:id',
    asyncHandler((req, res) => {
      res.json(requireOwned(ctx, res, runs.get(req.params.id), 'Flow run'));
    }),
  );

  /** Stop: hentikan flow beserta semua test yang sedang berjalan di dalamnya. */
  router.post(
    '/e2e-runs/:id/stop',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, runs.get(req.params.id), 'Flow run');
      res.status(202).json(ctx.flowRuns.stop(run.id, currentUser(res).name));
    }),
  );

  router.delete(
    '/e2e-runs/:id',
    asyncHandler((req, res) => {
      const run = requireOwned(ctx, res, runs.get(req.params.id), 'Flow run');
      if (run.status === 'running')
        throw new HttpError(409, 'This flow is still running. Wait until it finishes.');
      runs.delete(run.id);
      res.status(204).end();
    }),
  );

  return router;
}
