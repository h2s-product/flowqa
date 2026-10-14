import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Run, RunStatus, Scenario, Schedule, StartRunRequest } from '@flowqa/shared';
import { http, toQuery } from '../client';
import { POLL, keys, pollWhile } from './keys';
import { useInvalidate } from './shared';

export type ScenarioWithLastRun = Scenario & {
  lastRun: { id: string; status: RunStatus; startedAt: string; environmentName: string } | null;
};

export const useScenarios = (projectId?: string) =>
  useQuery({
    queryKey: keys.scenarios(projectId ?? ''),
    queryFn: () => http.get<ScenarioWithLastRun[]>(`/projects/${projectId}/scenarios`),
    enabled: !!projectId,
  });

export const useScenario = (id?: string) =>
  useQuery({
    queryKey: keys.scenario(id ?? ''),
    queryFn: () => http.get<Scenario>(`/scenarios/${id}`),
    enabled: !!id,
  });

export function useCreateScenario(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (s: Partial<Scenario>) => http.post<Scenario>(`/projects/${projectId}/scenarios`, s),
    onSuccess: () => invalidate(keys.scenarios(projectId)),
  });
}

export function useUpdateScenario() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (s: Scenario) => http.put<Scenario>(`/scenarios/${s.id}`, s),
    onSuccess: (saved) => {
      client.setQueryData(keys.scenario(saved.id), saved);
      client.invalidateQueries({ queryKey: keys.scenarios(saved.projectId) });
    },
  });
}

export function useDuplicateScenario(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<Scenario>(`/scenarios/${id}/duplicate`),
    onSuccess: () => invalidate(keys.scenarios(projectId)),
  });
}

export function useDeleteScenario(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/scenarios/${id}`),
    onSuccess: () => invalidate(keys.scenarios(projectId), keys.schedules(projectId)),
  });
}

/* -------------------------------- runs -------------------------------- */

export const useRuns = (
  projectId: string | undefined,
  filter: { status?: string; scenarioId?: string; limit?: number } = {},
) =>
  useQuery({
    queryKey: keys.runs(projectId ?? '', filter),
    queryFn: () => http.get<Run[]>(`/projects/${projectId}/runs${toQuery(filter)}`),
    enabled: !!projectId,
    refetchInterval: pollWhile<Run[]>((runs) => runs.some((r) => r.status === 'running'), POLL.list),
  });

/** Detail run; polling selama status masih running. */
export const useRun = (id?: string | null) =>
  useQuery({
    queryKey: keys.run(id ?? ''),
    queryFn: () => http.get<Run>(`/runs/${id}`),
    enabled: !!id,
    refetchInterval: pollWhile<Run>((run) => run.status === 'running', POLL.live),
  });

/** Stop: hentikan API run yang sedang berjalan. */
export function useStopRun() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<Run>(`/runs/${id}/stop`),
    onSuccess: (run) =>
      invalidate(keys.run(run.id), keys.runsAll(run.projectId), keys.scenarios(run.projectId)),
  });
}

export function useStartRun() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (req: StartRunRequest) => http.post<Run>('/runs', req),
    onSuccess: (run) =>
      invalidate(
        keys.runsAll(run.projectId),
        keys.scenarios(run.projectId),
        keys.dashboardFor(run.projectId),
      ),
  });
}

/** Jalankan scenario lalu buka halaman hasilnya. */
export function useStartRunAndOpen() {
  const start = useStartRun();
  const navigate = useNavigate();
  return {
    ...start,
    run: (req: StartRunRequest) => start.mutate(req, { onSuccess: (r) => navigate(`/runs/${r.id}`) }),
  };
}

/** Run all / Run folder. `folderId` membatasi ke scenario di folder itu beserta subfoldernya. */
export function useRunAll(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ environmentId, folderId }: { environmentId: string; folderId?: string | null }) =>
      http.post<{ queued: number }>(`/projects/${projectId}/run-all`, { environmentId, folderId }),
    onSuccess: () => invalidate(keys.runsAll(projectId), keys.scenarios(projectId)),
  });
}

/* ------------------------------ schedules ------------------------------ */

export const useSchedules = (projectId?: string) =>
  useQuery({
    queryKey: keys.schedules(projectId ?? ''),
    queryFn: () => http.get<Schedule[]>(`/projects/${projectId}/schedules`),
    enabled: !!projectId,
  });

export function useSaveSchedule(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (s: Partial<Schedule>) =>
      s.id
        ? http.put<Schedule>(`/schedules/${s.id}`, s)
        : http.post<Schedule>(`/projects/${projectId}/schedules`, s),
    onSuccess: () => invalidate(keys.schedules(projectId), keys.dashboardFor(projectId)),
  });
}

export function useDeleteSchedule(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/schedules/${id}`),
    onSuccess: () => invalidate(keys.schedules(projectId)),
  });
}

export function useRunSchedule(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<Run>(`/schedules/${id}/run`),
    onSuccess: () =>
      invalidate(keys.schedules(projectId), keys.runsAll(projectId), keys.dashboardFor(projectId)),
  });
}
