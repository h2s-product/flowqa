import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { PerfRun, PerfTest } from '@flowqa/shared';
import { http, toQuery } from '../client';
import { POLL, keys, pollWhile } from './keys';
import { useInvalidate } from './shared';

/** Daftar performance run tidak membawa timeline/detail per step. */
export type PerfRunSummary = Omit<PerfRun, 'timeline' | 'steps' | 'topErrors' | 'statusCodes'>;
export type PerfTestWithLastRun = PerfTest & { lastRun: PerfRunSummary | null };

export const usePerfTests = (projectId?: string) =>
  useQuery({
    queryKey: keys.perfTests(projectId ?? ''),
    queryFn: () => http.get<PerfTestWithLastRun[]>(`/projects/${projectId}/perf-tests`),
    enabled: !!projectId,
    refetchInterval: pollWhile<PerfTestWithLastRun[]>(
      (tests) => tests.some((t) => t.lastRun?.status === 'running'),
      POLL.list,
    ),
  });

export const usePerfRuns = (projectId?: string, filter: { testId?: string; limit?: number } = {}) =>
  useQuery({
    queryKey: keys.perfRuns(projectId ?? '', filter),
    queryFn: () => http.get<PerfRunSummary[]>(`/projects/${projectId}/perf-runs${toQuery(filter)}`),
    enabled: !!projectId,
    refetchInterval: pollWhile<PerfRunSummary[]>(
      (runs) => runs.some((r) => r.status === 'running'),
      POLL.list,
    ),
  });

/** Detail performance run; polling tiap detik selama test masih berjalan. */
export const usePerfRun = (id?: string) =>
  useQuery({
    queryKey: keys.perfRun(id ?? ''),
    queryFn: () => http.get<PerfRun>(`/perf-runs/${id}`),
    enabled: !!id,
    refetchInterval: pollWhile<PerfRun>((run) => run.status === 'running', POLL.perf),
  });

export function useSavePerfTest(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (t: Partial<PerfTest>) =>
      t.id
        ? http.put<PerfTest>(`/perf-tests/${t.id}`, t)
        : http.post<PerfTest>(`/projects/${projectId}/perf-tests`, t),
    onSuccess: () => invalidate(keys.perfTests(projectId)),
  });
}

export function useDeletePerfTest(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/perf-tests/${id}`),
    onSuccess: () => invalidate(keys.perfTests(projectId)),
  });
}

export function useStartPerfRun(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ testId, environmentId }: { testId: string; environmentId: string }) =>
      http.post<PerfRun>(`/perf-tests/${testId}/run`, { environmentId }),
    onSuccess: () => invalidate(keys.perfTests(projectId), keys.perfRunsAll(projectId)),
  });
}

/** Mulai performance test lalu buka halaman hasilnya. */
export function useStartPerfRunAndOpen(projectId: string) {
  const start = useStartPerfRun(projectId);
  const navigate = useNavigate();
  return {
    ...start,
    run: (vars: { testId: string; environmentId: string }) =>
      start.mutate(vars, { onSuccess: (r) => navigate(`/performance/runs/${r.id}`) }),
  };
}

export function useStopPerfRun() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<PerfRunSummary>(`/perf-runs/${id}/stop`),
    onSuccess: (run) =>
      invalidate(keys.perfRun(run.id), keys.perfTests(run.projectId), keys.perfRunsAll(run.projectId)),
  });
}
