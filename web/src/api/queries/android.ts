import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AndroidConnectionResult,
  AndroidDevice,
  AndroidEnvironmentReport,
  AndroidSetupJob,
  AndroidSetupStep,
  AppiumHealth,
  AvdOptions,
  CreateAvdInput,
  FirebaseEvent,
  FirebaseRelease,
  FirebaseSettings,
  FirebaseSettingsView,
  ProjectApp,
  UploadedApk,
} from '@flowqa/shared';
import { ApiError, apiUrl, http } from '../client';
import { keys, pollWhile } from './keys';
import { useInvalidate } from './shared';

export interface SetupOptions {
  acceptLicenses: boolean;
  configureShell: boolean;
}

/* ---------------------------- environment ---------------------------- */

/** Preflight Android (admin). Perintahnya benar-benar dijalankan di server, jadi bisa beberapa detik. */
export const useAndroidEnvironment = (enabled = true) =>
  useQuery({
    queryKey: keys.androidEnvironment,
    queryFn: () => http.get<AndroidEnvironmentReport>('/android/environment'),
    enabled,
    staleTime: 30_000,
  });

export const useAndroidSetupPlan = () =>
  useMutation({
    mutationFn: (options: SetupOptions) =>
      http.post<{ report: AndroidEnvironmentReport; steps: AndroidSetupStep[]; blocked: string[] }>(
        '/android/setup/plan',
        options,
      ),
  });

export function useStartAndroidSetup() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (options: SetupOptions) => http.post<AndroidSetupJob>('/android/setup', options),
    onSuccess: () => invalidate(keys.androidSetup),
  });
}

/** Pekerjaan setup terakhir; polling selama berjalan. */
export const useAndroidSetupJob = (enabled = true) =>
  useQuery({
    queryKey: keys.androidSetup,
    queryFn: () => http.get<AndroidSetupJob | null>('/android/setup'),
    enabled,
    refetchInterval: pollWhile<AndroidSetupJob | null>((job) => job?.status === 'running', 1_000),
  });

/* ------------------------------ Appium ------------------------------ */

export const useAppiumHealth = () =>
  useQuery({ queryKey: keys.androidAppium, queryFn: () => http.get<AppiumHealth>('/android/appium') });

export function useAppiumServer() {
  const invalidate = useInvalidate();
  const done = () => invalidate(keys.androidAppium, keys.androidEnvironment, keys.androidAppiumLog);
  return {
    start: useMutation({
      mutationFn: () => http.post<AppiumHealth>('/android/appium/start'),
      onSuccess: done,
    }),
    stop: useMutation({ mutationFn: () => http.post<AppiumHealth>('/android/appium/stop'), onSuccess: done }),
  };
}

export const useAppiumLog = (enabled: boolean) =>
  useQuery({
    queryKey: keys.androidAppiumLog,
    queryFn: () => http.get<{ lines: string[] }>('/android/appium/log'),
    enabled,
    refetchInterval: enabled ? 3_000 : false,
  });

/* ------------------------------ devices ------------------------------ */

/** Device Manager: emulator, HP, AVD. Polling agar status BOOTING/BUSY ikut berubah. */
export const useAndroidDevices = (enabled = true, live = false) =>
  useQuery({
    queryKey: keys.androidDevices,
    queryFn: () => http.get<AndroidDevice[]>('/android/devices'),
    enabled,
    staleTime: 5_000,
    refetchInterval: live ? 4_000 : false,
  });

export function useDeviceActions() {
  const invalidate = useInvalidate();
  const done = () => invalidate(keys.androidDevices, keys.androidEnvironment);
  return {
    startEmulator: useMutation({
      mutationFn: (avd: string) =>
        http.post<AndroidDevice[]>(`/android/emulators/${encodeURIComponent(avd)}/start`),
      onSuccess: done,
    }),
    /** `force`: emulator BUSY — test yang memakainya dihentikan, emulator dimatikan / di-kill. */
    stopEmulator: useMutation({
      mutationFn: ({ serial, force = false }: { serial: string; force?: boolean }) =>
        http.post<{ devices: AndroidDevice[]; message: string }>(
          `/android/devices/${encodeURIComponent(serial)}/stop`,
          { force },
        ),
      onSuccess: done,
    }),
  };
}

export const useAvdOptions = (enabled: boolean) =>
  useQuery({
    queryKey: keys.androidAvdOptions,
    queryFn: () => http.get<AvdOptions>('/android/avd/options'),
    enabled,
    staleTime: 60_000,
  });

export function useCreateAvd() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateAvdInput) => http.post<AndroidSetupJob>('/android/avd', input),
    onSuccess: () => invalidate(keys.androidAvdJob),
  });
}

export const useAvdJob = (enabled: boolean) =>
  useQuery({
    queryKey: keys.androidAvdJob,
    queryFn: () => http.get<AndroidSetupJob | null>('/android/avd/job'),
    enabled,
    refetchInterval: pollWhile<AndroidSetupJob | null>((job) => job?.status === 'running', 1_000),
  });

/** Test Android Connection: membuat sesi Appium sungguhan (bisa ±20–60 detik). */
export const useTestAndroidConnection = () =>
  useMutation({
    mutationFn: (body: {
      mode: 'emulator' | 'device';
      udid?: string;
      app?: string;
      appPackage?: string;
      appActivity?: string;
    }) => http.post<AndroidConnectionResult>('/android/test-connection', body),
  });

/* -------------------------------- APK -------------------------------- */

export const useApks = () =>
  useQuery({ queryKey: keys.androidApks, queryFn: () => http.get<UploadedApk[]>('/android/apks') });

/** Upload APK sebagai body biner (tanpa multipart). */
export function useUploadApk() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (file: File) => {
      const response = await fetch(apiUrl(`/android/apks?name=${encodeURIComponent(file.name)}`), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'FlowQA', 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new ApiError(response.status, data.error ?? `Upload failed (${response.status})`);
      return data as UploadedApk;
    },
    onSuccess: () => invalidate(keys.androidApks),
  });
}

export function useDeleteApk() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string) => http.delete(`/android/apks/${encodeURIComponent(name)}`),
    onSuccess: () => invalidate(keys.androidApks),
  });
}

/* ---------------------- Firebase App Distribution ---------------------- */
/* Koneksi Firebase per app Android (Apps). */

/** App Android yang koneksi Firebase-nya dipakai. */
export interface AppRef {
  projectId: string;
  appId: string;
}
const fb = ({ projectId, appId }: AppRef) => `/projects/${projectId}/apps/${appId}/firebase`;

export const useFirebaseSettings = (ref: AppRef, enabled = true) =>
  useQuery({
    queryKey: keys.firebase(ref.appId),
    queryFn: () => http.get<FirebaseSettingsView>(fb(ref)),
    enabled: enabled && !!ref.appId,
  });

export function useSaveFirebaseSettings(ref: AppRef) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (settings: Partial<FirebaseSettings>) => http.put<FirebaseSettingsView>(fb(ref), settings),
    onSuccess: () => invalidate(keys.firebase(ref.appId), keys.firebaseReleases(ref.appId)),
  });
}

export function useResetFirebaseSettings(ref: AppRef) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => http.delete<FirebaseSettingsView>(fb(ref)),
    onSuccess: () => invalidate(keys.firebase(ref.appId), keys.firebaseReleases(ref.appId)),
  });
}

export const useTestFirebase = (ref: AppRef) =>
  useMutation({
    mutationFn: (settings: Partial<FirebaseSettings>) =>
      http.post<{ ok: boolean; message: string; latest?: FirebaseRelease }>(`${fb(ref)}/test`, settings),
  });

export const useFirebaseReleases = (ref: AppRef, enabled: boolean) =>
  useQuery({
    queryKey: keys.firebaseReleases(ref.appId),
    queryFn: () => http.get<FirebaseRelease[]>(`${fb(ref)}/releases`),
    enabled: enabled && !!ref.appId,
    retry: false,
  });

export const useFirebaseEvents = (ref: AppRef, enabled: boolean) =>
  useQuery({
    queryKey: keys.firebaseEvents(ref.appId),
    queryFn: () => http.get<FirebaseEvent[]>(`${fb(ref)}/events`),
    enabled: enabled && !!ref.appId,
    refetchInterval: enabled ? 15_000 : false,
  });

export function useFirebaseActions(ref: AppRef) {
  const invalidate = useInvalidate();
  const done = () =>
    invalidate(
      keys.firebase(ref.appId),
      keys.firebaseReleases(ref.appId),
      keys.firebaseEvents(ref.appId),
      keys.androidApks,
    );
  return {
    download: useMutation({
      mutationFn: (id: string) =>
        http.post<UploadedApk & { release: string }>(
          `${fb(ref)}/releases/${encodeURIComponent(id)}/download`,
        ),
      onSuccess: done,
    }),
    install: useMutation({
      mutationFn: ({ id, mode, udid }: { id: string; mode: 'emulator' | 'device'; udid?: string }) =>
        http.post<{ release: string; device: string }>(
          `${fb(ref)}/releases/${encodeURIComponent(id)}/install`,
          {
            mode,
            udid,
          },
        ),
      onSuccess: done,
    }),
    check: useMutation({
      mutationFn: () => http.post<FirebaseEvent>(`${fb(ref)}/check`),
      onSuccess: done,
    }),
  };
}

/* ------------------------------ apps per project ------------------------------ */

export const useApps = (projectId?: string) =>
  useQuery({
    queryKey: keys.apps(projectId ?? ''),
    queryFn: () => http.get<ProjectApp[]>(`/projects/${projectId}/apps`),
    enabled: !!projectId,
    staleTime: 30_000,
  });

export function useSaveApp(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (app: Partial<ProjectApp>) =>
      app.id
        ? http.put<ProjectApp>(`/projects/${projectId}/apps/${app.id}`, app)
        : http.post<ProjectApp>(`/projects/${projectId}/apps`, app),
    onSuccess: () => invalidate(keys.apps(projectId)),
  });
}

export function useDeleteApp(projectId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (appId: string) => http.delete<void>(`/projects/${projectId}/apps/${appId}`),
    onSuccess: () => invalidate(keys.apps(projectId), keys.uiTests(projectId)),
  });
}
