/**
 * Laporan hasil test untuk satu project: ringkasan run, status setiap step
 * (hasil terakhir + akumulasi dalam periode), dan data pie chart.
 *
 * Satu mesin laporan dipakai untuk dua jenis: scenario API Tester dan test case
 * UI Tester. Masing-masing hanya perlu adaptor kecil yang mengubah item & run-nya
 * ke bentuk umum (`ReportSubject` / `ReportRun`).
 */
import type {
  Folder,
  ReportData,
  ReportFilter,
  ReportItem,
  ReportItemStatus,
  ReportKind,
  ReportStep,
  Run,
  RunStatus,
  RunTrigger,
  StepStatusCounts,
  UiRun,
} from '@flowqa/shared';
import { uiRunTargetLabel } from '@flowqa/shared';
import type { Repositories } from '../repositories';
import { descendantIds } from './folder-service';
import { averageDuration, percent } from '../domain/run-stats';

/** Item yang dilaporkan (scenario / UI test case) beserta daftar step-nya. */
interface ReportSubject {
  id: string;
  name: string;
  folderId: string | null;
  steps: { id: string; name: string; type: ReportStep['type'] }[];
}

/** Run dalam bentuk umum. */
interface ReportRun {
  id: string;
  subjectId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  trigger: RunTrigger;
  target: string;
  failedStep?: string;
  failureReason?: string;
  steps: {
    stepId: string;
    status: string;
    startedAt?: string;
    durationMs?: number;
    note?: string | null;
  }[];
}

const STATUS_RANK: Record<ReportItemStatus, number> = { failing: 0, passing: 1, 'not-executed': 2 };

const emptyCounts = (): StepStatusCounts => ({ passed: 0, failed: 0, skipped: 0, notRun: 0 });

function countStatus(counts: StepStatusCounts, status: string) {
  if (status === 'passed') counts.passed++;
  else if (status === 'failed') counts.failed++;
  else if (status === 'skipped') counts.skipped++;
  else counts.notRun++;
}

/**
 * Status item = hasil run terakhir yang sudah selesai (`runs` terurut terbaru
 * dulu). Test yang pernah gagal lalu lulus di run terbaru dianggap passing.
 */
function itemStatus(runs: ReportRun[]): ReportItemStatus {
  // Run yang masih berjalan/antre atau dihentikan (Stop) belum punya hasil: pakai run selesai sebelumnya.
  const latest = runs.find((r) => !['running', 'queued', 'stopped'].includes(r.status));
  if (!latest) return 'not-executed';
  return latest.status === 'failed' ? 'failing' : 'passing';
}

function itemReport(subject: ReportSubject, runs: ReportRun[]): ReportItem {
  // `runs` sudah terurut terbaru dulu.
  const last = runs[0];
  const byStep = new Map<string, StepStatusCounts>();
  for (const run of runs) {
    for (const step of run.steps) {
      const counts = byStep.get(step.stepId) ?? emptyCounts();
      countStatus(counts, step.status);
      byStep.set(step.stepId, counts);
    }
  }

  const steps: ReportStep[] = subject.steps.map((step, index) => {
    const lastResult = last?.steps.find((s) => s.stepId === step.id);
    return {
      stepId: step.id,
      index,
      name: step.name,
      type: step.type,
      ...(byStep.get(step.id) ?? emptyCounts()),
      lastStatus: (lastResult?.status as ReportStep['lastStatus']) ?? null,
      lastStartedAt: lastResult?.startedAt ?? null,
      lastDurationMs: lastResult?.durationMs ?? null,
      lastNote: lastResult?.note ?? null,
    };
  });

  const passedRuns = runs.filter((r) => r.status === 'passed').length;
  return {
    id: subject.id,
    name: subject.name,
    folderId: subject.folderId,
    status: itemStatus(runs),
    runs: runs.length,
    passedRuns,
    failedRuns: runs.length - passedRuns,
    passRate: percent(passedRuns, runs.length),
    avgDurationMs: averageDuration(runs),
    lastRun: last
      ? {
          id: last.id,
          status: last.status,
          startedAt: last.startedAt,
          finishedAt: last.finishedAt,
          target: last.target,
          durationMs: last.durationMs,
          trigger: last.trigger,
          failedStep: last.failedStep,
          failureReason: last.failureReason,
        }
      : null,
    steps,
  };
}

/** Batasi item ke folder terpilih beserta subfoldernya. */
function inFolder<T extends { folderId: string | null }>(
  items: T[],
  folders: Folder[],
  folderId: string | null,
) {
  if (!folderId) return items;
  const scope = new Set([folderId, ...descendantIds(folders, folderId)]);
  return items.filter((i) => i.folderId && scope.has(i.folderId));
}

function assembleReport(
  kind: ReportKind,
  filter: ReportFilter,
  subjects: ReportSubject[],
  allRuns: ReportRun[],
): ReportData {
  const inScope = new Set(subjects.map((s) => s.id));
  const runs = allRuns.filter((r) => inScope.has(r.subjectId));
  const runsBySubject = new Map<string, ReportRun[]>();
  runs.forEach((r) => runsBySubject.set(r.subjectId, [...(runsBySubject.get(r.subjectId) ?? []), r]));

  const items = subjects
    .map((s) => itemReport(s, runsBySubject.get(s.id) ?? []))
    // Gagal dulu, lalu lulus, lalu yang belum dijalankan; di dalamnya urut nama.
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );

  const steps = emptyCounts();
  runs.forEach((r) => r.steps.forEach((s) => countStatus(steps, s.status)));
  const passedRuns = runs.filter((r) => r.status === 'passed').length;

  return {
    kind,
    filter,
    generatedAt: new Date().toISOString(),
    summary: {
      items: subjects.length,
      executedItems: items.filter((r) => r.lastRun).length,
      runs: runs.length,
      passedRuns,
      failedRuns: runs.length - passedRuns,
      passRate: percent(passedRuns, runs.length),
      avgDurationMs: averageDuration(runs),
      steps,
    },
    itemStatus: {
      passing: items.filter((r) => r.status === 'passing').length,
      failing: items.filter((r) => r.status === 'failing').length,
      notExecuted: items.filter((r) => r.status === 'not-executed').length,
    },
    items,
  };
}

/* ----------------------------- adaptor API ----------------------------- */

const apiRun = (run: Run): ReportRun => ({
  id: run.id,
  subjectId: run.scenarioId,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  durationMs: run.durationMs,
  trigger: run.trigger,
  target: run.environmentName,
  failedStep: run.failedStep,
  failureReason: run.failureReason,
  steps: run.steps.map((s) => ({
    stepId: s.stepId,
    status: s.status,
    startedAt: s.startedAt,
    durationMs: s.durationMs,
    note: s.explanation?.title ?? s.note ?? null,
  })),
});

/** Laporan scenario API Tester. */
export function buildApiReport(repos: Repositories, projectId: string, filter: ReportFilter): ReportData {
  const scenarios = repos.scenarios.list({ project_id: projectId }).map((s): ReportSubject => ({
    id: s.id,
    name: s.name,
    folderId: s.folderId ?? null,
    steps: s.steps.map((step) => ({ id: step.id, name: step.name, type: step.type })),
  }));
  const subjects = inFolder(
    scenarios,
    repos.scenarioFolders.list({ project_id: projectId }),
    filter.folderId,
  );
  const runs = repos.runs
    .between(projectId, filter.from, filter.to)
    .filter((r) => !filter.environmentId || r.environmentId === filter.environmentId)
    .map(apiRun);
  return assembleReport('api', filter, subjects, runs);
}

/* ----------------------------- adaptor UI ------------------------------ */

const uiRun = (run: UiRun): ReportRun => {
  const failed = run.steps.find((s) => s.status === 'failed');
  return {
    id: run.id,
    subjectId: run.testCaseId,
    // ERROR (tidak bisa dijalankan) dihitung gagal; QUEUED masih berjalan.
    status: run.status === 'error' ? 'failed' : run.status === 'queued' ? 'running' : run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    trigger: run.trigger,
    target: uiRunTargetLabel(run),
    failedStep: failed?.description,
    failureReason: failed?.error ?? run.failureReason,
    steps: run.steps.map((s) => ({
      stepId: s.stepId,
      status: s.status,
      startedAt: s.startedAt,
      durationMs: s.durationMs,
      note: s.error ?? s.detail ?? null,
    })),
  };
};

/** Laporan test case UI Tester. */
export function buildUiReport(repos: Repositories, projectId: string, filter: ReportFilter): ReportData {
  const tests = repos.uiTests.list({ project_id: projectId }).map((t): ReportSubject => ({
    id: t.id,
    name: t.name,
    folderId: t.folderId ?? null,
    steps: t.steps.map((step) => ({ id: step.id, name: step.description, type: step.type })),
  }));
  const subjects = inFolder(tests, repos.uiFolders.list({ project_id: projectId }), filter.folderId);
  const runs = repos.uiRuns.between(projectId, filter.from, filter.to).map(uiRun);
  return assembleReport('ui', filter, subjects, runs);
}
