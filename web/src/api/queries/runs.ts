import { useMutation } from '@tanstack/react-query';
import { http } from '../client';
import { keys } from './keys';
import { useInvalidate } from './shared';

/** Jenis run: API run (scenario) atau UI run. */
export type RunKind = 'api' | 'ui';

export interface RunDeletionResult {
  deleted: number;
  /** Run yang tidak dihapus karena masih berjalan. */
  running: number;
}

/**
 * Hapus satu atau banyak run milik project. Run yang masih berjalan dilewati
 * server. Daftar run, dashboard, laporan, dan "last run" ikut disegarkan.
 */
export function useDeleteRuns(kind: RunKind) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ projectId, ids }: { projectId: string; ids: string[] }) =>
      http.post<RunDeletionResult>(`/projects/${projectId}/${kind === 'ui' ? 'ui-runs' : 'runs'}/delete`, {
        ids,
      }),
    onSuccess: (_result, { projectId }) =>
      kind === 'ui'
        ? invalidate(keys.uiRunsAll(projectId), keys.uiTests(projectId), keys.reportsAll)
        : invalidate(
            keys.runsAll(projectId),
            keys.scenarios(projectId),
            keys.dashboardFor(projectId),
            keys.reportsAll,
          ),
  });
}
