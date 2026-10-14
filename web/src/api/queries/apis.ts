import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiDefinition, ImportApisRequest, ImportPreview } from '@flowqa/shared';
import { http } from '../client';
import { keys } from './keys';
import { useInvalidate } from './shared';

export const useApis = (projectId?: string) =>
  useQuery({
    queryKey: keys.apis(projectId ?? ''),
    queryFn: () => http.get<ApiDefinition[]>(`/projects/${projectId}/apis`),
    enabled: !!projectId,
  });

export function useSaveApi(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (a: Partial<ApiDefinition>) =>
      a.id
        ? http.put<ApiDefinition>(`/apis/${a.id}`, a)
        : http.post<ApiDefinition>(`/projects/${projectId}/apis`, a),
    onSuccess: () => invalidate(keys.apis(projectId)),
  });
}

export function useDeleteApi(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/apis/${id}`),
    onSuccess: () => invalidate(keys.apis(projectId)),
  });
}

export function usePreviewImport(projectId: string) {
  return useMutation({
    // Error ditampilkan di dalam modal impor, bukan sebagai toast.
    meta: { silentError: true },
    mutationFn: (content: string) =>
      http.post<ImportPreview>(`/projects/${projectId}/apis/import/preview`, { content }),
  });
}

export function useImportApis(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (request: ImportApisRequest) =>
      http.post<{ created: number; updated: number }>(`/projects/${projectId}/apis/import`, request),
    onSuccess: () => invalidate(keys.apis(projectId), keys.folders('api', projectId)),
  });
}
