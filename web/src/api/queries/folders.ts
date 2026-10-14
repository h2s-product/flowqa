import { useMutation, useQuery } from '@tanstack/react-query';
import type { Folder, FolderKind } from '@flowqa/shared';
import { http } from '../client';
import { keys } from './keys';
import { useInvalidate } from './shared';

/** Endpoint per jenis folder (API Catalog / Test Scenarios / UI Tester). */
const FOLDER_API: Record<FolderKind, { collection: string; items: string; idsField: string }> = {
  api: { collection: 'api-folders', items: 'apis', idsField: 'apiIds' },
  scenario: { collection: 'scenario-folders', items: 'scenarios', idsField: 'scenarioIds' },
  ui: { collection: 'ui-folders', items: 'ui-tests', idsField: 'testIds' },
};
const itemsKey = (kind: FolderKind, projectId: string) =>
  kind === 'api' ? keys.apis(projectId) : kind === 'ui' ? keys.uiTests(projectId) : keys.scenarios(projectId);

export const useFolders = (kind: FolderKind, projectId?: string) =>
  useQuery({
    queryKey: keys.folders(kind, projectId ?? ''),
    queryFn: () => http.get<Folder[]>(`/projects/${projectId}/${FOLDER_API[kind].collection}`),
    enabled: !!projectId,
  });

export function useSaveFolder(kind: FolderKind, projectId: string) {
  const invalidate = useInvalidate();
  const { collection } = FOLDER_API[kind];
  return useMutation({
    mutationFn: (f: { id?: string; name?: string; parentId?: string | null }) =>
      f.id
        ? http.put<Folder>(`/${collection}/${f.id}`, f)
        : http.post<Folder>(`/projects/${projectId}/${collection}`, f),
    onSuccess: () => invalidate(keys.folders(kind, projectId)),
  });
}

export function useDeleteFolder(kind: FolderKind, projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      http.delete<{ movedItems: number; movedFolders: number }>(`/${FOLDER_API[kind].collection}/${id}`),
    onSuccess: () => invalidate(keys.folders(kind, projectId), itemsKey(kind, projectId)),
  });
}

/** Pindahkan beberapa item ke satu folder. null = Unfiled. */
export function useMoveToFolder(kind: FolderKind, projectId: string) {
  const invalidate = useInvalidate();
  const { items, idsField } = FOLDER_API[kind];
  return useMutation({
    mutationFn: ({ ids, folderId }: { ids: string[]; folderId: string | null }) =>
      http.post<{ moved: number }>(`/projects/${projectId}/${items}/move`, { [idsField]: ids, folderId }),
    onSuccess: () => invalidate(itemsKey(kind, projectId)),
  });
}
