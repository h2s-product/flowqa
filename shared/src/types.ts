/**
 * Domain model Testora.
 * File ini adalah satu-satunya sumber kebenaran untuk bentuk data yang
 * dipertukarkan antara server (API + test runner) dan web (UI).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface KeyValue {
  key: string;
  value: string;
}

/* ------------------------------------------------------------------ */
/* Project                                                             */
/* ------------------------------------------------------------------ */

export interface Project extends Timestamps {
  id: string;
  name: string;
  description: string;
  owner: string;
  team: string;
  tags: string[];
  /** Kosong pada project lama = notifikasi mati. */
  notifications?: ProjectNotifications;
}

/** Kapan hasil test dikirim ke email: setiap run, atau hanya bila gagal. */
export const NOTIFY_WHEN = ['always', 'failed'] as const;
export type NotifyWhen = (typeof NOTIFY_WHEN)[number];

export interface ProjectNotifications {
  email: {
    enabled: boolean;
    recipients: string[];
    when: NotifyWhen;
  };
}

/** Batas jumlah penerima email per project. */
export const MAX_NOTIFY_RECIPIENTS = 20;

/** Keamanan koneksi SMTP: ssl = TLS langsung (port 465), starttls = naik ke TLS (587), none = tanpa TLS. */
export const SMTP_SECURITY = ['starttls', 'ssl', 'none'] as const;
export type SmtpSecurity = (typeof SMTP_SECURITY)[number];

/** Pengaturan email hasil test (Settings → Email Report). */
export interface EmailSettings {
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  /** Tidak pernah dikirim ke UI: respons berisi SECRET_MASK bila tersimpan, kosong bila belum. */
  password: string;
  /** Pengirim, mis. "Testora <qa@perusahaan.com>". */
  from: string;
  /** Alamat web Testora untuk tautan di email. */
  appUrl: string;
  /** Penerima default: dipakai project yang mengaktifkan email tanpa daftar penerima sendiri. */
  recipients: string[];
}

export interface EmailSettingsView extends EmailSettings {
  /** Asal pengaturan yang sedang dipakai: disimpan di aplikasi, dari .env, atau belum ada. */
  source: 'app' | 'env' | 'none';
  passwordSet: boolean;
}

/** Status pengiriman email di server (tanpa detail SMTP). */
export interface NotificationStatus {
  emailConfigured: boolean;
  from: string;
  /** Penerima default dari Settings → Email Report. */
  defaultRecipients: string[];
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

export interface EnvVariable {
  key: string;
  value: string;
  /** Nilai rahasia tidak pernah dikirim ke UI dan selalu disamarkan di log. */
  secret: boolean;
}

export interface Environment extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  baseUrl: string;
  timeoutMs: number;
  verifySsl: boolean;
  proxy: string;
  variables: EnvVariable[];
  headers: KeyValue[];
}

/** Penanda yang dikirim ke UI sebagai pengganti nilai secret. */
export const SECRET_MASK = '••••••••';

/* ------------------------------------------------------------------ */
/* API catalog                                                         */
/* ------------------------------------------------------------------ */

export const FIELD_TYPES = ['text', 'number', 'boolean', 'null'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Satu baris pada visual body builder. `field` mendukung dot notation, mis. address.city */
export interface BodyField {
  field: string;
  type: FieldType;
  value: string;
}

export type AuthType = 'none' | 'bearer';

/** Folder (API Catalog & Test Scenarios). `parentId` null = folder di level teratas. */
export interface Folder extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null;
}

/** Jenis folder: masing-masing punya pohon folder sendiri per project. */
export type FolderKind = 'api' | 'scenario' | 'ui';

export const FOLDER_MAX_DEPTH = 5;

export interface ApiDefinition extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  /** Folder tempat API disimpan. null = belum masuk folder (Unfiled). */
  folderId: string | null;
  method: HttpMethod;
  /** Path relatif terhadap base URL environment. Parameter ditulis {nama}. */
  path: string;
  auth: AuthType;
  contentType: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: BodyField[];
  /** Contoh response, dipakai untuk memilih field sebelum test pernah dijalankan. */
  exampleResponse: unknown;
}

/* ------------------------------------------------------------------ */
/* Scenario & steps                                                    */
/* ------------------------------------------------------------------ */

export const OPERATORS = [
  'equals',
  'not equals',
  'contains',
  'not contains',
  'starts with',
  'ends with',
  'greater than',
  'less than',
  'greater/equal',
  'less/equal',
  'exists',
  'not exists',
  'is empty',
  'is not empty',
  'matches regex',
] as const;
export type Operator = (typeof OPERATORS)[number];
export const UNARY_OPERATORS: Operator[] = ['exists', 'not exists', 'is empty', 'is not empty'];

export const ASSERTION_KINDS = ['status', 'field', 'time', 'schema'] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];

export interface Assertion {
  id: string;
  kind: AssertionKind;
  /** Hanya untuk kind = field. Dot notation, mis. order.status */
  field?: string;
  operator: Operator;
  /** Untuk kind = schema berisi daftar field dipisah koma. Boleh memakai {{variabel}}. */
  expected: string;
}

export interface Capture {
  id: string;
  /** Field response (dot notation) yang diambil nilainya. */
  field: string;
  /** Nama variabel tujuan, dipakai langkah berikutnya sebagai {{nama}}. */
  variable: string;
}

interface StepBase {
  id: string;
  name: string;
  disabled: boolean;
  continueOnFailure: boolean;
}

export interface ApiStep extends StepBase {
  type: 'api';
  apiId: string;
  bodyMode: 'visual' | 'json';
  body: BodyField[];
  bodyJson: string;
  query: KeyValue[];
  headers: KeyValue[];
  /** Nilai untuk {param} pada path. Kosong = memakai {{param}}. */
  pathParams: Record<string, string>;
  /** Variabel yang berisi token untuk header Authorization: Bearer. */
  tokenVariable: string;
  captures: Capture[];
  assertions: Assertion[];
  retries: number;
  repeat: number;
  timeoutMs: number | null;
}

export interface WaitStep extends StepBase {
  type: 'wait';
  durationMs: number;
}

export interface SetVariableStep extends StepBase {
  type: 'setVariable';
  variable: string;
  value: string;
}

export interface ConditionStep extends StepBase {
  type: 'condition';
  left: string;
  operator: Operator;
  right: string;
  /** Jumlah langkah berikutnya yang dilewati jika kondisi salah. */
  skipCount: number;
}

export type Step = ApiStep | WaitStep | SetVariableStep | ConditionStep;
export type StepType = Step['type'];

export interface Scenario extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  /** Folder tempat scenario disimpan. null/undefined = Unfiled. */
  folderId: string | null;
  continueOnFailure: boolean;
  steps: Step[];
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

/** `stopped` = dihentikan pengguna (tombol Stop) sebelum selesai. */
export type RunStatus = 'running' | 'passed' | 'failed' | 'stopped';
export type StepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'not-run';
/** `flow` = dijalankan sebagai node di E2E Flow. */
export type RunTrigger = 'manual' | 'schedule' | 'flow';

export interface AssertionResult {
  assertionId?: string;
  label: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface CaptureResult {
  field: string;
  variable: string;
  ok: boolean;
  value?: unknown;
}

export interface FailureExplanation {
  title: string;
  detail: string;
  fix: string;
}

export interface RecordedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface RecordedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  sizeBytes: number;
  durationMs: number;
}

export interface StepResult {
  index: number;
  stepId: string;
  name: string;
  type: StepType;
  status: StepStatus;
  /** Waktu step mulai & selesai dijalankan (kosong untuk step yang dilewati). */
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  note?: string;
  attempts?: number;
  request?: RecordedRequest;
  response?: RecordedResponse;
  assertions?: AssertionResult[];
  captures?: CaptureResult[];
  explanation?: FailureExplanation;
}

export interface RunCounts {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface Run extends Timestamps {
  id: string;
  projectId: string;
  scenarioId: string;
  scenarioName: string;
  environmentId: string;
  environmentName: string;
  status: RunStatus;
  trigger: RunTrigger;
  mode: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  steps: StepResult[];
  counts: RunCounts;
  /** Variabel hasil capture (secret sudah disamarkan). */
  variables: Record<string, unknown>;
  failedStep?: string;
  failureReason?: string;
  /** Nama pengguna yang menekan Stop. */
  stoppedBy?: string;
}

export interface StartRunRequest {
  scenarioId: string;
  environmentId: string;
  /** Mulai dari langkah ke-n (0-based). Variabel langkah sebelumnya diambil dari run terakhir. */
  fromStep?: number;
  /** Hanya jalankan langkah-langkah ini (0-based). */
  onlySteps?: number[];
}

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

export const SCHEDULE_FREQUENCIES = ['15m', '1h', 'daily', 'weekdays', 'weekly'] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export interface Schedule extends Timestamps {
  id: string;
  projectId: string;
  scenarioId: string;
  environmentId: string;
  frequency: ScheduleFrequency;
  /** HH:mm, dipakai untuk daily, weekdays & weekly. */
  time: string;
  /** Hari untuk "weekly": 0 = Minggu … 6 = Sabtu. */
  day?: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunId: string | null;
  lastRunAt?: string | null;
}

/**
 * Jadwal UI Tester (menu Test Scheduler): sekumpulan UI test case bernama
 * (mis. "Smoke Test", "Regression Test") yang dijalankan berurutan secara berkala.
 */
export interface UiSchedule extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  testIds: string[];
  /** Environment untuk {{variabel}} & step API. Kosong = tanpa environment. */
  environmentId: string | null;
  frequency: ScheduleFrequency;
  time: string;
  day?: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** Ringkasan run jadwal terakhir (diisi saat dimulai, dilengkapi saat selesai). */
  lastBatch?: {
    startedAt: string;
    finishedAt: string | null;
    runIds: string[];
    total: number;
    passed: number;
    failed: number;
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard & import                                                  */
/* ------------------------------------------------------------------ */

export interface DailyRunStat {
  date: string;
  passed: number;
  failed: number;
}

export interface DashboardData {
  /** Dashboard selalu untuk satu project (project yang dipilih di UI). */
  totals: {
    apis: number;
    scenarios: number;
    testCases: number;
    runsToday: number;
    stepsPassedToday: number;
    stepsFailedToday: number;
    stepsSkippedToday: number;
    passRate: number;
    averageDurationMs: number;
    totalRuns: number;
    passedRuns: number;
  };
  trend: DailyRunStat[];
  apiResponseTimes: { apiId: string; name: string; averageMs: number }[];
  recentRuns: Run[];
  recentFailures: Run[];
  upcomingSchedules: (Schedule & { scenarioName: string; environmentName: string })[];
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export type UserRole = 'admin' | 'member';

export interface AuthUser extends Timestamps {
  id: string;
  name: string;
  email: string;
  /** admin: semua project + kelola user. member: hanya project yang diberikan. */
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
}

/** User beserta daftar project yang boleh diakses (untuk halaman User Administration). */
export interface UserAccount extends AuthUser {
  projectIds: string[];
}

export interface SaveUserRequest {
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  projectIds: string[];
  /** Wajib saat membuat user; saat edit, isi hanya untuk mengganti password. */
  password?: string;
}

export interface AuthStatus {
  user: AuthUser | null;
  /** true bila belum ada akun sama sekali; UI menampilkan form pembuatan admin. */
  setupRequired: boolean;
}

export const PASSWORD_MIN_LENGTH = 8;

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

export interface StepStatusCounts {
  passed: number;
  failed: number;
  skipped: number;
  notRun: number;
}

/**
 * Jenis laporan: `api` = scenario API Tester, `ui` = test case UI Tester.
 * Keduanya memakai bentuk data yang sama agar halaman Reports bisa dipakai bersama.
 */
export const REPORT_KINDS = ['api', 'ui'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Hasil satu step di seluruh run dalam periode laporan. */
export interface ReportStep extends StepStatusCounts {
  stepId: string;
  index: number;
  name: string;
  type: StepType | UiStepType;
  /** Status di run terakhir (null = step belum pernah dijalankan dalam periode). */
  lastStatus: StepStatus | UiStepStatus | null;
  /** Waktu step dijalankan di run terakhir. */
  lastStartedAt: string | null;
  lastDurationMs: number | null;
  /** Alasan gagal / catatan dari run terakhir. */
  lastNote: string | null;
}

/**
 * Status item di laporan (dasar pie chart, filter, dan urutan): hasil run
 * terakhir yang sudah selesai dalam periode. Run yang masih berjalan tidak dihitung.
 */
export type ReportItemStatus = 'passing' | 'failing' | 'not-executed';

/** Satu baris laporan: scenario (API) atau UI test case. */
export interface ReportItem {
  id: string;
  name: string;
  folderId: string | null;
  status: ReportItemStatus;
  runs: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
  avgDurationMs: number;
  lastRun: {
    id: string;
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    /** Tempat run dijalankan: nama environment (API) atau browser (UI). */
    target: string;
    durationMs: number;
    trigger: RunTrigger;
    failedStep?: string;
    failureReason?: string;
  } | null;
  steps: ReportStep[];
}

export interface ReportFilter {
  from: string;
  to: string;
  /** Hanya untuk laporan API (UI run tidak terikat environment). */
  environmentId: string | null;
  folderId: string | null;
}

export interface ReportData {
  kind: ReportKind;
  filter: ReportFilter;
  generatedAt: string;
  summary: {
    items: number;
    executedItems: number;
    runs: number;
    passedRuns: number;
    failedRuns: number;
    passRate: number;
    avgDurationMs: number;
    steps: StepStatusCounts;
  };
  /** Status terakhir setiap item dalam periode (untuk pie chart). */
  itemStatus: { passing: number; failing: number; notExecuted: number };
  items: ReportItem[];
}

/** API hasil parse OpenAPI. `tag` = tag OpenAPI pertama, dipakai untuk membuat folder saat impor. */
export type ImportedApi = Omit<ApiDefinition, 'id' | 'projectId' | 'folderId' | 'createdAt' | 'updatedAt'> & {
  tag: string;
};

export interface ImportApisRequest {
  apis: ImportedApi[];
  /** Folder tujuan impor (null = level teratas). */
  targetFolderId: string | null;
  /** Buat subfolder per tag OpenAPI di dalam folder tujuan. */
  folderPerTag: boolean;
}

export interface ImportPreview {
  title: string;
  version: string;
  apis: ImportedApi[];
}

export const DYNAMIC_VARIABLES = [
  { key: 'random_name', label: 'Random name' },
  { key: 'random_email', label: 'Random email' },
  { key: 'random_phone', label: 'Random phone' },
  { key: 'uuid', label: 'UUID' },
  { key: 'random_number', label: 'Random number' },
  { key: 'random_letters', label: 'Random letters' },
  { key: 'random_string', label: 'Random string (8 letters & digits)' },
  { key: 'random_latitude', label: 'Random latitude (Indonesia)' },
  { key: 'random_longitude', label: 'Random longitude (Indonesia)' },
  { key: 'random_polygon', label: 'Random polygon ([[lng,lat],…] closed ring)' },
  { key: 'current_date', label: 'Current date' },
  { key: 'current_month_id', label: 'Current month, Indonesian short name (e.g. Okt)' },
  { key: 'current_year', label: 'Current year (e.g. 2026)' },
  { key: 'current_month_year_id', label: 'Current month & year, Indonesian (e.g. Okt 2026)' },
  { key: 'timestamp', label: 'Current timestamp' },
] as const;
/** Nama variabel dinamis, mis. {{random_email}}. Generator di server wajib mencakup semuanya. */
export type DynamicVariableKey = (typeof DYNAMIC_VARIABLES)[number]['key'];

/* ------------------------------------------------------------------ */
/* Performance & stress testing                                        */
/* ------------------------------------------------------------------ */

export const PERF_TEST_TYPES = ['load', 'stress', 'spike', 'soak'] as const;
export type PerfTestType = (typeof PERF_TEST_TYPES)[number];

/** Satu tahap beban: jumlah VU naik/turun linear ke `targetVus` selama `durationSec`. */
export interface PerfStage {
  durationSec: number;
  targetVus: number;
}

export interface PerfThresholds {
  /** Batas p95 response time (ms). null = tidak dicek. */
  p95Ms: number | null;
  /** Batas persentase request gagal. null = tidak dicek. */
  errorRatePct: number | null;
}

export interface PerfTest extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  scenarioId: string;
  type: PerfTestType;
  stages: PerfStage[];
  /** Jeda tiap VU di antara iterasi scenario. */
  thinkTimeMs: number;
  thresholds: PerfThresholds;
}

export const PERF_LIMITS = { maxVus: 500, maxDurationSec: 3600, maxStages: 20 } as const;

export type PerfRunStatus = 'running' | 'passed' | 'failed' | 'stopped';

export interface LatencyStats {
  count: number;
  min: number;
  avg: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

/** Ringkasan satu detik selama test berjalan. `t` = detik sejak mulai. */
export interface PerfTimelinePoint {
  t: number;
  vus: number;
  requests: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

export interface PerfStepStats {
  stepId: string;
  name: string;
  method: HttpMethod | '';
  path: string;
  errors: number;
  latency: LatencyStats;
}

export interface PerfThresholdResult {
  label: string;
  passed: boolean;
  actual: string;
}

export interface PerfRun extends Timestamps {
  id: string;
  projectId: string;
  testId: string;
  testName: string;
  scenarioId: string;
  scenarioName: string;
  environmentId: string;
  environmentName: string;
  type: PerfTestType;
  stages: PerfStage[];
  thinkTimeMs: number;
  thresholds: PerfThresholds;
  status: PerfRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  plannedDurationSec: number;
  peakVus: number;
  iterations: number;
  failedIterations: number;
  totals: {
    requests: number;
    errors: number;
    rps: number;
    errorRatePct: number;
    latency: LatencyStats;
  };
  timeline: PerfTimelinePoint[];
  steps: PerfStepStats[];
  statusCodes: Record<string, number>;
  topErrors: { message: string; count: number }[];
  thresholdResults: PerfThresholdResult[];
  failureReason?: string;
}

/* ------------------------------------------------------------------ */
/* UI Tester (rekam & putar ulang interaksi web)                        */
/* ------------------------------------------------------------------ */

export type UiStepType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'press'
  | 'wait'
  | 'assertText'
  | 'assertVisible'
  | 'assertNotVisible'
  | 'assertUrl'
  | 'assertEach'
  | 'assertSorted'
  | 'pickOption'
  | 'setVariable'
  | 'saveText'
  | 'uploadFile'
  | 'assertColor'
  | 'apiScenario'
  // Khusus mobile (Appium)
  | 'longPress'
  | 'swipe'
  | 'scrollTo'
  | 'back'
  | 'hideKeyboard'
  | 'restartApp'
  | 'launchApp'
  | 'closeApp'
  | 'installApk'
  | 'clearText'
  | 'pressKey'
  | 'assertAttribute'
  | 'takeScreenshot'
  | 'pageSource'
  | 'drawPolygon';

/** Target UI test: web (Playwright + Chrome) atau aplikasi mobile native (Appium). */
export const UI_TEST_TARGETS = ['web', 'mobile'] as const;
export type UiTestTarget = (typeof UI_TEST_TARGETS)[number];

export interface UiStepTypeInfo {
  id: UiStepType;
  label: string;
  /** Label di test mobile bila berbeda (mis. Click → Tap). */
  mobileLabel?: string;
  needsTarget: boolean;
  valueLabel?: string;
  mobileValueLabel?: string;
  /** Target yang mendukung step ini. */
  targets: readonly UiTestTarget[];
}

const BOTH = ['web', 'mobile'] as const;
const WEB = ['web'] as const;
const MOBILE = ['mobile'] as const;

export const UI_STEP_TYPES: UiStepTypeInfo[] = [
  {
    id: 'navigate',
    label: 'Open URL',
    mobileLabel: 'Open deep link',
    needsTarget: false,
    valueLabel: 'URL',
    mobileValueLabel: 'Deep link, e.g. myapp://orders/42',
    targets: BOTH,
  },
  { id: 'click', label: 'Click', mobileLabel: 'Tap', needsTarget: true, targets: BOTH },
  { id: 'fill', label: 'Type text', needsTarget: true, valueLabel: 'Text', targets: BOTH },
  { id: 'select', label: 'Choose option', needsTarget: true, valueLabel: 'Option value', targets: WEB },
  { id: 'check', label: 'Tick checkbox', needsTarget: true, targets: WEB },
  { id: 'uncheck', label: 'Untick checkbox', needsTarget: true, targets: WEB },
  { id: 'press', label: 'Press key', needsTarget: true, valueLabel: 'Key (e.g. Enter)', targets: WEB },
  { id: 'wait', label: 'Wait', needsTarget: false, valueLabel: 'Milliseconds', targets: BOTH },
  {
    id: 'assertText',
    label: 'Check text is shown',
    needsTarget: true,
    valueLabel: 'Expected text',
    targets: BOTH,
  },
  { id: 'assertVisible', label: 'Check element is visible', needsTarget: true, targets: BOTH },
  // Kebalikannya: tidak ada elemen cocok yang tampil (mis. hasil filter tidak memuat status "Terbayar").
  { id: 'assertNotVisible', label: 'Check element is not visible', needsTarget: true, targets: BOTH },
  {
    id: 'assertUrl',
    label: 'Check page URL contains',
    needsTarget: false,
    valueLabel: 'URL part',
    targets: WEB,
  },
  // Semua elemen yang cocok (mis. baris tabel) harus memuat teks — untuk memeriksa hasil filter.
  {
    id: 'assertEach',
    label: 'Check every row contains',
    needsTarget: true,
    valueLabel: 'Expected text in every row',
    targets: BOTH,
  },
  // Nilai (tanggal / angka / nominal) pada semua elemen yang cocok harus berurutan — untuk memeriksa sort/filter.
  {
    id: 'assertSorted',
    label: 'Check sort order',
    needsTarget: true,
    valueLabel: 'Order (ascending or descending)',
    targets: BOTH,
  },
  { id: 'pickOption', label: 'Pick an option', needsTarget: true, targets: WEB },
  // Unggah berkas contoh (PDF/PNG/JPG/TXT) ke <input type="file">; jenisnya dari nama berkas atau atribut accept.
  {
    id: 'uploadFile',
    label: 'Upload file',
    needsTarget: true,
    valueLabel: 'File name (e.g. surat-penarikan.pdf; empty = match the field)',
    targets: WEB,
  },
  // Warna teks / latar elemen termasuk keluarga warna tertentu (mis. status merah).
  {
    id: 'assertColor',
    label: 'Check element color',
    needsTarget: true,
    valueLabel: 'Color (red, orange, yellow, green, blue, purple, gray)',
    targets: WEB,
  },
  { id: 'setVariable', label: 'Set a value', needsTarget: false, valueLabel: 'Value', targets: BOTH },
  // Simpan teks elemen di layar sebagai {{variabel}} (mis. nama pelanggan yang dipilih dari daftar).
  {
    id: 'saveText',
    label: 'Save element text',
    needsTarget: true,
    valueLabel: 'Keep only (optional regex)',
    targets: BOTH,
  },
  // Jalankan API scenario (API Tester) di tengah UI test, mis. "aplikasi mobile" yang mengirim data.
  { id: 'apiScenario', label: 'Run API scenario', needsTarget: false, targets: BOTH },
  // Khusus mobile
  { id: 'longPress', label: 'Long press', needsTarget: true, targets: MOBILE },
  {
    id: 'swipe',
    label: 'Swipe',
    needsTarget: false,
    valueLabel: 'Direction (up, down, left, right)',
    targets: MOBILE,
  },
  {
    id: 'scrollTo',
    label: 'Scroll until visible',
    needsTarget: true,
    valueLabel: 'Direction (down or up)',
    targets: MOBILE,
  },
  { id: 'back', label: 'Press Back', needsTarget: false, targets: MOBILE },
  {
    id: 'pressKey',
    label: 'Press key',
    needsTarget: false,
    valueLabel: 'Android key (ENTER, BACK, HOME, SEARCH, DEL, TAB, or a keycode number)',
    targets: MOBILE,
  },
  { id: 'clearText', label: 'Clear text', needsTarget: true, targets: MOBILE },
  { id: 'hideKeyboard', label: 'Hide keyboard', needsTarget: false, targets: MOBILE },
  { id: 'launchApp', label: 'Launch app', needsTarget: false, targets: MOBILE },
  { id: 'closeApp', label: 'Close app', needsTarget: false, targets: MOBILE },
  { id: 'restartApp', label: 'Restart app', needsTarget: false, targets: MOBILE },
  {
    id: 'installApk',
    label: 'Install APK',
    needsTarget: false,
    valueLabel: 'APK path on the Testora server, firebase:latest, or empty = the app of this test',
    targets: MOBILE,
  },
  {
    id: 'assertAttribute',
    label: 'Check attribute',
    needsTarget: true,
    valueLabel: 'Expected value',
    targets: MOBILE,
  },
  { id: 'takeScreenshot', label: 'Take screenshot', needsTarget: false, targets: MOBILE },
  { id: 'pageSource', label: 'Save page source', needsTarget: false, targets: MOBILE },
  // Ketuk beberapa titik acak (poligon cembung) di dalam elemen, mis. peta untuk menggambar lahan.
  {
    id: 'drawPolygon',
    label: 'Draw polygon',
    needsTarget: true,
    valueLabel: 'Number of points (3–12)',
    targets: MOBILE,
  },
];

/** Platform aplikasi mobile. Tahap ini: Android native saja (Appium + UiAutomator2). */
export const MOBILE_PLATFORMS = ['android'] as const;
export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

/**
 * Cara test mobile dijalankan (dipilih saat Run, test case tidak berubah):
 * - `mock`: aplikasi Android tiruan di dalam Testora (development / demo, tanpa perangkat);
 * - `emulator`: Android Emulator (AVD) lewat Appium;
 * - `device`: HP Android sungguhan lewat USB debugging.
 */
export const MOBILE_EXECUTION_MODES = ['mock', 'emulator', 'device'] as const;
export type MobileExecutionMode = (typeof MOBILE_EXECUTION_MODES)[number];
export const MOBILE_EXECUTION_MODE_LABEL: Record<MobileExecutionMode, string> = {
  mock: 'Mock',
  emulator: 'Android Emulator',
  device: 'Android Device',
};

/**
 * Aplikasi & perangkat untuk UI test Android (capabilities Appium). Kosongkan
 * `app` untuk memakai aplikasi yang sudah terpasang (appPackage + appActivity).
 */
export interface MobileAppConfig {
  platform: MobilePlatform;
  /** Path file .apk di server Testora (upload / path lokal) atau URL (opsional). */
  app: string;
  /** Package & activity aplikasi yang sudah terpasang. */
  appPackage: string;
  appActivity: string;
  deviceName: string;
  platformVersion: string;
  /** Perangkat tertentu (serial adb, mis. emulator-5554). Kosong = perangkat mana pun yang siap. */
  udid: string;
  /** true = data aplikasi tidak di-reset di awal test. */
  noReset: boolean;
  /** Capabilities tambahan (JSON), mis. {"appium:autoGrantPermissions": true}. */
  capabilities: string;
}

/* ------------------------------------------------------------------ */
/* Aplikasi per project (Android / Web)                                 */
/* ------------------------------------------------------------------ */

export const APP_PLATFORMS = ['android', 'web'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];
/** Jenis perangkat Android: HP biasa atau tablet (dideteksi dari ukuran layar). */
export const FORM_FACTORS = ['phone', 'tablet'] as const;
export type FormFactor = (typeof FORM_FACTORS)[number];

/**
 * Satu aplikasi di project, mis. MTT → "FO Apps" (Android, HP), "Agro Apps"
 * (Android, tablet), "FARM ERP" (Web). Test case dihubungkan ke satu app.
 */
export interface ProjectApp extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  platform: AppPlatform;
  description: string;
  /** Web: nama variabel environment berisi URL aplikasi, mis. FARM_URL → start URL {{FARM_URL}}. */
  urlVariable?: string;
  /** Web: ukuran layar default test baru. */
  viewport?: { width: number; height: number };
  /** Android: aplikasi & perangkat. */
  android?: AppAndroidSettings;
}

export interface AppAndroidSettings {
  /** Package & activity aplikasi (mis. com.maxxi.alsintan.dev). */
  appPackage: string;
  appActivity: string;
  /** Sumber APK test baru: "firebase:latest", path APK, atau kosong (aplikasi terpasang). */
  app: string;
  /** Jenis perangkat yang dipakai: phone / tablet / kosong = bebas. */
  formFactor: FormFactor | '';
  /** Mode bawaan bila saat Run tidak dipilih (jadwal, Firebase, bulk run). Kosong = bawaan Settings. */
  defaultMode: MobileExecutionMode | '';
  /** Serial adb perangkat tertentu (mis. emulator-5554 / R58XXXX); kosong = yang pertama siap. */
  udid: string;
}

/** Jenis perangkat dari serial adb: "emulator-5554" = emulator, selain itu HP. */
export const serialKind = (udid: string): 'emulator' | 'device' =>
  /^emulator-\d+$/.test(udid.trim()) ? 'emulator' : 'device';

/**
 * Phone / tablet dari properti Android: "tablet" di ro.build.characteristics, atau
 * lebar layar terkecil ≥ 600 dp (aturan Android untuk tablet).
 */
export function formFactorOf(input: {
  characteristics?: string;
  width?: number;
  height?: number;
  density?: number;
}): FormFactor | undefined {
  if (/\btablet\b/i.test(input.characteristics ?? '')) return 'tablet';
  const { width, height, density } = input;
  if (!width || !height || !density) return undefined;
  return (Math.min(width, height) * 160) / density >= 600 ? 'tablet' : 'phone';
}

/** Pengaturan server Appium (Settings → Mobile (Android)). */
export interface AppiumSettings {
  serverUrl: string;
  /** Capabilities default untuk semua test mobile (JSON). */
  capabilities: string;
  /** Mode bawaan saat test mobile dijalankan tanpa memilih mode (bulk run, jadwal). */
  defaultMode: MobileExecutionMode;
}

export interface AppiumStatus {
  ok: boolean;
  message: string;
  version?: string;
}

/* ----------------------- Android environment ------------------------ */

/**
 * Status dependency hasil preflight. READY hanya dipakai bila perintahnya
 * benar-benar berhasil dijalankan (bukan sekadar folder/berkas ditemukan).
 */
export const DEPENDENCY_STATUSES = [
  'READY',
  'NOT_INSTALLED',
  'NOT_CONFIGURED',
  'NOT_FOUND',
  'ERROR',
] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export type AndroidDependencyId =
  | 'macos'
  | 'node'
  | 'npm'
  | 'python'
  | 'pip'
  | 'java'
  | 'androidSdk'
  | 'androidHome'
  | 'androidSdkRoot'
  | 'sdkmanager'
  | 'adb'
  | 'emulator'
  | 'platform'
  | 'buildTools'
  | 'systemImage'
  | 'appium'
  | 'uiautomator2'
  | 'appiumServer'
  | 'avd';

export interface AndroidDependency {
  id: AndroidDependencyId;
  label: string;
  group: 'system' | 'java' | 'sdk' | 'appium' | 'devices';
  status: DependencyStatus;
  version?: string;
  path?: string;
  /** Penjelasan singkat / error yang bisa ditindaklanjuti. */
  detail: string;
  /** Perintah yang dijalankan untuk memeriksa (untuk transparansi). */
  command?: string;
  /** true = bisa dipasang/dikonfigurasi otomatis oleh "Setup Android Environment". */
  fixable: boolean;
  /** Butuh hak administrator: perintahnya hanya ditampilkan, tidak dijalankan Testora. */
  adminCommand?: string;
}

export interface AndroidEnvironmentReport {
  checkedAt: string;
  dependencies: AndroidDependency[];
  /** Lokasi SDK yang dipakai (terdeteksi atau bawaan ~/Library/Android/sdk). */
  sdkRoot: string;
  javaHome: string;
  /** true = semua dependency untuk menjalankan test di emulator/perangkat sudah READY. */
  ready: boolean;
}

/** Langkah yang akan dijalankan "Setup Android Environment". */
export interface AndroidSetupStep {
  id: string;
  label: string;
  /** Perintah persis yang dijalankan (ditampilkan ke user). */
  command: string;
  /** Kira-kira ukuran unduhan, mis. "≈ 1.5 GB". */
  download?: string;
  /** Langkah menerima lisensi Android SDK — hanya dijalankan bila user menyetujuinya. */
  license?: boolean;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  error?: string;
}

export interface AndroidSetupJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  steps: AndroidSetupStep[];
  /** Baris log terakhir (sudah disamarkan). */
  log: string[];
}

export interface AppiumHealth {
  installed: boolean;
  version?: string;
  path?: string;
  uiautomator2Installed: boolean;
  uiautomator2Version?: string;
  serverUrl: string;
  serverRunning: boolean;
  serverVersion?: string;
  /** true = server Appium dijalankan & dikelola Testora (bisa dihentikan dari UI). */
  managed: boolean;
  message: string;
}

/* ------------------------- Android devices -------------------------- */

export const ANDROID_DEVICE_STATUSES = [
  'CONNECTED',
  'DISCONNECTED',
  'BOOTING',
  'BUSY',
  'UNAUTHORIZED',
  'ERROR',
] as const;
export type AndroidDeviceStatus = (typeof ANDROID_DEVICE_STATUSES)[number];

export interface AndroidDevice {
  /** Serial adb (emulator-5554 / R58XXXX), atau "avd:<nama>" untuk AVD yang belum menyala. */
  id: string;
  name: string;
  type: 'emulator' | 'device';
  /** Nama AVD (emulator saja). */
  avd?: string;
  /** HP atau tablet (bila bisa dideteksi). */
  formFactor?: FormFactor;
  androidVersion: string;
  apiLevel: string;
  connection: 'USB' | 'Wi-Fi' | 'Emulator' | '-';
  status: AndroidDeviceStatus;
  /** Siap dipakai test (CONNECTED + boot selesai + tidak sedang dipakai). */
  automationReady: boolean;
  /** Keterangan / instruksi, mis. cara menyetujui USB debugging. */
  detail: string;
}

/** Nilai default & pilihan wizard "Create Android Emulator". */
export interface AvdOptions {
  devices: { id: string; name: string }[];
  /** System image yang cocok dengan arsitektur Mac (terpasang atau bisa diunduh). */
  images: { id: string; apiLevel: string; androidVersion: string; installed: boolean }[];
  defaults: { name: string; device: string; image: string; ramMb: number; storageMb: number };
}

export interface CreateAvdInput {
  name: string;
  device: string;
  image: string;
  ramMb: number;
  storageMb: number;
}

/** Hasil satu langkah "Test Android Connection". */
export interface ConnectionCheck {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'skipped';
  detail: string;
}

export interface AndroidConnectionResult {
  ok: boolean;
  /** Kode error yang bisa ditindaklanjuti, mis. NO_DEVICE. */
  errorCode?: MobileErrorCode;
  message: string;
  checks: ConnectionCheck[];
  device?: string;
  /** Screenshot PNG base64 dari aplikasi yang dibuka. */
  screenshot?: string;
}

/** Kode error mobile yang ditampilkan dengan tombol tindak lanjut di UI. */
export const MOBILE_ERROR_CODES = [
  'APPIUM_NOT_INSTALLED',
  'UIAUTOMATOR2_NOT_INSTALLED',
  'APPIUM_NOT_RUNNING',
  'ANDROID_SDK_NOT_FOUND',
  'NO_DEVICE',
  'ADB_UNAUTHORIZED',
  'DEVICE_LOCKED',
  'DEVICE_BUSY',
  'APPIUM_SESSION_FAILED',
  'APP_NOT_CONFIGURED',
  'APP_LAUNCH_FAILED',
  'SESSION_LOST',
] as const;
export type MobileErrorCode = (typeof MOBILE_ERROR_CODES)[number];

/** Elemen di layar aplikasi (Mobile Inspector), koordinat dalam piksel screenshot. */
export interface MobileElement {
  /** Posisi di pohon, mis. "0.3.1". */
  path: string;
  type: string;
  text: string;
  /** content-desc. */
  accessibilityId: string;
  resourceId: string;
  label: string;
  enabled: boolean;
  /** Kolom password (nilainya disamarkan saat direkam). */
  secure: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  /** Semua atribut Android: text, content-desc, resource-id, class, package, clickable, … */
  attributes: Record<string, string>;
  /** Selector yang disarankan, paling stabil dulu. */
  selectors: string[];
  description: string;
}

/** Jenis selector mobile (untuk tampilan & ekspor rekaman). */
export type MobileSelectorType =
  'accessibilityId' | 'resourceId' | 'uiautomator' | 'xpath' | 'className' | 'text';

/** Hasil "Test selector" di Inspector. */
export interface SelectorTestResult {
  selector: string;
  selectorType: MobileSelectorType;
  matches: number;
  /** Posisi elemen yang cocok (piksel screenshot), maks. 50. */
  bounds: { x: number; y: number; width: number; height: number }[];
  error?: string;
}

export type MobileInspectorStatus = 'queued' | 'starting' | 'ready' | 'busy' | 'stopped' | 'failed';

export interface MobileInspectorSession {
  id: string;
  projectId: string;
  /** Diisi saat merekam lanjutan test yang sudah ada. */
  testCaseId: string | null;
  name: string;
  folderId: string | null;
  mobile: MobileAppConfig;
  mode: MobileExecutionMode;
  status: MobileInspectorStatus;
  startedAt: string;
  steps: UiStep[];
  device: string;
  error?: string;
  errorCode?: MobileErrorCode;
}

/** Aksi dari Mobile Inspector: dijalankan di aplikasi, dan (bila `record`) disimpan sebagai step. */
export interface MobileInspectorAction {
  type: UiStepType;
  selectors: string[];
  value?: string;
  description?: string;
  sensitive?: boolean;
  attribute?: string;
  /** false = hanya dijalankan (mis. menyiapkan layar), tidak direkam. Default true. */
  record?: boolean;
}

export interface MobileActionResult {
  session: MobileInspectorSession;
  ok: boolean;
  error?: string;
  detail?: string;
}

export interface MobileScreen {
  /** PNG base64 (tanpa prefix data:). */
  screenshot: string;
  width: number;
  height: number;
  elements: MobileElement[];
  takenAt: string;
  /** Aplikasi yang sedang tampil di depan (package elemen paling atas). */
  foregroundPackage?: string;
  /** Aplikasi yang sedang diuji; beda dengan foregroundPackage → ada aplikasi/dialog lain di depan. */
  appPackage?: string;
}

/* -------------------- Firebase App Distribution -------------------- */

/** Nilai `MobileAppConfig.app` / nilai step "Install APK" = release Firebase terbaru. */
export const FIREBASE_LATEST_APP = 'firebase:latest';

/**
 * Koneksi ke Firebase App Distribution lewat Service Account (role "Firebase App
 * Distribution Admin"). Kunci privat tidak pernah dikirim balik ke browser.
 */
export interface FirebaseSettings {
  /** Project number Firebase (angka), mis. 123456789012. */
  projectNumber: string;
  /** Android App ID, mis. 1:123456789012:android:abc123def456. */
  appId: string;
  /** Isi file JSON key Service Account. Kosong/samaran saat disimpan = pertahankan yang lama. */
  serviceAccount: string;
  /** Cek release baru secara berkala, lalu unduh & pasang otomatis. */
  autoInstall: boolean;
  intervalMinutes: number;
  /** Perangkat tujuan pemasangan otomatis. */
  installMode: 'emulator' | 'device';
  /** Perangkat tertentu (serial adb); kosong = perangkat pertama yang siap. */
  udid: string;
  /** Setelah terpasang, jalankan jadwal Test Scheduler ini. */
  runSchedule: boolean;
  scheduleId: string;
}

export interface FirebaseSettingsView extends Omit<FirebaseSettings, 'serviceAccount'> {
  /** client_email & project_id dari key (bukan rahasia); kunci privat tidak pernah dikirim. */
  serviceAccountEmail: string;
  serviceAccountProject: string;
  keySet: boolean;
  configured: boolean;
  lastCheck: FirebaseEvent | null;
  /** Release terakhir yang sudah diproses otomatis. */
  lastSeenRelease: string;
}

export interface FirebaseRelease {
  /** Nama resource: projects/…/apps/…/releases/<id>. */
  name: string;
  id: string;
  displayVersion: string;
  buildVersion: string;
  releaseNotes: string;
  createTime: string;
  consoleUri: string;
  /** Sudah diunduh ke server Testora. */
  downloaded: boolean;
  apkPath?: string;
}

export type FirebaseEventKind = 'check' | 'download' | 'install' | 'schedule' | 'error';

/** Riwayat aktivitas Firebase (cek, unduh, pasang, jalankan jadwal). */
export interface FirebaseEvent {
  at: string;
  kind: FirebaseEventKind;
  ok: boolean;
  message: string;
  release?: string;
}

/** APK yang di-upload ke server Testora. */
export interface UploadedApk {
  name: string;
  path: string;
  size: number;
  uploadedAt: string;
}

/**
 * Step "Pick an option": dari semua pilihan di daftar / dropdown, pilih
 * - `random` / `first`: satu yang belum terpilih/nonaktif (acak atau yang pertama),
 *   supaya test yang dijalankan berulang memakai nilai berbeda;
 * - `named`: pilihan dengan teks persis `text` (mis. "Admin", bukan "Super Admin").
 */
export const UI_PICK_MODES = ['random', 'first', 'named'] as const;
export type UiPickMode = (typeof UI_PICK_MODES)[number];

export interface UiPickOptions {
  mode: UiPickMode;
  /** Teks pilihan untuk mode `named` (dicocokkan persis, tanpa beda huruf besar/kecil). */
  text: string;
  /** Simpan teks pilihan sebagai {{variabel}} untuk step berikutnya (kosong = tidak disimpan). */
  saveAs: string;
  /** Selector CSS tambahan untuk pilihan yang harus dilewati (kosong = deteksi otomatis saja). */
  skip: string;
}

export interface UiStep {
  id: string;
  type: UiStepType;
  /** Deskripsi yang mudah dibaca, mis. Click "Sign in" button. */
  description: string;
  /**
   * Selector Playwright, urut dari yang paling stabil (data-testid, id, label, teks)
   * sampai CSS path. Saat dijalankan, selector pertama yang ditemukan dipakai.
   */
  selectors: string[];
  value: string;
  /** Nilai rahasia (mis. password) — disamarkan di UI & hasil run. */
  sensitive?: boolean;
  timeoutMs: number | null;
  disabled: boolean;
  /**
   * Jeda sebelum step ini (ms) seperti saat direkam — dipakai saat diputar
   * dengan kecepatan rekaman. Kosong = jeda standar.
   */
  delayMs?: number | null;
  /** Lama user mengetik saat direkam (ms), khusus step "fill". */
  typingMs?: number;
  /** Pengaturan step "pickOption". */
  pick?: UiPickOptions;
  /**
   * Nama variabel yang diisi step "setVariable" (tanpa kurung kurawal). Nilainya
   * dihitung sekali, lalu {{nama}} bisa dipakai di nilai & selector step berikutnya.
   */
  saveAs?: string;
  /**
   * "Save element text": lewati nilai yang sudah disimpan run-run sebelumnya dari
   * test ini (mis. pelanggan yang sudah pernah dites) dan pakai yang belum pernah.
   */
  unique?: boolean;
  /**
   * Bila step ini gagal: ulangi dari step dengan id ini (step sebelumnya atau
   * step ini sendiri), maks. `retryMax` kali. Saat diulang, "Save element text"
   * otomatis melewati nilai yang sudah dicoba di run ini (mis. pelanggan lain).
   */
  retryFrom?: string;
  /** Jumlah pengulangan maksimal untuk `retryFrom` (bawaan 3). */
  retryMax?: number;
  /**
   * Bila step ini gagal: hentikan test dan anggap LULUS (step sisanya dilewati).
   * Untuk kondisi "lanjut hanya bila ada data", mis. tabel kosong = tidak ada yang dites.
   */
  onFailPass?: boolean;
  /**
   * Bila step ini gagal: lewati N step berikutnya lalu lanjut (test tidak gagal).
   * Untuk bagian yang hanya ada pada keadaan tertentu, mis. tombol "+ Tambah catatan"
   * yang hanya tampil bila pelanggan belum punya catatan.
   */
  onFailSkip?: number;
  /**
   * Step "apiScenario": scenario API Tester (project yang sama) yang dijalankan.
   * Variabel UI test dikirim sebagai variabel awal; hasil capture kembali ke UI test.
   */
  apiScenarioId?: string;
  /** Step "assertAttribute": nama atribut Android, mis. checked, enabled, content-desc. */
  attribute?: string;
}

export interface UiTestCase extends Timestamps {
  id: string;
  /**
   * Test Case ID yang mudah dibaca, mis. "TC-0001": berurutan, unik di seluruh
   * Testora, dan tidak berubah (diberikan otomatis saat test pertama kali disimpan).
   */
  code?: string;
  projectId: string;
  folderId: string | null;
  name: string;
  description: string;
  /** Web: halaman awal. Mobile: kosong (aplikasi dibuka dari `mobile`). */
  startUrl: string;
  viewport: { width: number; height: number };
  steps: UiStep[];
  /** Kosong pada test lama = web. */
  target?: UiTestTarget;
  /** Wajib untuk target mobile. */
  mobile?: MobileAppConfig;
  /** Aplikasi project yang dites (Firebase, perangkat phone/tablet, URL web). */
  appId?: string | null;
}

/**
 * Kecepatan pemutaran UI test: `recorded` meniru ritme saat direkam (jeda antar
 * aksi, mengetik huruf demi huruf, highlight elemen), `fast` secepat mungkin.
 */
export const UI_RUN_PACES = ['recorded', 'fast'] as const;
export type UiRunPace = (typeof UI_RUN_PACES)[number];
/** Batas jeda per step (ms) yang boleh disimpan/diedit. */
export const MAX_UI_STEP_DELAY_MS = 60_000;
/** Jeda untuk step tanpa data rekaman (step lama / dibuat manual) saat pace "recorded". */
export const DEFAULT_UI_STEP_DELAY_MS = 700;

export type UiStepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

export interface UiStepResult {
  index: number;
  stepId: string;
  description: string;
  type: UiStepType;
  status: UiStepStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Selector yang akhirnya berhasil dipakai. */
  usedSelector?: string;
  /** Keterangan hasil, mis. pilihan yang diambil step "pickOption". */
  detail?: string;
  /** Step "apiScenario": API run yang dibuat (request/response lengkap di Test Runs). */
  apiRunId?: string;
  error?: string;
  /** Nama file screenshot setelah step (diambil lewat endpoint screenshot run). */
  screenshot?: string;
  /** Berkas yang dihasilkan step (mis. page source dari step "pageSource"). */
  artifact?: string;
}

/**
 * Status UI run. `queued` = menunggu perangkat Android yang sedang dipakai test lain;
 * `error` = test tidak bisa dijalankan (Appium/perangkat/aplikasi bermasalah), beda
 * dengan `failed` = test berjalan tetapi ada step yang gagal.
 */
export type UiRunStatus = RunStatus | 'queued' | 'error';
export const LIVE_UI_RUN_STATUSES: readonly UiRunStatus[] = ['queued', 'running'];

/** Informasi eksekusi test mobile yang disimpan di hasil run. */
export interface UiRunMobileInfo {
  mode: MobileExecutionMode;
  device: string;
  udid: string;
  androidVersion: string;
  appPackage: string;
  appVersion: string;
  appiumVersion: string;
}

/** Berkas pendukung hasil run (log, page source) di folder artefak run. */
export interface UiRunArtifact {
  file: string;
  label: string;
  kind: 'page-source' | 'appium-log' | 'adb-log' | 'screenshot';
}

export interface UiRun extends Timestamps {
  id: string;
  projectId: string;
  testCaseId: string;
  testName: string;
  /** Test Case ID saat run dimulai, mis. "TC-0007" (kosong pada run lama). */
  testCode?: string;
  status: UiRunStatus;
  /** Test mobile. */
  mobile?: UiRunMobileInfo;
  /** Kode error mobile bila status `error`, mis. NO_DEVICE. */
  errorCode?: MobileErrorCode;
  /** Variabel yang diisi selama run (Set a value, Pick an option, API scenario) — untuk E2E Flow. */
  variables?: Record<string, string>;
  artifacts?: UiRunArtifact[];
  trigger: RunTrigger;
  headless: boolean;
  /** Kosong pada run lama (= fast). */
  pace?: UiRunPace;
  /** Nama jadwal (Test Scheduler) yang menjalankan run ini, mis. "Smoke Test". */
  scheduleName?: string;
  /** Web: nama & versi browser. Mobile: platform & perangkat, mis. "Android 14 · Pixel 7". */
  browser: string;
  /** Kosong pada run lama = web. */
  target?: UiTestTarget;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  counts: RunCounts;
  steps: UiStepResult[];
  failureReason?: string;
  /** Nama pengguna yang menekan Stop. */
  stoppedBy?: string;
}

/** Label target run untuk laporan & email: "Google Chrome · headless" atau "Android Emulator · Pixel_8 · Android 16". */
export function uiRunTargetLabel(run: Pick<UiRun, 'browser' | 'headless' | 'target' | 'mobile'>): string {
  if (run.target === 'mobile')
    return run.mobile
      ? [MOBILE_EXECUTION_MODE_LABEL[run.mobile.mode], run.mobile.device, run.mobile.androidVersion]
          .filter(Boolean)
          .join(' · ')
      : run.browser;
  return `${run.browser.replace(/\s+[\d.]+$/, '')} · ${run.headless ? 'headless' : 'visible'}`;
}

export type RecordingStatus = 'starting' | 'signing-in' | 'replaying' | 'recording' | 'stopped' | 'failed';
/** Status saat jendela browser perekam masih terbuka. */
export const LIVE_RECORDING_STATUSES: readonly RecordingStatus[] = [
  'starting',
  'signing-in',
  'replaying',
  'recording',
];

/** Nama variabel environment untuk URL awal & login rekaman yang diingat. */
export const RECORDING_VARIABLES = { url: 'WEB_URL', user: 'WEB_USER', password: 'WEB_PASSWORD' } as const;

/**
 * Login otomatis sebelum merekam. Nilai boleh berisi {{VARIABEL}} environment.
 * Selector kosong = form login dicari otomatis.
 */
export interface RecordingLogin {
  username: string;
  password: string;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

export interface RecordingSession {
  id: string;
  projectId: string;
  /** Diisi saat merekam lanjutan untuk test case yang sudah ada. */
  testCaseId: string | null;
  name: string;
  startUrl: string;
  folderId: string | null;
  status: RecordingStatus;
  startedAt: string;
  steps: UiStep[];
  /** Jumlah step lama yang diputar ulang sebelum mulai merekam. */
  replayed: number;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* E2E Flow (lintas platform: web, Android, API)                       */
/* ------------------------------------------------------------------ */

/**
 * Jenis node di kanvas E2E Flow:
 * - `start`: titik awal (opsional; node tanpa panah masuk juga dijalankan pertama);
 * - `web` / `mobile`: UI test case (web atau Android);
 * - `api`: API scenario dari API Tester;
 * - `wait`: jeda (mis. menunggu proses di backend).
 */
export const FLOW_NODE_KINDS = ['start', 'web', 'mobile', 'api', 'wait'] as const;
export type FlowNodeKind = (typeof FLOW_NODE_KINDS)[number];

export interface FlowNodeConfig {
  /** Node `wait`: lama jeda (ms). */
  waitMs?: number;
  /** Node `mobile`: Mock / Android Emulator / Android Device (kosong = bawaan Settings). */
  mode?: MobileExecutionMode;
  /** Node `web`: tampilkan browser (kecepatan seperti rekaman). */
  visible?: boolean;
  /** Lanjutkan ke node berikutnya walau node ini gagal. */
  continueOnFail?: boolean;
}

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  /** Test case / scenario yang dijalankan (kosong untuk start & wait). */
  refId: string | null;
  label: string;
  /** Posisi di kanvas. */
  x: number;
  y: number;
  config: FlowNodeConfig;
}

/** Panah: `to` dijalankan setelah `from` selesai; variabel `from` diteruskan ke `to`. */
export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export interface E2EFlow extends Timestamps {
  id: string;
  projectId: string;
  name: string;
  description: string;
  /** Environment untuk {{variabel}} & base URL API scenario. */
  environmentId: string | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type FlowNodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'stopped';

export interface FlowNodeResult {
  nodeId: string;
  kind: FlowNodeKind;
  label: string;
  status: FlowNodeStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  /** Run di bawahnya (UI run / API run). */
  runId?: string;
  runKind?: 'ui' | 'api';
  error?: string;
  /** Nama variabel yang dihasilkan node ini (diteruskan ke node berikutnya). */
  outputs?: string[];
}

export interface FlowRun extends Timestamps {
  id: string;
  projectId: string;
  flowId: string;
  flowName: string;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  environmentName: string;
  nodes: FlowNodeResult[];
  /** Salinan kanvas saat run dimulai (untuk ditampilkan walau flow diubah kemudian). */
  graph: { nodes: FlowNode[]; edges: FlowEdge[] };
  /** Variabel akhir (nilai rahasia disamarkan). */
  variables: Record<string, string>;
  failureReason?: string;
  /** Nama pengguna yang menekan Stop. */
  stoppedBy?: string;
  /** Pilihan saat Run (menimpa pengaturan node); kosong = mengikuti pengaturan tiap node. */
  options?: FlowRunOptions;
}

/**
 * Pilihan saat menjalankan E2E Flow, berlaku untuk semua node sejenis:
 * - `visible`: node web dijalankan di jendela Chrome yang terlihat;
 * - `mode`: node mobile dijalankan di Android Emulator / Android Device (atau Mock).
 */
export interface FlowRunOptions {
  visible?: boolean;
  mode?: MobileExecutionMode;
}

/**
 * Teks yang disimpan step "Save element text": spasi dirapikan; dengan `pattern`
 * (regex) diambil grup pertama, atau seluruh kecocokan bila tanpa grup.
 * Mengembalikan null bila pattern tidak cocok.
 */
export function extractSavedText(raw: string, pattern = ''): string | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!pattern.trim()) return text;
  // Teks asli (per baris, mode multiline) dulu, lalu versi satu baris.
  const match = new RegExp(pattern, 'm').exec(raw.trim()) ?? new RegExp(pattern).exec(text);
  if (!match) return null;
  return (match[1] ?? match[0]).replace(/\s+/g, ' ').trim();
}

/**
 * Nilai {{variabel}} yang harus dilewati "Save element text": dari run sebelumnya
 * (bila `includeHistory`, opsi unik) dan dari percobaan sebelumnya di run ini (retry).
 */
export type UsedValues = (variable: string, includeHistory: boolean) => string[];

/** Pilih nilai pertama yang belum pernah dipakai (perbandingan tanpa beda huruf/spasi). */
export function firstUnused(candidates: string[], used: string[]): string | undefined {
  const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
  const seen = new Set(used.map(norm));
  return candidates.find((c) => c && !seen.has(norm(c)));
}

/** Keluarga warna yang bisa dicek step "Check element color". */
export const COLOR_FAMILIES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

/**
 * Keluarga warna dari nilai CSS rgb()/rgba(); null bila transparan. Warna sangat
 * pucat (latar badge, mis. merah muda) tetap dihitung bila saturasinya cukup.
 */
export function colorFamily(css: string): ColorFamily | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/i.exec(css);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
  if (alpha < 0.15) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.2 || d < 0.04) return 'gray';
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 340) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 170) return 'green';
  if (h < 260) return 'blue';
  return 'purple';
}

/** Arah urutan untuk step "Check sort order". */
export const SORT_ORDERS = ['ascending', 'descending'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** "asc", "naik", "terkecil", "terdekat", … → ascending; "desc", "turun", "terbesar", … → descending. */
export function parseSortOrder(value: string): SortOrder | null {
  const v = value.trim().toLowerCase();
  if (/^(asc|ascending|naik|terkecil|terdekat|terlama|oldest|smallest|a-z)$/.test(v)) return 'ascending';
  if (/^(desc|descending|turun|terbesar|terjauh|terbaru|newest|largest|z-a)$/.test(v)) return 'descending';
  return null;
}

const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11, nop: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

/**
 * Nilai yang bisa dibandingkan dari teks elemen: tanggal ("5 Okt 2026", "05/10/2026",
 * "2026-10-05") atau angka/nominal ("Rp 195.000.000", "1,500.25", "Lewat 3 hari").
 * Nominal Rupiah memakai titik sebagai pemisah ribuan.
 */
export function sortableValue(text: string): { kind: 'date' | 'number'; value: number } | null {
  const t = text.replace(/\s+/g, ' ').trim();
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return { kind: 'date', value: Date.UTC(+m[1], +m[2] - 1, +m[3]) };
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(t);
  if (m) return { kind: 'date', value: Date.UTC(+m[3], +m[2] - 1, +m[1]) };
  m = /\b(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})\b/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()])
    return { kind: 'date', value: Date.UTC(+m[3], MONTHS[m[2].toLowerCase()] - 1, +m[1]) };
  m = /-?\d[\d.,]*/.exec(t);
  if (!m) return null;
  let n = m[0];
  // "195.000.000" / "1.500,25" (format Indonesia) vs "1,500.25" (format Inggris).
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n) || /^-?\d+,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.');
  else n = n.replace(/,/g, '');
  const value = Number(n);
  return Number.isFinite(value) ? { kind: 'number', value } : null;
}

/**
 * Periksa urutan nilai teks. Teks yang tidak berisi tanggal/angka diabaikan.
 * `brokenAt` = indeks (dari nilai yang terbaca) pertama yang melanggar urutan.
 */
export function checkSortOrder(
  texts: string[],
  order: SortOrder,
): { ok: boolean; values: string[]; brokenAt: number; kind: 'date' | 'number' | null } {
  const parsed = texts
    .map((text) => ({ text: text.replace(/\s+/g, ' ').trim(), v: sortableValue(text) }))
    .filter((x): x is { text: string; v: { kind: 'date' | 'number'; value: number } } => !!x.v);
  // Satu jenis saja: jenis yang paling banyak muncul.
  const dates = parsed.filter((x) => x.v.kind === 'date').length;
  const kind = parsed.length ? (dates * 2 >= parsed.length ? 'date' : 'number') : null;
  const rows = parsed.filter((x) => x.v.kind === kind);
  const brokenAt = rows.findIndex(
    (x, i) => i > 0 && (order === 'ascending' ? x.v.value < rows[i - 1].v.value : x.v.value > rows[i - 1].v.value),
  );
  return { ok: brokenAt < 0, values: rows.map((x) => x.text), brokenAt, kind };
}
