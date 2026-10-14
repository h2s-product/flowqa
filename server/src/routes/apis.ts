import { Router } from 'express';
import { HttpError, asyncHandler } from '../lib/http';
import { normalizeApi } from '../domain/normalizers';
import { parseOpenApi } from '../domain/openapi-import';
import { requireOwned, requireProject, type AppContext } from './context';

export function apiRoutes(ctx: AppContext): Router {
  const router = Router();
  const repo = ctx.repos.apis;

  router.get(
    '/projects/:projectId/apis',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(repo.list({ project_id: req.params.projectId }));
    }),
  );

  router.post(
    '/projects/:projectId/apis',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      const api = normalizeApi(req.body, req.params.projectId);
      ctx.apiFolders.assertFolder(api.projectId, api.folderId);
      res.status(201).json(repo.save(api));
    }),
  );

  /** Langkah 1 impor: parse file dan kembalikan pratinjau tanpa menyimpan. */
  router.post(
    '/projects/:projectId/apis/import/preview',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      if (typeof req.body?.content !== 'string' || !req.body.content.trim())
        throw new HttpError(400, 'File content is empty');
      res.json(parseOpenApi(req.body.content));
    }),
  );

  /**
   * Langkah 2 impor: simpan API terpilih ke folder tujuan (opsional: subfolder per tag).
   * Endpoint yang sama (method+path) di-update dan tetap di folder lamanya.
   */
  router.post(
    '/projects/:projectId/apis/import',
    asyncHandler((req, res) => {
      const { projectId } = req.params;
      requireProject(ctx, res, projectId);
      const incoming: Record<string, unknown>[] = Array.isArray(req.body?.apis) ? req.body.apis : [];
      const targetFolderId = ctx.apiFolders.assertFolder(projectId, req.body?.targetFolderId);
      const folderPerTag = req.body?.folderPerTag !== false;
      const existing = repo.list({ project_id: projectId });
      let created = 0;
      let updated = 0;
      for (const raw of incoming) {
        const { tag, folderId: _ignored, ...fields } = raw ?? {};
        const candidate = normalizeApi(fields, projectId);
        const match = existing.find((a) => a.method === candidate.method && a.path === candidate.path);
        if (match) {
          repo.save(normalizeApi(fields, projectId, match));
          updated++;
        } else {
          const folderId =
            folderPerTag && typeof tag === 'string' && tag.trim()
              ? ctx.apiFolders.ensure(projectId, targetFolderId, tag).id
              : targetFolderId;
          repo.save({ ...candidate, folderId });
          created++;
        }
      }
      res.json({ created, updated });
    }),
  );

  /** Pindahkan beberapa API sekaligus ke satu folder (null = Unfiled). */
  router.post(
    '/projects/:projectId/apis/move',
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json({
        moved: ctx.apiFolders.moveItems(req.params.projectId, req.body?.apiIds, req.body?.folderId ?? null),
      });
    }),
  );

  router.put(
    '/apis/:id',
    asyncHandler((req, res) => {
      const existing = requireOwned(ctx, res, repo.get(req.params.id), 'API');
      const api = normalizeApi(req.body, existing.projectId, existing);
      ctx.apiFolders.assertFolder(api.projectId, api.folderId);
      res.json(repo.save(api));
    }),
  );

  router.delete(
    '/apis/:id',
    asyncHandler((req, res) => {
      repo.delete(requireOwned(ctx, res, repo.get(req.params.id), 'API').id);
      res.status(204).end();
    }),
  );

  return router;
}
