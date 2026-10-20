import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { E2EFlow, FlowRun, FlowRunOptions } from '@flowqa/shared';
import { http, toQuery } from '../client';
import { POLL, keys, pollWhile } from './keys';
import { useInvalidate } from './shared';

/** Flow beserta masalah strukturnya (mis. test case yang sudah dihapus). */
export type FlowWithProblems = E2EFlow & { problems: string[] };
export type FlowListItem = FlowWithProblems & {
  lastRun: { id: string; status: FlowRun['status']; startedAt: string; durationMs: number } | null;
};
/** Daftar run tidak membawa graf & variabel. */
export type FlowRunSummary = Omit<FlowRun, 'graph' | 'variables'>;

export const useFlows = (projectId?: string) =>
  useQuery({
    queryKey: keys.flows(projectId ?? ''),
    queryFn: () => http.get<FlowListItem[]>(`/projects/${projectId}/e2e-flows`),
    enabled: !!projectId,
    refetchInterval: pollWhile<FlowListItem[]>(
      (flows) => flows.some((f) => f.lastRun?.status === 'running'),
      POLL.list,
    ),
  });

export const useFlow = (id?: string) =>
  useQuery({
    queryKey: keys.flow(id ?? ''),
    queryFn: () => http.get<FlowWithProblems>(`/e2e-flows/${id}`),
    enabled: !!id,
  });

export function useSaveFlow(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (flow: Partial<E2EFlow>) =>
      flow.id
        ? http.put<FlowWithProblems>(`/e2e-flows/${flow.id}`, flow)
        : http.post<FlowWithProblems>(`/projects/${projectId}/e2e-flows`, flow),
    onSuccess: (saved) => {
      client.setQueryData(keys.flow(saved.id), saved);
      void client.invalidateQueries({ queryKey: keys.flows(projectId) });
    },
  });
}

export function useDeleteFlow(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/e2e-flows/${id}`),
    onSuccess: () => invalidate(keys.flows(projectId)),
  });
}

export function useDuplicateFlow(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<FlowWithProblems>(`/e2e-flows/${id}/duplicate`),
    onSuccess: () => invalidate(keys.flows(projectId)),
  });
}

export function useRunFlow(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({
      id,
      environmentId,
      options,
    }: {
      id: string;
      environmentId?: string | null;
      options?: FlowRunOptions;
    }) => http.post<FlowRun>(`/e2e-flows/${id}/run`, { environmentId, options }),
    onSuccess: () => invalidate(keys.flows(projectId), keys.flowRunsAll(projectId)),
  });
}

export const useFlowRuns = (projectId?: string, filter: { flowId?: string; limit?: number } = {}) =>
  useQuery({
    queryKey: keys.flowRuns(projectId ?? '', filter),
    queryFn: () => http.get<FlowRunSummary[]>(`/projects/${projectId}/e2e-runs${toQuery(filter)}`),
    enabled: !!projectId,
    refetchInterval: pollWhile<FlowRunSummary[]>(
      (runs) => runs.some((r) => r.status === 'running'),
      POLL.list,
    ),
  });

export const useFlowRun = (id?: string) =>
  useQuery({
    queryKey: keys.flowRun(id ?? ''),
    queryFn: () => http.get<FlowRun>(`/e2e-runs/${id}`),
    enabled: !!id,
    refetchInterval: pollWhile<FlowRun>((run) => run.status === 'running', POLL.live),
  });

/** Stop: hentikan flow beserta semua test yang sedang berjalan di dalamnya. */
export function useStopFlowRun() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<FlowRun>(`/e2e-runs/${id}/stop`),
    onSuccess: (run) =>
      invalidate(
        keys.flowRun(run.id),
        keys.flowRunsAll(run.projectId),
        keys.flows(run.projectId),
        keys.uiRunsAll(run.projectId),
        keys.runsAll(run.projectId),
      ),
  });
}

export function useDeleteFlowRun(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/e2e-runs/${id}`),
    onSuccess: () => invalidate(keys.flowRunsAll(projectId), keys.flows(projectId)),
  });
}
