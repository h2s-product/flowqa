import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  DashboardData,
  Environment,
  NotificationStatus,
  Project,
  ReportData,
  ReportKind,
  RunStatus,
} from '@flowqa/shared';
import { http, toQuery } from '../client';
import { POLL, keys } from './keys';
import { useInvalidate } from './shared';

export type ProjectWithStats = Project & {
  stats: {
    apis: number;
    scenarios: number;
    environments: number;
    lastRun: { id: string; status: RunStatus; startedAt: string; environmentName: string } | null;
  };
};

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => http.get<ProjectWithStats[]>('/projects') });

export function useSaveProject() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (p: Partial<Project>) =>
      p.id ? http.put<Project>(`/projects/${p.id}`, p) : http.post<Project>('/projects', p),
    onSuccess: () => invalidate(keys.projects, keys.dashboard, keys.environmentsAll),
  });
}

/* ---------------------------- notifications ---------------------------- */

/** Apakah server sudah bisa mengirim email (SMTP diisi di .env). */
export const useNotificationStatus = () =>
  useQuery({
    queryKey: keys.notificationStatus,
    queryFn: () => http.get<NotificationStatus>('/notifications/status'),
    staleTime: 60_000,
  });

/** Kirim email percobaan ke penerima yang sedang diisi di form. */
export const useSendTestEmail = (projectId: string) =>
  useMutation({
    mutationFn: (recipients: string[]) =>
      http.post<{ sentTo: string[] }>(`/projects/${projectId}/notifications/test`, { recipients }),
  });

/** Kirim laporan ke email; `html` = tampilan halaman Reports sebagai lampiran. */
export const useEmailReport = (projectId: string) =>
  useMutation({
    mutationFn: (body: {
      kind: ReportKind;
      filter: { from: string; to: string; environmentId?: string; folderId?: string };
      recipients: string[];
      message: string;
      html: string;
      fileName: string;
    }) => http.post<{ sentTo: string[] }>(`/projects/${projectId}/reports/email`, body),
  });

/* ---------------------------- environments ---------------------------- */

export const useEnvironments = (projectId?: string) =>
  useQuery({
    queryKey: keys.environments(projectId ?? ''),
    queryFn: () => http.get<Environment[]>(`/projects/${projectId}/environments`),
    enabled: !!projectId,
  });

export function useSaveEnvironment(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (e: Partial<Environment>) =>
      e.id
        ? http.put<Environment>(`/environments/${e.id}`, e)
        : http.post<Environment>(`/projects/${projectId}/environments`, e),
    onSuccess: () => invalidate(keys.environments(projectId)),
  });
}

export function useDeleteEnvironment(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/environments/${id}`),
    onSuccess: () => invalidate(keys.environments(projectId), keys.schedules(projectId)),
  });
}

/* ------------------------- dashboard & report ------------------------- */

/** Dashboard project terpilih. */
export const useDashboard = (projectId?: string) =>
  useQuery({
    queryKey: keys.dashboardFor(projectId ?? ''),
    queryFn: () => http.get<DashboardData>(`/projects/${projectId}/dashboard`),
    enabled: !!projectId,
    refetchInterval: POLL.dashboard,
  });

/** Laporan hasil test: `api` = scenario, `ui` = UI test case. */
export const useReport = (
  kind: ReportKind,
  projectId: string | undefined,
  filter: { from: string; to: string; environmentId?: string; folderId?: string },
) =>
  useQuery({
    queryKey: keys.report(kind, projectId ?? '', filter),
    queryFn: () =>
      http.get<ReportData>(
        `/projects/${projectId}/${kind === 'ui' ? 'ui-report' : 'report'}${toQuery(filter)}`,
      ),
    enabled: !!projectId,
    placeholderData: (previous) => previous,
  });
