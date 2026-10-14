import { useEffect, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { FlowNodeResult, Run, UiRun } from '@flowqa/shared';
import { LIVE_UI_RUN_STATUSES } from '@flowqa/shared';
import { http } from '@/api/client';
import { POLL, keys } from '@/api/queries';
import { Icon, type IconName } from '@/components/Icon';

export type ProgressStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';

/** Progress step di dalam satu node E2E Flow (dari UI run / API run di bawahnya). */
export interface NodeProgress {
  live: boolean;
  /** Sedang menunggu perangkat Android yang dipakai test lain. */
  waiting: boolean;
  total: number;
  /** Step yang sudah selesai (lulus, gagal, atau dilewati). */
  done: number;
  passed: number;
  failed: number;
  /** Step yang sedang berjalan, atau step terakhir yang selesai. */
  current?: { n: number; name: string; status: ProgressStatus };
  steps: { name: string; status: ProgressStatus }[];
}

const FINISHED: ProgressStatus[] = ['passed', 'failed', 'skipped'];

function summarize(live: boolean, waiting: boolean, steps: NodeProgress['steps']): NodeProgress {
  const running = steps.findIndex((s) => s.status === 'running');
  let at = running;
  if (at < 0) {
    // Tidak ada yang berjalan: tunjukkan step gagal pertama, atau step terakhir yang selesai.
    const failed = steps.findIndex((s) => s.status === 'failed');
    at = failed >= 0 ? failed : steps.map((s) => FINISHED.includes(s.status)).lastIndexOf(true);
  }
  return {
    live,
    waiting,
    total: steps.length,
    done: steps.filter((s) => FINISHED.includes(s.status)).length,
    passed: steps.filter((s) => s.status === 'passed').length,
    failed: steps.filter((s) => s.status === 'failed').length,
    current: at >= 0 ? { n: at + 1, ...steps[at] } : undefined,
    steps,
  };
}

const fromUiRun = (run: UiRun) =>
  summarize(
    LIVE_UI_RUN_STATUSES.includes(run.status),
    run.status === 'queued',
    run.steps.map((s) => ({ name: s.description, status: s.status })),
  );

const fromApiRun = (run: Run) =>
  summarize(
    run.status === 'running',
    false,
    run.steps.map((s) => ({ name: s.name, status: s.status === 'not-run' ? 'skipped' : s.status })),
  );

/**
 * Progress step tiap node yang sudah punya run (UI test / API scenario). Run yang
 * masih berjalan diambil ulang berkala; yang sudah selesai cukup sekali.
 */
export function useNodeProgress(
  nodes: FlowNodeResult[],
  /** Kunci hasil; default id node (di daftar run, id node bisa sama antar-run → pakai runId). */
  keyOf: (n: FlowNodeResult) => string = (n) => n.nodeId,
): Record<string, NodeProgress> {
  const withRun = nodes.filter((n) => n.runId && n.runKind);
  const results = useQueries({
    queries: withRun.map((n) =>
      n.runKind === 'api'
        ? {
            queryKey: keys.run(n.runId!),
            queryFn: () => http.get<Run>(`/runs/${n.runId}`),
            refetchInterval: (q: { state: { data?: Run } }) =>
              q.state.data?.status === 'running' || n.status === 'running' ? POLL.live : false,
          }
        : {
            queryKey: keys.uiRun(n.runId!),
            queryFn: () => http.get<UiRun>(`/ui-runs/${n.runId}`),
            refetchInterval: (q: { state: { data?: UiRun } }) =>
              (q.state.data && LIVE_UI_RUN_STATUSES.includes(q.state.data.status)) || n.status === 'running'
                ? POLL.live
                : false,
          },
    ),
  });
  const out: Record<string, NodeProgress> = {};
  withRun.forEach((n, i) => {
    const data = results[i]?.data;
    if (!data) return;
    out[keyOf(n)] = n.runKind === 'api' ? fromApiRun(data as Run) : fromUiRun(data as UiRun);
  });
  return out;
}

const STATUS_ICON: Record<ProgressStatus, IconName> = {
  queued: 'clock',
  running: 'spin',
  passed: 'check',
  failed: 'x',
  skipped: 'minus',
};

/** Teks singkat untuk kartu node di kanvas. */
export function progressLabel(p: NodeProgress): string {
  if (p.waiting) return 'Waiting for the device…';
  if (p.live && p.current) return `Step ${p.current.n}/${p.total} · ${p.current.name}`;
  if (p.failed && p.current) return `Failed at step ${p.current.n}/${p.total}`;
  return `${p.passed}/${p.total} steps passed`;
}

/** Bar per step: satu segmen berwarna per step (queued abu-abu, berjalan biru berdenyut). */
export function StepBar({ p }: { p: NodeProgress }) {
  if (!p.total) return null;
  if (p.total > 60)
    return (
      <span
        className="step-bar solid"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.done}
      >
        <span style={{ width: `${(p.done / p.total) * 100}%` }} className={p.failed ? 'failed' : 'passed'} />
      </span>
    );
  return (
    <span
      className="step-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={p.total}
      aria-valuenow={p.done}
    >
      {p.steps.map((s, i) => (
        <span key={i} className={s.status} title={`${i + 1}. ${s.name} — ${s.status}`} />
      ))}
    </span>
  );
}

/** Progress ringkas di daftar node: bar + step yang sedang berjalan beserta statusnya. */
export function NodeProgressSummary({ p }: { p: NodeProgress }) {
  return (
    <div className="node-progress">
      <StepBar p={p} />
      <div className="node-progress-text small">
        {p.waiting ? (
          <span className="muted">
            <Icon name="clock" size={11} /> Waiting for the Android device (used by another test)…
          </span>
        ) : p.current ? (
          <>
            <span className={`step-st ${p.current.status}`}>
              <Icon name={STATUS_ICON[p.current.status]} size={10} strokeWidth={3} />
            </span>
            <span className="ellipsis">
              Step {p.current.n}/{p.total} · {p.current.name}
            </span>
            <span className={`step-st-label ${p.current.status}`}>{p.current.status}</span>
          </>
        ) : (
          <span className="muted">Starting…</span>
        )}
      </div>
      <div className="small muted">
        {p.done}/{p.total} done · {p.passed} passed{p.failed ? ` · ${p.failed} failed` : ''}
      </div>
    </div>
  );
}

/** Daftar lengkap step node terpilih, live; step yang berjalan selalu terlihat. */
export function NodeStepList({ p }: { p: NodeProgress }) {
  const active = useRef<HTMLLIElement>(null);
  const currentN = p.current?.n;
  useEffect(() => {
    if (p.live) active.current?.scrollIntoView({ block: 'nearest' });
  }, [currentN, p.live]);
  return (
    <ol className="node-step-list">
      {p.steps.map((s, i) => (
        <li
          key={i}
          ref={i + 1 === currentN ? active : undefined}
          className={`${s.status} ${i + 1 === currentN ? 'current' : ''}`}
        >
          <span className={`step-st ${s.status}`}>
            <Icon name={STATUS_ICON[s.status]} size={10} strokeWidth={3} />
          </span>
          <span className="muted">{i + 1}.</span>
          <span className="ellipsis grow" title={s.name}>
            {s.name}
          </span>
        </li>
      ))}
    </ol>
  );
}
