import { Router } from 'express';
import type { Folder } from '@flowqa/shared';
import { asyncHandler } from '../lib/http';
import type { DocumentRepository } from '../repositories/document-repository';
import type { FolderItem, FolderService } from '../services/folder-service';
import { requireOwned, requireProject, type AppContext } from './context';

/**
 * Endpoint folder generik: daftar, buat, ganti nama/pindah, hapus.
 * `collection` = segmen URL, mis. "api-folders" atau "scenario-folders".
 */
function folderRouter<T extends FolderItem>(
  ctx: AppContext,
  collection: string,
  repo: DocumentRepository<Folder>,
  service: FolderService<T>,
): Router {
  const router = Router();

  router.get(
    `/projects/:projectId/${collection}`,
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.json(service.list(req.params.projectId));
    }),
  );

  router.post(
    `/projects/:projectId/${collection}`,
    asyncHandler((req, res) => {
      requireProject(ctx, res, req.params.projectId);
      res.status(201).json(service.create(req.params.projectId, req.body ?? {}));
    }),
  );

  router.put(
    `/${collection}/:id`,
    asyncHandler((req, res) => {
      const folder = requireOwned(ctx, res, repo.get(req.params.id), 'Folder');
      res.json(service.update(folder, req.body ?? {}));
    }),
  );

  router.delete(
    `/${collection}/:id`,
    asyncHandler((req, res) => {
      const folder = requireOwned(ctx, res, repo.get(req.params.id), 'Folder');
      res.json(service.delete(folder));
    }),
  );

  return router;
}

export function folderRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(folderRouter(ctx, 'api-folders', ctx.repos.apiFolders, ctx.apiFolders));
  router.use(folderRouter(ctx, 'scenario-folders', ctx.repos.scenarioFolders, ctx.scenarioFolders));
  router.use(folderRouter(ctx, 'ui-folders', ctx.repos.uiFolders, ctx.uiFolders));
  return router;
}
