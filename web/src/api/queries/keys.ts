import type { FolderKind } from '@flowqa/shared';

/**
 * Semua query key React Query. Key berbentuk [domain, projectId, ...] sehingga
 * invalidasi dengan prefix (mis. runsAll) ikut menyegarkan semua variasi filter.
 */
export const keys = {
  dashboard: ['dashboard'] as const,
  dashboardFor: (projectId: string) => ['dashboard', projectId] as const,
  projects: ['projects'] as const,
  notificationStatus: ['notificationStatus'] as const,
  emailSettings: ['settings', 'email'] as const,
  appiumSettings: ['settings', 'appium'] as const,
  androidDevices: ['android', 'devices'] as const,
  androidEnvironment: ['android', 'environment'] as const,
  androidSetup: ['android', 'setup'] as const,
  androidAppium: ['android', 'appium'] as const,
  androidAppiumLog: ['android', 'appium', 'log'] as const,
  androidAvdOptions: ['android', 'avd', 'options'] as const,
  androidAvdJob: ['android', 'avd', 'job'] as const,
  androidApks: ['android', 'apks'] as const,
  firebase: ['android', 'firebase'] as const,
  firebaseReleases: ['android', 'firebase', 'releases'] as const,
  firebaseEvents: ['android', 'firebase', 'events'] as const,
  inspector: (id: string) => ['inspector', id] as const,
  inspectorScreen: (id: string) => ['inspector', id, 'screen'] as const,
  environments: (projectId: string) => ['environments', projectId] as const,
  environmentsAll: ['environments'] as const,
  apis: (projectId: string) => ['apis', projectId] as const,
  folders: (kind: FolderKind, projectId: string) => ['folders', kind, projectId] as const,
  scenarios: (projectId: string) => ['scenarios', projectId] as const,
  scenario: (id: string) => ['scenario', id] as const,
  runsAll: (projectId: string) => ['runs', projectId] as const,
  runs: (projectId: string, filter: object = {}) => ['runs', projectId, filter] as const,
  run: (id: string) => ['run', id] as const,
  schedules: (projectId: string) => ['schedules', projectId] as const,
  perfTests: (projectId: string) => ['perfTests', projectId] as const,
  perfRunsAll: (projectId: string) => ['perfRuns', projectId] as const,
  perfRuns: (projectId: string, filter: object = {}) => ['perfRuns', projectId, filter] as const,
  perfRun: (id: string) => ['perfRun', id] as const,
  users: ['users'] as const,
  uiTests: (projectId: string) => ['uiTests', projectId] as const,
  uiTest: (id: string) => ['uiTest', id] as const,
  uiRunsAll: (projectId: string) => ['uiRuns', projectId] as const,
  uiRuns: (projectId: string, filter: object = {}) => ['uiRuns', projectId, filter] as const,
  uiRun: (id: string) => ['uiRun', id] as const,
  uiSchedules: (projectId: string) => ['uiSchedules', projectId] as const,
  recording: (id: string) => ['recording', id] as const,
  flows: (projectId: string) => ['flows', projectId] as const,
  flow: (id: string) => ['flow', id] as const,
  flowRunsAll: (projectId: string) => ['flowRuns', projectId] as const,
  flowRuns: (projectId: string, filter: object = {}) => ['flowRuns', projectId, filter] as const,
  flowRun: (id: string) => ['flowRun', id] as const,
  reportsAll: ['report'] as const,
  report: (kind: string, projectId: string, filter: object) => ['report', kind, projectId, filter] as const,
};

/** Interval polling (ms) untuk data yang masih berubah. */
export const POLL = {
  /** Detail yang sedang berjalan (run, UI run, rekaman). */
  live: 800,
  /** Daftar yang berisi item yang sedang berjalan. */
  list: 1500,
  /** Performance run (metrik per detik). */
  perf: 1000,
  /** Dashboard. */
  dashboard: 15_000,
};

/** refetchInterval yang aktif hanya selama `active(data)` bernilai true. */
export const pollWhile =
  <T>(active: (data: T) => boolean, ms: number) =>
  (query: { state: { data?: T; status: string } }) =>
    query.state.status !== 'error' && query.state.data !== undefined && active(query.state.data) ? ms : false;
