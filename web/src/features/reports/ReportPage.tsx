import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ReportData,
  ReportItem,
  ReportItemStatus,
  ReportKind,
  ReportStep,
  StepStatusCounts,
} from '@flowqa/shared';
import { useFolders, useNotificationStatus, useReport } from '@/api/queries';
import { DonutChart, type DonutSlice } from '@/components/charts/DonutChart';
import { FolderSelect } from '@/components/folders/FolderSelect';
import { folderPath, indexFolders } from '@/components/folders/folderIndex';
import { Icon } from '@/components/Icon';
import {
  EmptyState,
  ErrorBox,
  IconButton,
  Loading,
  RunCounts,
  SearchInput,
  Segmented,
  Stat,
  StatGrid,
  StatusBadge,
  StatusIcon,
  type AnyStatus,
} from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { DateTime } from '@/components/DateTime';
import { formatDateTime, formatMs, formatNumber, plural } from '@/lib/format';
import { PASS_RATE_TARGET } from '@/lib/labels';
import { downloadFile, standaloneHtml } from '@/lib/standaloneHtml';
import { EmailReportModal } from './EmailReportModal';
import { REPORT_CONFIG, capitalize, type ReportConfig } from './reportConfig';

type Period = 'today' | '7d' | '30d' | '90d';
type StatusFilter = 'all' | 'failing' | 'passing' | 'not-executed';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
];

/** Warna status (sama dengan badge status di seluruh aplikasi). */
const STATUS_COLOR = {
  passed: 'var(--green)',
  failed: 'var(--red)',
  skipped: 'var(--amber)',
  notRun: 'var(--ink3)',
};

function periodRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now);
  if (period === 'today') from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - Number(period.replace('d', '')));
  return { from: from.toISOString(), to: now.toISOString() };
}

/** Ikon per status item (status dihitung server sesuai aturan laporan). */
const ITEM_ICON: Record<ReportItemStatus, AnyStatus> = {
  passing: 'passed',
  failing: 'failed',
  'not-executed': 'skipped',
};

/**
 * Halaman Reports. Dipakai API Tester (`kind="api"`, per scenario) dan UI Tester
 * (`kind="ui"`, per UI test case); perbedaannya diatur di reportConfig.ts.
 */
export function ReportPage({ kind }: { kind: ReportKind }) {
  const config = REPORT_CONFIG[kind];
  const { project, projectId, environments } = useWorkspace();
  const [period, setPeriod] = useState<Period>('7d');
  // Rentang dihitung sekali per pilihan periode supaya query tidak berubah tiap render.
  const [range, setRange] = useState(() => periodRange('7d'));
  const [environmentId, setEnvironmentId] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [emailing, setEmailing] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const { data: notifyStatus } = useNotificationStatus();

  const { data, isLoading, isFetching, error } = useReport(kind, projectId, {
    ...range,
    environmentId: (config.filterByEnvironment && environmentId) || undefined,
    folderId: folderId ?? undefined,
  });
  const { data: folders = [] } = useFolders(config.folderKind, projectId);
  const folderIndex = useMemo(() => indexFolders(folders, []), [folders]);

  const choosePeriod = (p: Period) => {
    setPeriod(p);
    setRange(periodRange(p));
  };

  if (!projectId) return <EmptyState title="No project yet">Create or open a project first.</EmptyState>;
  if (isLoading && !data) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;

  const q = search.trim().toLowerCase();
  const shown = data.items.filter(
    (s) => (status === 'all' || s.status === status) && (!q || s.name.toLowerCase().includes(q)),
  );
  const counts = {
    all: data.items.length,
    failing: data.itemStatus.failing,
    passing: data.itemStatus.passing,
    'not-executed': data.itemStatus.notExecuted,
  };
  const allOpen = shown.length > 0 && shown.every((s) => expanded.has(s.id));
  const toggle = (id: string) =>
    setExpanded((e) => new Set(e.has(id) ? [...e].filter((x) => x !== id) : [...e, id]));

  const print = () => {
    setExpanded(new Set(data.items.map((s) => s.id)));
    setTimeout(() => window.print(), 150);
  };

  const exportName = `${config.csvPrefix}-${(project?.name ?? 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${data.filter.to.slice(0, 10)}.html`;
  /** Halaman ini sebagai file HTML mandiri: semua item yang tampil dibuka dulu (seperti mode cetak). */
  const captureHtml = async (): Promise<string> => {
    const before = expanded;
    setExpanded(new Set(shown.map((x) => x.id)));
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      return standaloneHtml(reportRef.current!, {
        title: `${config.printTitle} · ${project?.name ?? ''}`,
        footer: `Generated by Testora on ${formatDateTime(new Date().toISOString())}`,
      });
    } finally {
      setExpanded(before);
    }
  };
  const downloadHtml = async () => downloadFile(await captureHtml(), exportName);

  const s = data.summary;
  const envName = config.filterByEnvironment
    ? (environments.find((e) => e.id === environmentId)?.name ?? 'All environments')
    : '';
  const periodLabel = `${formatDateTime(data.filter.from)} – ${formatDateTime(data.filter.to)}`;

  return (
    <>
      <div className="report" ref={reportRef}>
        {/* Kop khusus cetak */}
        <div className="print-only report-print-head">
          <h2>
            {config.printTitle} · {project?.name}
          </h2>
          <div className="small">
            {periodLabel}
            {envName && ` · ${envName}`}
            {folderId ? ` · Folder: ${folderPath(folderIndex, folderId)}` : ''} · generated{' '}
            {formatDateTime(data.generatedAt)}
          </div>
        </div>

        <div className="row wrap no-print report-filters">
          <Segmented options={PERIODS} value={period} onChange={choosePeriod} />
          {config.filterByEnvironment && (
            <select
              className="in"
              style={{ width: 180 }}
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
              aria-label="Environment"
            >
              <option value="">All environments</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
          <div style={{ width: 200 }}>
            <FolderSelect
              index={folderIndex}
              value={folderId}
              onChange={setFolderId}
              rootLabel="All folders"
            />
          </div>
          <IconButton
            icon={isFetching ? 'spin' : 'pulse'}
            label="Refresh"
            size={15}
            onClick={() => setRange(periodRange(period))}
          />
          <div className="grow" />
          <button
            className="btn"
            onClick={() => downloadCsv(data, config, project?.name ?? 'project', folderIndex)}
          >
            <Icon name="download" size={14} /> Export CSV
          </button>
          <button className="btn" onClick={print}>
            <Icon name="printer" size={14} /> Print / PDF
          </button>
          <button
            className="btn"
            onClick={downloadHtml}
            title="The report exactly as shown, as one HTML file"
          >
            <Icon name="download" size={14} /> Download HTML
          </button>
          <button
            className="btn primary"
            onClick={() => setEmailing(true)}
            disabled={!project || !notifyStatus?.emailConfigured}
            title={
              notifyStatus?.emailConfigured
                ? 'Email this report with the page attached as HTML'
                : 'Email is not set up yet (Settings → Email Report)'
            }
          >
            <Icon name="mail" size={14} /> Email report
          </button>
        </div>

        <div className="report-meta small muted no-print">
          <Icon name="clock" size={13} /> Period <b>{periodLabel}</b> · generated{' '}
          <DateTime value={data.generatedAt} />
        </div>

        <StatGrid>
          <Stat label={`${capitalize(config.many)} executed`} value={`${s.executedItems} / ${s.items}`} />
          <Stat label="Test runs" value={formatNumber(s.runs)} />
          <Stat
            label="Run pass rate"
            value={s.runs ? `${s.passRate}%` : '—'}
            tone={s.runs ? (s.passRate >= PASS_RATE_TARGET ? 'g' : 'r') : undefined}
          />
          <Stat label="Steps passed" value={formatNumber(s.steps.passed)} tone="g" />
          <Stat
            label="Steps failed"
            value={formatNumber(s.steps.failed)}
            tone={s.steps.failed ? 'r' : undefined}
          />
          <Stat label="Steps skipped" value={formatNumber(s.steps.skipped)} />
          <Stat label="Avg run time" value={s.runs ? formatMs(s.avgDurationMs) : '—'} />
        </StatGrid>

        <div className="dash-grid">
          <section className="panel c-6">
            <div className="panel-h">
              <h3>{capitalize(config.one)} status</h3>
              <span className="small muted">latest run of each {config.one}</span>
            </div>
            <div className="panel-b">
              <DonutChart
                label={`${capitalize(config.one)} status: passing, failing and not executed`}
                centerValue={`${s.items ? Math.round((data.itemStatus.passing / s.items) * 100) : 0}%`}
                centerLabel="passing"
                slices={[
                  {
                    key: 'passing',
                    label: 'Passing',
                    value: data.itemStatus.passing,
                    color: STATUS_COLOR.passed,
                    icon: 'check',
                  },
                  {
                    key: 'failing',
                    label: 'Failing',
                    value: data.itemStatus.failing,
                    color: STATUS_COLOR.failed,
                    icon: 'x',
                  },
                  {
                    key: 'not-executed',
                    label: 'Not executed',
                    value: data.itemStatus.notExecuted,
                    color: STATUS_COLOR.notRun,
                    icon: 'minus',
                  },
                ]}
              />
            </div>
          </section>
          <section className="panel c-6">
            <div className="panel-h">
              <h3>Step results</h3>
              <span className="small muted">every step in every run</span>
            </div>
            <div className="panel-b">
              <DonutChart
                label="Step results: passed, failed, skipped and not run"
                centerValue={`${stepPassRate(s.steps)}%`}
                centerLabel="steps passed"
                slices={stepSlices(s.steps)}
              />
            </div>
          </section>
        </div>

        <section className="panel" style={{ marginTop: 16 }}>
          <div className="panel-h wrap" style={{ gap: 10 }}>
            <h3>Results per {config.one}</h3>
            <div className="grow" />
            <div className="no-print row wrap" style={{ gap: 8 }}>
              <Segmented<StatusFilter>
                options={[
                  { id: 'all', label: `All ${counts.all}` },
                  { id: 'failing', label: `Failing ${counts.failing}` },
                  { id: 'passing', label: `Passing ${counts.passing}` },
                  { id: 'not-executed', label: `Not run ${counts['not-executed']}` },
                ]}
                value={status}
                onChange={setStatus}
              />
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={`Search ${config.one}`}
                width={180}
              />
              <button
                className="btn sm ghost"
                onClick={() => setExpanded(allOpen ? new Set() : new Set(shown.map((x) => x.id)))}
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {shown.length ? (
            shown.map((item) => (
              <ItemResult
                key={item.id}
                item={item}
                config={config}
                folder={item.folderId ? folderPath(folderIndex, item.folderId) : ''}
                open={expanded.has(item.id)}
                onToggle={() => toggle(item.id)}
              />
            ))
          ) : (
            <EmptyState
              title={
                data.items.length ? `No ${config.many} match these filters` : `No ${config.many} in scope`
              }
            >
              {data.items.length ? 'Try another status filter or search.' : config.emptyHint}
            </EmptyState>
          )}
        </section>
      </div>
      {emailing && project && (
        <EmailReportModal
          kind={kind}
          project={project}
          filter={{
            ...range,
            environmentId: (config.filterByEnvironment && environmentId) || undefined,
            folderId: folderId ?? undefined,
          }}
          fileName={exportName}
          describe={`${periodLabel}${envName ? ` · ${envName}` : ''}${folderId ? ` · Folder: ${folderPath(folderIndex, folderId)}` : ''} · ${plural(shown.length, config.one)}`}
          capture={captureHtml}
          onClose={() => setEmailing(false)}
        />
      )}
    </>
  );
}

const stepPassRate = (c: StepStatusCounts) => {
  const total = c.passed + c.failed + c.skipped + c.notRun;
  return total ? Math.round((c.passed / total) * 100) : 0;
};

const stepSlices = (c: StepStatusCounts): DonutSlice[] => [
  { key: 'passed', label: 'Passed', value: c.passed, color: STATUS_COLOR.passed, icon: 'check' },
  { key: 'failed', label: 'Failed', value: c.failed, color: STATUS_COLOR.failed, icon: 'x' },
  { key: 'skipped', label: 'Skipped', value: c.skipped, color: STATUS_COLOR.skipped, icon: 'skip' },
  { key: 'notRun', label: 'Not run', value: c.notRun, color: STATUS_COLOR.notRun, icon: 'minus' },
];

function ItemResult({
  item: s,
  config,
  folder,
  open,
  onToggle,
}: {
  item: ReportItem;
  config: ReportConfig;
  folder: string;
  open: boolean;
  onToggle: () => void;
}) {
  const last = s.lastRun;
  return (
    <div className={`rep-scn ${open ? 'open' : ''}`}>
      <button className="rep-scn-h" onClick={onToggle} aria-expanded={open}>
        <span className={`tree-caret ${open ? 'open' : ''}`} aria-hidden="true">
          <Icon name="down" size={12} />
        </span>
        <StatusIcon status={ITEM_ICON[s.status]} />
        <span className="rep-scn-name">
          <b>{s.name}</b>
          <span className="small muted">
            {folder && (
              <>
                <Icon name="folder" size={11} /> {folder} ·{' '}
              </>
            )}
            {s.steps.length} step{s.steps.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="rep-scn-meta">
          {last ? (
            <>
              <span className="small">
                <b>{plural(s.runs, 'run')}</b> · <RunCounts passed={s.passedRuns} failed={s.failedRuns} />
              </span>
              <span className="rep-meter" title={`${s.passRate}% of runs passed`}>
                <span style={{ width: `${s.passRate}%` }} />
              </span>
              <span className="small muted">
                {s.passRate}% · avg {formatMs(s.avgDurationMs)} · last run{' '}
                <DateTime value={last.startedAt} relative /> on {last.target}
              </span>
            </>
          ) : (
            <span className="small muted">Not executed in this period</span>
          )}
        </span>
      </button>

      {open && (
        <div className="rep-scn-b">
          {last?.failureReason && (
            <div className="rep-fail small">
              <Icon name="x" size={12} /> Last run failed at <b>{last.failedStep}</b>: {last.failureReason}
            </div>
          )}
          <div className="tbl-wrap">
            <table className="t rep-steps">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th style={{ minWidth: 170 }}>Step</th>
                  <th>Last result</th>
                  <th>Executed at</th>
                  <th className="num">Time</th>
                  <th style={{ minWidth: 190 }}>All runs in period</th>
                  <th style={{ minWidth: 220 }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {s.steps.map((step) => (
                  <StepRow key={step.stepId} step={step} typeLabel={config.stepTypeLabel(step.type)} />
                ))}
              </tbody>
            </table>
          </div>
          {last && (
            <div className="row no-print" style={{ padding: '10px 16px', gap: 8 }}>
              <span className="small muted">
                Last run <DateTime value={last.startedAt} /> → <DateTime value={last.finishedAt} timeOnly /> ·{' '}
                {last.trigger === 'schedule' ? 'scheduled' : 'manual'} · {formatMs(last.durationMs)}
              </span>
              <div className="grow" />
              <Link className="btn sm" to={config.runPath(last.id)}>
                Open last run
              </Link>
              <Link className="btn sm ghost" to={config.itemPath(s.id)}>
                Open {config.one}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepRow({ step, typeLabel }: { step: ReportStep; typeLabel: string }) {
  const total = step.passed + step.failed + step.skipped + step.notRun;
  const parts = stepSlices(step).filter((p) => p.value > 0);
  return (
    <tr>
      <td className="muted">{step.index + 1}</td>
      <td>
        <b>{step.name}</b>
        <div className="small muted">{typeLabel}</div>
      </td>
      <td>
        {step.lastStatus ? <StatusBadge status={step.lastStatus} /> : <span className="small muted">—</span>}
      </td>
      <td className="small">
        <DateTime value={step.lastStartedAt} />
      </td>
      <td className="num small">{step.lastDurationMs != null ? formatMs(step.lastDurationMs) : '—'}</td>
      <td>
        {total ? (
          <div className="rep-hist">
            <div
              className="rep-stack"
              role="img"
              aria-label={parts.map((p) => `${p.value} ${p.label}`).join(', ')}
            >
              {parts.map((p) => (
                <span
                  key={p.key}
                  title={`${p.label}: ${p.value}`}
                  style={{ flexGrow: p.value, background: p.color }}
                />
              ))}
            </div>
            <span className="small">
              {step.passed} ✓{step.failed ? ` · ${step.failed} ✕` : ''}
              {step.skipped ? ` · ${step.skipped} skipped` : ''}
              {step.notRun ? ` · ${step.notRun} not run` : ''}
            </span>
          </div>
        ) : (
          <span className="small muted">No runs</span>
        )}
      </td>
      <td className="small" style={{ color: step.lastStatus === 'failed' ? 'var(--red)' : 'var(--ink2)' }}>
        {step.lastNote ?? ''}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */

function downloadCsv(
  data: ReportData,
  config: ReportConfig,
  projectName: string,
  folderIndex: ReturnType<typeof indexFolders>,
) {
  const header = [
    capitalize(config.one),
    'Folder',
    'Runs',
    'Passed runs',
    'Failed runs',
    'Pass rate %',
    'Last result',
    'Last run started',
    'Last run finished',
    config.targetLabel,
    'Step #',
    'Step',
    'Step last result',
    'Step executed at',
    'Step passed',
    'Step failed',
    'Step skipped',
    'Step not run',
    'Note',
  ];
  const rows = data.items.flatMap((s) =>
    (s.steps.length ? s.steps : [null]).map((step) => [
      s.name,
      s.folderId ? folderPath(folderIndex, s.folderId) : '',
      s.runs,
      s.passedRuns,
      s.failedRuns,
      s.passRate,
      s.lastRun?.status ?? 'not executed',
      csvDate(s.lastRun?.startedAt),
      csvDate(s.lastRun?.finishedAt),
      s.lastRun?.target ?? '',
      step ? step.index + 1 : '',
      step?.name ?? '',
      step?.lastStatus ?? '',
      csvDate(step?.lastStartedAt),
      step?.passed ?? '',
      step?.failed ?? '',
      step?.skipped ?? '',
      step?.notRun ?? '',
      step?.lastNote ?? '',
    ]),
  );
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${config.csvPrefix}-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${data.filter.to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tanggal lokal yang mudah dibaca & diurutkan di spreadsheet, mis. "2026-09-26 17:08:23". */
function csvDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
