/**
 * Normalizer mengubah input dari client menjadi objek domain yang lengkap dan aman:
 * mengisi default, membuang field asing, dan memaksa tipe yang benar.
 * Semua penulisan ke database harus melewati fungsi di sini.
 */
import type {
  E2EFlow,
  FlowEdge,
  FlowNode,
  MobileAppConfig,
  UiTestTarget,
  ProjectNotifications,
  UiSchedule,
  RecordingLogin,
  UiPickOptions,
  ApiDefinition,
  ApiStep,
  Assertion,
  BodyField,
  Environment,
  EnvVariable,
  FieldType,
  HttpMethod,
  KeyValue,
  Operator,
  PerfStage,
  PerfTest,
  Project,
  Scenario,
  Schedule,
  ScheduleFrequency,
  Step,
  UiStep,
  UiStepType,
  UiTestCase,
} from '@flowqa/shared';
import {
  MAX_NOTIFY_RECIPIENTS,
  NOTIFY_WHEN,
  MAX_UI_STEP_DELAY_MS,
  UI_PICK_MODES,
  HTTP_METHODS,
  OPERATORS,
  PERF_LIMITS,
  ASSERTION_KINDS,
  FIELD_TYPES,
  PERF_TEST_TYPES,
  SCHEDULE_FREQUENCIES,
  SECRET_MASK,
  UI_STEP_TYPES,
  FLOW_NODE_KINDS,
  MOBILE_EXECUTION_MODES,
  UI_TEST_TARGETS,
  MOBILE_PLATFORMS,
  createId,
  totalStageSeconds,
} from '@flowqa/shared';
import { HttpError } from '../lib/http';
import { nowIso } from '../lib/time';
import { assertStartUrl } from './guards';

type Input = Record<string, any>;

const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const bool = (v: unknown, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const int = (v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const list = <T>(v: unknown, map: (item: Input) => T): T[] =>
  Array.isArray(v) ? v.map((x) => map(x ?? {})) : [];
/** Nilai `v` bila termasuk daftar yang diizinkan, selain itu `fallback`. */
const oneOf = <T extends string>(allowed: readonly T[], v: unknown, fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
/** folderId dari input; tidak dikirim = pertahankan nilai lama, string kosong = tanpa folder. */
const folderIdOf = (input: Input, existing?: { folderId?: string | null }): string | null =>
  input.folderId !== undefined ? text(input.folderId).trim() || null : (existing?.folderId ?? null);
const keyValues = (v: unknown): KeyValue[] => list(v, (x) => ({ key: text(x.key), value: text(x.value) }));
const operator = (v: unknown, fallback: Operator = 'equals'): Operator =>
  (OPERATORS as readonly string[]).includes(v as string) ? (v as Operator) : fallback;
const method = (v: unknown): HttpMethod =>
  HTTP_METHODS.includes(v as HttpMethod) ? (v as HttpMethod) : 'GET';
const fieldType = (v: unknown): FieldType => oneOf(FIELD_TYPES, v, 'text');
const bodyFields = (v: unknown): BodyField[] =>
  list(v, (x) => ({ field: text(x.field), type: fieldType(x.type), value: text(x.value) }));

function required(value: string, field: string): string {
  if (!value.trim()) throw new HttpError(400, `"${field}" is required`);
  return value.trim();
}

function stamps(existing?: { createdAt: string }) {
  const now = nowIso();
  return { createdAt: existing?.createdAt ?? now, updatedAt: now };
}

export function normalizeProject(input: Input, existing?: Project): Project {
  return {
    id: existing?.id ?? createId('prj'),
    name: required(text(input.name, existing?.name), 'name'),
    description: text(input.description, existing?.description),
    owner: text(input.owner, existing?.owner),
    team: text(input.team, existing?.team),
    tags: Array.isArray(input.tags)
      ? input.tags.map((t: unknown) => text(t).trim()).filter(Boolean)
      : (existing?.tags ?? []),
    notifications:
      input.notifications !== undefined
        ? normalizeNotifications(input.notifications)
        : (existing?.notifications ?? normalizeNotifications({})),
    ...stamps(existing),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pengaturan notifikasi email project: penerima divalidasi, duplikat dibuang. */
export function normalizeNotifications(x: unknown): ProjectNotifications {
  const email = ((x as Input)?.email ?? {}) as Input;
  const raw: unknown[] = Array.isArray(email.recipients)
    ? email.recipients
    : text(email.recipients).split(/[\s,;]+/);
  const recipients = [...new Set(raw.map((r) => text(r).trim().toLowerCase()).filter(Boolean))];
  const invalid = recipients.find((r) => !EMAIL.test(r));
  if (invalid) throw new HttpError(400, `"${invalid}" is not a valid email address`);
  if (recipients.length > MAX_NOTIFY_RECIPIENTS)
    throw new HttpError(400, `Add at most ${MAX_NOTIFY_RECIPIENTS} email recipients`);
  // Daftar kosong = pakai penerima default dari Settings → Email Report.
  return {
    email: { enabled: bool(email.enabled), recipients, when: oneOf(NOTIFY_WHEN, email.when, 'always') },
  };
}

export function normalizeEnvironment(input: Input, projectId: string, existing?: Environment): Environment {
  // Secret yang dikirim balik dari UI masih berupa mask → pertahankan nilai lama.
  const variables: EnvVariable[] = list(input.variables ?? existing?.variables, (x) => {
    const key = text(x.key).trim();
    const previous = existing?.variables.find((v) => v.key === key);
    const value = text(x.value);
    return {
      key,
      secret: bool(x.secret),
      value: value === SECRET_MASK && previous ? previous.value : value,
    };
  }).filter((v) => v.key);

  return {
    id: existing?.id ?? createId('env'),
    projectId,
    name: required(text(input.name, existing?.name), 'name'),
    baseUrl: required(text(input.baseUrl, existing?.baseUrl), 'baseUrl'),
    timeoutMs: int(input.timeoutMs ?? existing?.timeoutMs, 30_000, 100, 600_000),
    verifySsl: bool(input.verifySsl, existing?.verifySsl ?? true),
    proxy: text(input.proxy, existing?.proxy),
    variables,
    headers: keyValues(input.headers ?? existing?.headers).filter((h) => h.key),
    ...stamps(existing),
  };
}

/** Versi environment yang aman dikirim ke UI: nilai secret diganti mask. */
export function presentEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: env.variables.map((v) => (v.secret && v.value ? { ...v, value: SECRET_MASK } : v)),
  };
}

export function normalizeApi(input: Input, projectId: string, existing?: ApiDefinition): ApiDefinition {
  const path = required(text(input.path, existing?.path), 'path');
  return {
    id: existing?.id ?? createId('api'),
    projectId,
    name: required(text(input.name, existing?.name), 'name'),
    description: text(input.description, existing?.description),
    folderId: folderIdOf(input, existing),
    method: method(input.method ?? existing?.method),
    path: path.startsWith('/') ? path : `/${path}`,
    auth: input.auth === 'bearer' ? 'bearer' : input.auth === 'none' ? 'none' : (existing?.auth ?? 'none'),
    contentType: text(input.contentType, existing?.contentType) || 'application/json',
    headers: keyValues(input.headers ?? existing?.headers),
    query: keyValues(input.query ?? existing?.query),
    body: bodyFields(input.body ?? existing?.body),
    exampleResponse:
      input.exampleResponse !== undefined ? input.exampleResponse : (existing?.exampleResponse ?? {}),
    ...stamps(existing),
  };
}

function normalizeAssertion(x: Input): Assertion {
  const kind = oneOf(ASSERTION_KINDS, x.kind, 'status');
  return {
    id: text(x.id) || createId('as'),
    kind,
    field: kind === 'field' ? text(x.field) : undefined,
    operator: operator(x.operator ?? x.op),
    expected: text(x.expected),
  };
}

export function normalizeStep(x: Input): Step {
  const base = {
    id: text(x.id) || createId('st'),
    name: text(x.name) || 'Untitled step',
    disabled: bool(x.disabled),
    continueOnFailure: bool(x.continueOnFailure),
  };
  switch (x.type) {
    case 'wait':
      return { ...base, type: 'wait', durationMs: int(x.durationMs, 1000, 0, 60_000) };
    case 'setVariable':
      return {
        ...base,
        type: 'setVariable',
        variable: text(x.variable).replace(/[^\w]/g, '_'),
        value: text(x.value),
      };
    case 'condition':
      return {
        ...base,
        type: 'condition',
        left: text(x.left),
        operator: operator(x.operator),
        right: text(x.right),
        skipCount: int(x.skipCount, 1, 1, 100),
      };
    default: {
      const step: ApiStep = {
        ...base,
        type: 'api',
        apiId: text(x.apiId),
        bodyMode: x.bodyMode === 'json' ? 'json' : 'visual',
        body: bodyFields(x.body),
        bodyJson: text(x.bodyJson),
        query: keyValues(x.query),
        headers: keyValues(x.headers),
        pathParams: Object.fromEntries(Object.entries(x.pathParams ?? {}).map(([k, v]) => [k, text(v)])),
        tokenVariable: text(x.tokenVariable) || 'auth_token',
        captures: list(x.captures, (c) => ({
          id: text(c.id) || createId('cp'),
          field: text(c.field),
          variable: text(c.variable).replace(/[^\w]/g, '_'),
        })),
        assertions: list(x.assertions, normalizeAssertion),
        retries: int(x.retries, 0, 0, 5),
        repeat: int(x.repeat, 1, 1, 50),
        timeoutMs: x.timeoutMs ? int(x.timeoutMs, 30_000, 100, 600_000) : null,
      };
      return step;
    }
  }
}

export function normalizeScenario(input: Input, projectId: string, existing?: Scenario): Scenario {
  return {
    id: existing?.id ?? createId('scn'),
    projectId,
    name: required(text(input.name, existing?.name), 'name'),
    description: text(input.description, existing?.description),
    folderId: folderIdOf(input, existing),
    continueOnFailure: bool(input.continueOnFailure, existing?.continueOnFailure ?? false),
    steps: input.steps !== undefined ? list(input.steps, normalizeStep) : (existing?.steps ?? []),
    ...stamps(existing),
  };
}

export function normalizeSchedule(
  input: Input,
  projectId: string,
  existing?: Schedule,
): Omit<Schedule, 'nextRunAt'> & { nextRunAt: string | null } {
  const frequency: ScheduleFrequency = oneOf(
    SCHEDULE_FREQUENCIES,
    input.frequency,
    existing?.frequency ?? 'daily',
  );
  const time = /^\d{2}:\d{2}$/.test(text(input.time)) ? text(input.time) : (existing?.time ?? '08:00');
  return {
    id: existing?.id ?? createId('sch'),
    projectId,
    scenarioId: required(text(input.scenarioId, existing?.scenarioId), 'scenarioId'),
    environmentId: required(text(input.environmentId, existing?.environmentId), 'environmentId'),
    frequency,
    time,
    ...(frequency === 'weekly' ? { day: int(input.day ?? existing?.day, 1, 0, 6) } : {}),
    enabled: bool(input.enabled, existing?.enabled ?? true),
    nextRunAt: existing?.nextRunAt ?? null,
    lastRunId: existing?.lastRunId ?? null,
    lastRunAt: existing?.lastRunAt ?? null,
    ...stamps(existing),
  };
}

const optionalNumber = (v: unknown, max: number): number | null =>
  v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
    ? null
    : Math.min(max, Math.max(0, Number(v)));

export function normalizePerfTest(input: Input, projectId: string, existing?: PerfTest): PerfTest {
  const stages: PerfStage[] = list(input.stages ?? existing?.stages, (x) => ({
    durationSec: int(x.durationSec, 30, 1, PERF_LIMITS.maxDurationSec),
    targetVus: int(x.targetVus, 1, 0, PERF_LIMITS.maxVus),
  }));
  if (!stages.length) throw new HttpError(400, 'Add at least one load stage');
  if (stages.length > PERF_LIMITS.maxStages)
    throw new HttpError(400, `A test can have at most ${PERF_LIMITS.maxStages} stages`);
  if (!stages.some((s) => s.targetVus > 0))
    throw new HttpError(400, 'At least one stage needs virtual users');
  if (totalStageSeconds(stages) > PERF_LIMITS.maxDurationSec)
    throw new HttpError(400, `A test can run for at most ${PERF_LIMITS.maxDurationSec / 60} minutes`);

  const thresholds = input.thresholds ?? existing?.thresholds ?? {};
  return {
    id: existing?.id ?? createId('pft'),
    projectId,
    name: required(text(input.name, existing?.name), 'name'),
    description: text(input.description, existing?.description),
    scenarioId: required(text(input.scenarioId, existing?.scenarioId), 'scenarioId'),
    type: oneOf(PERF_TEST_TYPES, input.type, existing?.type ?? 'load'),
    stages,
    thinkTimeMs: int(input.thinkTimeMs ?? existing?.thinkTimeMs, 1000, 0, 60_000),
    thresholds: {
      p95Ms: optionalNumber(thresholds.p95Ms, 600_000),
      errorRatePct: optionalNumber(thresholds.errorRatePct, 100),
    },
    ...stamps(existing),
  };
}

const UI_TYPES = UI_STEP_TYPES.map((t) => t.id);

export function normalizeUiStep(x: Input): UiStep {
  const type: UiStepType = UI_TYPES.includes(x.type) ? x.type : 'click';
  return {
    id: text(x.id) || createId('us'),
    type,
    description: text(x.description).trim().slice(0, 200) || UI_STEP_TYPES.find((t) => t.id === type)!.label,
    selectors: Array.isArray(x.selectors)
      ? x.selectors
          .map((s: unknown) => text(s).trim())
          .filter(Boolean)
          .slice(0, 10)
      : [],
    value: text(x.value),
    ...(x.sensitive ? { sensitive: true } : {}),
    timeoutMs: x.timeoutMs ? int(x.timeoutMs, 10_000, 500, 120_000) : null,
    disabled: bool(x.disabled),
    delayMs: x.delayMs != null && x.delayMs !== '' ? int(x.delayMs, 0, 0, MAX_UI_STEP_DELAY_MS) : null,
    ...(type === 'fill' && Number(x.typingMs) > 0
      ? { typingMs: int(x.typingMs, 0, 0, MAX_UI_STEP_DELAY_MS) }
      : {}),
    ...(type === 'pickOption' ? { pick: normalizePick(x.pick) } : {}),
    ...(type === 'setVariable' || type === 'saveText' ? { saveAs: variableName(x.saveAs, true) } : {}),
    ...(type === 'saveText' && x.unique ? { unique: true } : {}),
    ...(x.onFailPass && !text(x.retryFrom).trim() ? { onFailPass: true } : {}),
    ...(Number(x.onFailSkip) > 0 && !x.onFailPass && !text(x.retryFrom).trim()
      ? { onFailSkip: int(x.onFailSkip, 1, 1, 50) }
      : {}),
    ...(text(x.retryFrom).trim()
      ? { retryFrom: text(x.retryFrom).trim(), retryMax: int(x.retryMax, 3, 1, 20) }
      : {}),
    ...(type === 'drawPolygon' && x.saveAs ? { saveAs: variableName(x.saveAs) } : {}),
    ...(type === 'assertAttribute' ? { attribute: text(x.attribute).trim().slice(0, 60) || 'enabled' } : {}),
    ...(type === 'apiScenario' ? { apiScenarioId: text(x.apiScenarioId).trim() } : {}),
  };
}

const VARIABLE_NAME = /^[A-Za-z_][\w]*$/;

/** Nama variabel UI step: kurung kurawal dibuang; hanya huruf, angka & _. */
function variableName(v: unknown, required = false): string {
  const name = text(v)
    .trim()
    .replace(/^\{\{\s*|\s*\}\}$/g, '');
  if (!name && required) throw new HttpError(400, 'Give the value a variable name, e.g. user_name');
  if (name && !VARIABLE_NAME.test(name))
    throw new HttpError(400, `"${name}" is not a valid variable name (letters, numbers and _ only)`);
  return name;
}

function normalizePick(x: unknown): UiPickOptions {
  const input = (x && typeof x === 'object' ? x : {}) as Input;
  const mode = oneOf(UI_PICK_MODES, input.mode, 'random');
  const optionText = text(input.text).trim().slice(0, 200);
  if (mode === 'named' && !optionText) throw new HttpError(400, 'Enter the option to pick, e.g. Admin');
  return {
    mode,
    text: mode === 'named' ? optionText : '',
    saveAs: variableName(input.saveAs),
    skip: text(input.skip).trim().slice(0, 500),
  };
}

export function normalizeUiTest(input: Input, projectId: string, existing?: UiTestCase): UiTestCase {
  const target: UiTestTarget = oneOf(UI_TEST_TARGETS, input.target, existing?.target ?? 'web');
  const startUrl = text(input.startUrl, existing?.startUrl).trim();
  // Test mobile membuka aplikasi dari konfigurasi `mobile`, bukan dari URL.
  if (target === 'web') assertStartUrl(startUrl);
  const viewport = input.viewport ?? existing?.viewport ?? {};
  const steps: UiStep[] =
    input.steps !== undefined ? list(input.steps, normalizeUiStep) : (existing?.steps ?? []);
  const unsupported = steps.find(
    (s) => !UI_STEP_TYPES.find((t) => t.id === s.type)!.targets.includes(target),
  );
  if (unsupported)
    throw new HttpError(
      400,
      `"${UI_STEP_TYPES.find((t) => t.id === unsupported.type)!.label}" steps are not available in ${target} tests (step "${unsupported.description}")`,
    );
  return {
    id: existing?.id ?? createId('uit'),
    // Test Case ID tidak bisa diubah lewat input; diberikan otomatis oleh repository.
    ...(existing?.code ? { code: existing.code } : {}),
    projectId,
    folderId: folderIdOf(input, existing),
    name: required(text(input.name, existing?.name), 'name'),
    description: text(input.description, existing?.description),
    startUrl: target === 'web' ? startUrl : '',
    viewport: { width: int(viewport.width, 1280, 320, 3840), height: int(viewport.height, 800, 320, 2160) },
    steps,
    ...(target === 'mobile' ? { target, mobile: normalizeMobileApp(input.mobile ?? existing?.mobile) } : {}),
    ...stamps(existing),
  };
}

/** Aplikasi & perangkat test mobile. Capabilities tambahan harus berupa objek JSON. */
export function normalizeMobileApp(x: unknown): MobileAppConfig {
  const input = (x && typeof x === 'object' ? x : {}) as Input;
  const field = (v: unknown) => text(v).trim().slice(0, 1_000);
  const capabilities = text(input.capabilities).trim().slice(0, 20_000);
  if (capabilities) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(capabilities);
    } catch {
      throw new HttpError(400, 'The extra capabilities are not valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new HttpError(
        400,
        'The extra capabilities must be a JSON object, e.g. {"appium:language": "id"}',
      );
  }
  return {
    platform: oneOf(MOBILE_PLATFORMS, input.platform, 'android'),
    app: field(input.app),
    appPackage: field(input.appPackage),
    appActivity: field(input.appActivity),
    deviceName: field(input.deviceName),
    platformVersion: field(input.platformVersion),
    udid: field(input.udid),
    noReset: bool(input.noReset, true),
    capabilities,
  };
}

/** Data login otomatis untuk rekaman baru; null bila tidak diisi. Password wajib bila login diisi. */
export function normalizeRecordingLogin(x: unknown): RecordingLogin | null {
  if (!x || typeof x !== 'object') return null;
  const input = x as Input;
  const selector = (v: unknown) => text(v).trim().slice(0, 500) || undefined;
  const login: RecordingLogin = {
    username: text(input.username).trim().slice(0, 500),
    password: text(input.password).slice(0, 500),
    usernameSelector: selector(input.usernameSelector),
    passwordSelector: selector(input.passwordSelector),
    submitSelector: selector(input.submitSelector),
  };
  if (!login.username && !login.password) return null;
  if (!login.password)
    throw new HttpError(400, 'Enter the password (or a {{VARIABLE}}) to sign in automatically');
  return login;
}

/** Jadwal UI Tester: nama wajib, minimal satu test case (duplikat dibuang). */
export function normalizeUiSchedule(input: Input, projectId: string, existing?: UiSchedule): UiSchedule {
  const frequency: ScheduleFrequency = oneOf(
    SCHEDULE_FREQUENCIES,
    input.frequency,
    existing?.frequency ?? 'daily',
  );
  const time = /^\d{2}:\d{2}$/.test(text(input.time)) ? text(input.time) : (existing?.time ?? '08:00');
  const testIds = Array.isArray(input.testIds)
    ? [...new Set(input.testIds.map((id: unknown) => text(id).trim()).filter(Boolean))]
    : (existing?.testIds ?? []);
  if (!testIds.length) throw new HttpError(400, 'Choose at least one UI test case to run');
  const environmentId =
    input.environmentId !== undefined
      ? text(input.environmentId).trim() || null
      : (existing?.environmentId ?? null);
  return {
    id: existing?.id ?? createId('uis'),
    projectId,
    name: required(text(input.name, existing?.name).trim(), 'name').slice(0, 80),
    testIds: testIds as string[],
    environmentId,
    frequency,
    time,
    ...(frequency === 'weekly' ? { day: int(input.day ?? existing?.day, 1, 0, 6) } : {}),
    enabled: bool(input.enabled, existing?.enabled ?? true),
    nextRunAt: existing?.nextRunAt ?? null,
    lastRunAt: existing?.lastRunAt ?? null,
    ...(existing?.lastBatch ? { lastBatch: existing.lastBatch } : {}),
    ...stamps(existing),
  };
}

/** E2E Flow: node & panah dari kanvas. Panah ganda / ke diri sendiri / ke node hilang dibuang; putaran ditolak. */
export function normalizeFlow(input: Input, projectId: string, existing?: E2EFlow): E2EFlow {
  const num = (v: unknown, fallback: number) =>
    Number.isFinite(Number(v)) ? Math.round(Number(v)) : fallback;
  const nodes: FlowNode[] = Array.isArray(input.nodes)
    ? input.nodes.slice(0, 200).map((raw: Input): FlowNode => {
        const kind = oneOf(FLOW_NODE_KINDS, raw.kind, 'web');
        const c = (raw.config && typeof raw.config === 'object' ? raw.config : {}) as Input;
        return {
          id: text(raw.id).trim() || createId('fn'),
          kind,
          refId: kind === 'start' || kind === 'wait' ? null : text(raw.refId).trim() || null,
          label:
            text(raw.label).trim().slice(0, 120) ||
            (kind === 'start' ? 'Start' : kind === 'wait' ? 'Wait' : 'Untitled'),
          x: Math.min(Math.max(num(raw.x, 0), -20_000), 20_000),
          y: Math.min(Math.max(num(raw.y, 0), -20_000), 20_000),
          config: {
            ...(kind === 'wait' ? { waitMs: int(c.waitMs, 2_000, 0, 600_000) } : {}),
            ...(kind === 'mobile' && MOBILE_EXECUTION_MODES.includes(c.mode) ? { mode: c.mode } : {}),
            ...(kind === 'web' && c.visible === true ? { visible: true } : {}),
            ...(c.continueOnFail === true ? { continueOnFail: true } : {}),
          },
        };
      })
    : (existing?.nodes ?? []);
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: FlowEdge[] = Array.isArray(input.edges)
    ? input.edges
        .map((raw: Input) => ({
          id: text(raw.id).trim() || createId('fe'),
          from: text(raw.from),
          to: text(raw.to),
        }))
        .filter((e: FlowEdge) => {
          const key = `${e.from}>${e.to}`;
          if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to) || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
    : (existing?.edges ?? []).filter((e) => ids.has(e.from) && ids.has(e.to));
  const flow: E2EFlow = {
    id: existing?.id ?? createId('flow'),
    projectId,
    name: required(text(input.name, existing?.name).trim(), 'name').slice(0, 120),
    description: text(input.description, existing?.description).slice(0, 2_000),
    environmentId:
      input.environmentId !== undefined
        ? text(input.environmentId).trim() || null
        : (existing?.environmentId ?? null),
    nodes,
    edges,
    ...stamps(existing),
  };
  if (hasFlowCycle(flow))
    throw new HttpError(400, 'The arrows form a loop. A flow must go one way (no cycles).');
  return flow;
}

function hasFlowCycle(flow: Pick<E2EFlow, 'nodes' | 'edges'>): boolean {
  const next = new Map<string, string[]>();
  for (const e of flow.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    if ((next.get(id) ?? []).some(visit)) return true;
    state.set(id, 2);
    return false;
  };
  return flow.nodes.some((n) => visit(n.id));
}
