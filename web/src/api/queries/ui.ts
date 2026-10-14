import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type {
  MobileActionResult,
  MobileAppConfig,
  MobileExecutionMode,
  SelectorTestResult,
  MobileInspectorAction,
  MobileInspectorSession,
  MobileScreen,
  RecordingLogin,
  RecordingSession,
  UiRun,
  UiRunPace,
  UiSchedule,
  UiTestCase,
} from '@flowqa/shared';
import { LIVE_RECORDING_STATUSES, LIVE_UI_RUN_STATUSES } from '@flowqa/shared';
import { http, toQuery } from '../client';
import { POLL, keys, pollWhile } from './keys';
import { useInvalidate } from './shared';

/** Daftar UI run tidak membawa hasil per step. */
export type UiRunSummary = Omit<UiRun, 'steps'>;
export type UiTestWithLastRun = UiTestCase & { lastRun: UiRunSummary | null };

export const useUiTests = (projectId?: string) =>
  useQuery({
    queryKey: keys.uiTests(projectId ?? ''),
    queryFn: () => http.get<UiTestWithLastRun[]>(`/projects/${projectId}/ui-tests`),
    enabled: !!projectId,
    refetchInterval: pollWhile<UiTestWithLastRun[]>(
      (tests) => tests.some((t) => !!t.lastRun && LIVE_UI_RUN_STATUSES.includes(t.lastRun.status)),
      POLL.list,
    ),
  });

export const useUiTest = (id?: string) =>
  useQuery({
    queryKey: keys.uiTest(id ?? ''),
    queryFn: () => http.get<UiTestCase>(`/ui-tests/${id}`),
    enabled: !!id,
  });

export function useSaveUiTest(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (t: Partial<UiTestCase>) =>
      t.id
        ? http.put<UiTestCase>(`/ui-tests/${t.id}`, t)
        : http.post<UiTestCase>(`/projects/${projectId}/ui-tests`, t),
    onSuccess: (saved) => {
      client.setQueryData(keys.uiTest(saved.id), saved);
      client.invalidateQueries({ queryKey: keys.uiTests(projectId) });
    },
  });
}

export function useDeleteUiTest(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/ui-tests/${id}`),
    onSuccess: () => invalidate(keys.uiTests(projectId)),
  });
}

export function useDuplicateUiTest(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<UiTestCase>(`/ui-tests/${id}/duplicate`),
    onSuccess: () => invalidate(keys.uiTests(projectId)),
  });
}

/** Tambah contoh UI test untuk demo shop bawaan (/demo-web). */
export function useAddDemoUiTest(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => http.post<UiTestCase>(`/projects/${projectId}/ui-tests/demo`),
    onSuccess: () => invalidate(keys.uiTests(projectId)),
  });
}

/* -------------------------------- runs -------------------------------- */

export const useUiRuns = (projectId?: string, filter: { testId?: string; limit?: number } = {}) =>
  useQuery({
    queryKey: keys.uiRuns(projectId ?? '', filter),
    queryFn: () => http.get<UiRunSummary[]>(`/projects/${projectId}/ui-runs${toQuery(filter)}`),
    enabled: !!projectId,
    refetchInterval: pollWhile<UiRunSummary[]>(
      (runs) => runs.some((r) => LIVE_UI_RUN_STATUSES.includes(r.status)),
      POLL.list,
    ),
  });

/** Detail UI run; polling selama masih berjalan. */
export const useUiRun = (id?: string) =>
  useQuery({
    queryKey: keys.uiRun(id ?? ''),
    queryFn: () => http.get<UiRun>(`/ui-runs/${id}`),
    enabled: !!id,
    refetchInterval: pollWhile<UiRun>((run) => LIVE_UI_RUN_STATUSES.includes(run.status), POLL.live),
  });

/** Stop: hentikan UI run (web / mobile) yang berjalan atau masih antre perangkat. */
export function useStopUiRun() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<UiRun>(`/ui-runs/${id}/stop`),
    onSuccess: (run) =>
      invalidate(keys.uiRun(run.id), keys.uiRunsAll(run.projectId), keys.uiTests(run.projectId)),
  });
}

interface RunUiTestVars {
  id: string;
  headless: boolean;
  /** Kosong = bawaan server: browser terlihat → "recorded", headless → "fast". */
  pace?: UiRunPace;
  environmentId?: string;
  /** Test mobile: Mock / Android Emulator / Android Device. */
  mode?: MobileExecutionMode;
}

export function useRunUiTest(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: RunUiTestVars) => http.post<UiRun>(`/ui-tests/${id}/run`, body),
    onSuccess: () => invalidate(keys.uiTests(projectId), keys.uiRunsAll(projectId)),
  });
}

/** Jalankan banyak UI test berurutan di latar belakang (bulk run). */
export function useRunUiTestsBatch(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: {
      ids: string[];
      headless?: boolean;
      environmentId?: string;
      mode?: MobileExecutionMode;
    }) => http.post<{ queued: number; skipped: string[] }>(`/projects/${projectId}/ui-tests/run-batch`, body),
    onSuccess: () => invalidate(keys.uiTests(projectId), keys.uiRunsAll(projectId)),
  });
}

/** Jalankan UI test lalu buka halaman hasilnya. */
export function useRunUiTestAndOpen(projectId: string) {
  const start = useRunUiTest(projectId);
  const navigate = useNavigate();
  return {
    ...start,
    run: (vars: RunUiTestVars) => start.mutate(vars, { onSuccess: (r) => navigate(`/ui/runs/${r.id}`) }),
  };
}

/* ------------------------------ recorder ------------------------------ */

/** Sesi rekaman; polling cepat selama browser perekam masih terbuka (berhenti bila error). */
export const useRecording = (id?: string) =>
  useQuery({
    queryKey: keys.recording(id ?? ''),
    queryFn: () => http.get<RecordingSession>(`/ui-recordings/${id}`),
    enabled: !!id,
    retry: false,
    refetchInterval: (query) =>
      query.state.status !== 'error' &&
      LIVE_RECORDING_STATUSES.includes(query.state.data?.status ?? 'starting')
        ? POLL.live
        : false,
  });

export function useStartRecording(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: {
      name?: string;
      startUrl?: string;
      folderId?: string | null;
      testCaseId?: string;
      environmentId?: string;
      login?: RecordingLogin;
      /** Simpan URL/login yang diketik sebagai {{WEB_URL}}, {{WEB_USER}}, {{WEB_PASSWORD}}. */
      remember?: { url?: boolean; user?: boolean; password?: boolean };
    }) => http.post<RecordingSession>(`/projects/${projectId}/ui-recordings`, body),
    // Variabel environment bisa bertambah (URL & login yang diingat).
    onSuccess: (_session, body) => body.remember && invalidate(keys.environments(projectId)),
  });
}

/** Aksi pada satu sesi rekaman (stop, hapus step, simpan, batal). */
export function useRecordingActions(id: string, projectId: string) {
  const client = useQueryClient();
  const set = (s: RecordingSession) => client.setQueryData(keys.recording(id), s);
  return {
    stop: useMutation({
      mutationFn: () => http.post<RecordingSession>(`/ui-recordings/${id}/stop`),
      onSuccess: set,
    }),
    removeStep: useMutation({
      mutationFn: (stepId: string) => http.delete<RecordingSession>(`/ui-recordings/${id}/steps/${stepId}`),
      onSuccess: set,
    }),
    save: useMutation({
      mutationFn: (body: { name?: string; folderId?: string | null }) =>
        http.post<UiTestCase>(`/ui-recordings/${id}/save`, body),
      onSuccess: (saved) => {
        client.setQueryData(keys.uiTest(saved.id), saved);
        client.invalidateQueries({ queryKey: keys.uiTests(projectId) });
      },
    }),
    cancel: useMutation({ mutationFn: () => http.delete(`/ui-recordings/${id}`) }),
  };
}

/* ---------------------------- Test Scheduler ---------------------------- */

export const useUiSchedules = (projectId?: string) =>
  useQuery({
    queryKey: keys.uiSchedules(projectId ?? ''),
    queryFn: () => http.get<UiSchedule[]>(`/projects/${projectId}/ui-schedules`),
    enabled: !!projectId,
    // Ringkasan run terakhir diperbarui selama jadwal sedang berjalan.
    refetchInterval: pollWhile<UiSchedule[]>(
      (list) => list.some((s) => s.lastBatch && !s.lastBatch.finishedAt),
      POLL.list,
    ),
  });

export function useSaveUiSchedule(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (s: Partial<UiSchedule>) =>
      s.id
        ? http.put<UiSchedule>(`/ui-schedules/${s.id}`, s)
        : http.post<UiSchedule>(`/projects/${projectId}/ui-schedules`, s),
    onSuccess: () => invalidate(keys.uiSchedules(projectId)),
  });
}

export function useDeleteUiSchedule(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.delete(`/ui-schedules/${id}`),
    onSuccess: () => invalidate(keys.uiSchedules(projectId)),
  });
}

export function useRunUiScheduleNow(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => http.post<{ queued: number; skipped: number }>(`/ui-schedules/${id}/run`),
    onSuccess: () =>
      invalidate(keys.uiSchedules(projectId), keys.uiRunsAll(projectId), keys.uiTests(projectId)),
  });
}

/* --------------------------- Mobile Inspector --------------------------- */

const INSPECTOR_LIVE = ['queued', 'starting', 'busy'];

export const useInspector = (id?: string) =>
  useQuery({
    queryKey: keys.inspector(id ?? ''),
    queryFn: () => http.get<MobileInspectorSession>(`/mobile-inspector/${id}`),
    enabled: !!id,
    refetchInterval: pollWhile<MobileInspectorSession>((s) => INSPECTOR_LIVE.includes(s.status), POLL.live),
  });

/** Screenshot + elemen layar; dimuat ulang manual (tombol Refresh) & setelah setiap aksi. */
/** Layar Inspector. `liveMs` > 0 → ambil ulang berkala (mis. menunggu splash screen selesai). */
export const useInspectorScreen = (id: string, enabled: boolean, liveMs: number | false = false) =>
  useQuery({
    queryKey: keys.inspectorScreen(id),
    queryFn: () => http.get<MobileScreen>(`/mobile-inspector/${id}/screen`),
    enabled,
    staleTime: Infinity,
    refetchInterval: enabled ? liveMs : false,
    retry: false,
  });

export function useStartInspector(projectId: string) {
  return useMutation({
    mutationFn: (body: {
      name?: string;
      folderId?: string | null;
      testCaseId?: string;
      environmentId?: string;
      mobile?: MobileAppConfig;
      mode?: MobileExecutionMode;
    }) => http.post<MobileInspectorSession>(`/projects/${projectId}/mobile-inspector`, body),
  });
}

export function useInspectorActions(id: string, projectId: string) {
  const client = useQueryClient();
  const set = (s: MobileInspectorSession) => client.setQueryData(keys.inspector(id), s);
  return {
    act: useMutation({
      mutationFn: (action: MobileInspectorAction) =>
        http.post<MobileActionResult>(`/mobile-inspector/${id}/actions`, action),
      onSuccess: (result) => {
        set(result.session);
        // Layar berubah setelah aksi.
        void client.invalidateQueries({ queryKey: keys.inspectorScreen(id) });
      },
    }),
    removeStep: useMutation({
      mutationFn: (stepId: string) =>
        http.delete<MobileInspectorSession>(`/mobile-inspector/${id}/steps/${stepId}`),
      onSuccess: set,
    }),
    save: useMutation({
      mutationFn: (body: { name?: string; folderId?: string | null }) =>
        http.post<UiTestCase>(`/mobile-inspector/${id}/save`, body),
      onSuccess: () => client.invalidateQueries({ queryKey: keys.uiTests(projectId) }),
    }),
    cancel: useMutation({ mutationFn: () => http.delete(`/mobile-inspector/${id}`) }),
    testSelector: useMutation({
      mutationFn: (selector: string) =>
        http.post<SelectorTestResult>(`/mobile-inspector/${id}/selector`, { selector }),
    }),
  };
}
