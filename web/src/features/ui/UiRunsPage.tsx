import { LIVE_UI_RUN_STATUSES } from '@flowqa/shared';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFolders, useStopUiRun, useUiRuns, useUiTests, type UiRunSummary } from '@/api/queries';
import { StopRunButton } from '@/components/runs/StopRunButton';
import { DateTime } from '@/components/DateTime';
import { FolderSelect } from '@/components/folders/FolderSelect';
import { descendants, folderPath, indexFolders } from '@/components/folders/folderIndex';
import { Icon, type IconName } from '@/components/Icon';
import {
  EmptyState,
  ErrorBox,
  Loading,
  RunCounts,
  Segmented,
  SelectCell,
  StatusBadge,
} from '@/components/ui';
import { RunBulkBar } from '@/components/runs/RunBulkBar';
import { useRunDeletion } from '@/components/runs/useRunDeletion';
import { useSelection } from '@/hooks/useSelection';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatMs } from '@/lib/format';

type StatusFilter = 'all' | 'passed' | 'failed' | 'running';

const UNFILED = '__unfiled__';
const DELETED = '__deleted__';

interface RunGroup {
  key: string;
  title: string;
  icon: IconName;
  runs: UiRunSummary[];
}

/**
 * Riwayat UI test run untuk project terpilih, dikelompokkan menurut folder
 * test case-nya saat ini (path lengkap). Run milik test yang sudah dihapus
 * dikumpulkan di grup tersendiri.
 */
export function UiRunsPage() {
  const { projectId } = useWorkspace();
  const { data: runs = [], isLoading, error } = useUiRuns(projectId, { limit: 200 });
  const { data: tests = [] } = useUiTests(projectId);
  const { data: folders = [] } = useFolders('ui', projectId);
  const navigate = useNavigate();
  const stop = useStopUiRun();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const index = useMemo(() => indexFolders(folders, tests), [folders, tests]);
  const testById = useMemo(() => new Map(tests.map((t) => [t.id, t])), [tests]);

  const groups = useMemo(() => {
    const scope = folderId ? descendants(index, folderId) : null;
    const map = new Map<string, RunGroup>();
    for (const run of runs) {
      // ERROR dihitung gagal, QUEUED dihitung berjalan.
      const group = run.status === 'error' ? 'failed' : run.status === 'queued' ? 'running' : run.status;
      if (status !== 'all' && group !== status) continue;
      const test = testById.get(run.testCaseId);
      const fid = test?.folderId && index.byId.has(test.folderId) ? test.folderId : null;
      if (scope && (!fid || !scope.has(fid))) continue;
      const key = !test ? DELETED : (fid ?? UNFILED);
      if (!map.has(key))
        map.set(key, {
          key,
          title: !test ? 'Deleted tests' : fid ? folderPath(index, fid) : 'Unfiled',
          icon: !test ? 'trash' : fid ? 'folder' : 'minus',
          runs: [],
        });
      map.get(key)!.runs.push(run);
    }
    // Folder urut sesuai path; Unfiled dan Deleted tests paling bawah.
    const rank = (g: RunGroup) => (g.key === DELETED ? 2 : g.key === UNFILED ? 1 : 0);
    return [...map.values()].sort(
      (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  }, [runs, testById, index, folderId, status]);

  // Hanya run yang terlihat & sudah selesai yang bisa dipilih untuk dihapus.
  const selectableOf = (list: UiRunSummary[]) =>
    list.filter((r) => !LIVE_UI_RUN_STATUSES.includes(r.status)).map((r) => r.id);
  const selection = useSelection(selectableOf(groups.flatMap((g) => g.runs)));
  const deletion = useRunDeletion('ui');

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!runs.length)
    return (
      <div className="panel">
        <EmptyState title="No UI test runs yet">Open a UI test case and press Run.</EmptyState>
      </div>
    );

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.key));
  const toggle = (key: string) =>
    setCollapsed((c) => new Set(c.has(key) ? [...c].filter((k) => k !== key) : [...c, key]));
  const shown = groups.reduce((n, g) => n + g.runs.length, 0);
  const allSelectable = selectableOf(groups.flatMap((g) => g.runs));
  const allState = selection.stateOf(allSelectable);

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 16, gap: 10 }}>
        <div style={{ width: 220 }}>
          <FolderSelect index={index} value={folderId} onChange={setFolderId} rootLabel="All folders" />
        </div>
        <Segmented<StatusFilter>
          options={[
            { id: 'all', label: 'All' },
            { id: 'passed', label: 'Passed' },
            { id: 'failed', label: 'Failed' },
            { id: 'running', label: 'Running' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <span className="small muted">
          {shown} run{shown === 1 ? '' : 's'} in {groups.length} group{groups.length === 1 ? '' : 's'}
        </span>
        <div className="grow" />
        <button
          className="btn sm ghost"
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.key)))}
          disabled={!groups.length}
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>

      <RunBulkBar
        count={selection.selected.size}
        deleting={deletion.deleting}
        onDelete={() => projectId && deletion.remove(projectId, [...selection.selected], selection.clear)}
        onClear={selection.clear}
      />

      {groups.length ? (
        <div className="panel tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <SelectCell
                  header
                  checked={allState.all}
                  indeterminate={allState.some}
                  disabled={!allSelectable.length}
                  onChange={() => selection.setMany(allSelectable, !allState.all)}
                  label="Select all finished runs"
                />
                <th>Started</th>
                <th>Finished</th>
                <th>Test</th>
                <th>Result</th>
                <th>Steps</th>
                <th>Browser</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const open = !collapsed.has(g.key);
                const passed = g.runs.filter((r) => r.status === 'passed').length;
                const failed = g.runs.filter((r) => r.status === 'failed' || r.status === 'error').length;
                const groupIds = selectableOf(g.runs);
                const groupState = selection.stateOf(groupIds);
                return (
                  <Fragment key={g.key}>
                    <tr className="run-group" onClick={() => toggle(g.key)} aria-expanded={open}>
                      <SelectCell
                        checked={groupState.all}
                        indeterminate={groupState.some}
                        disabled={!groupIds.length}
                        onChange={() => selection.setMany(groupIds, !groupState.all)}
                        label={`Select all finished runs in ${g.title}`}
                      />
                      <td colSpan={7}>
                        <div className="row" style={{ gap: 8 }}>
                          <span className={`tree-caret ${open ? 'open' : ''}`} aria-hidden="true">
                            <Icon name="down" size={12} />
                          </span>
                          <Icon name={g.icon} size={15} />
                          <b>{g.title}</b>
                          <span className="small muted">
                            {g.runs.length} run{g.runs.length === 1 ? '' : 's'}
                          </span>
                          <span className="small">
                            · <RunCounts passed={passed} failed={failed} />
                          </span>
                          <span className="small muted">
                            · last run <DateTime value={g.runs[0].startedAt} relative />
                          </span>
                        </div>
                      </td>
                    </tr>
                    {open &&
                      g.runs.map((r) => (
                        <tr key={r.id} className="click" onClick={() => navigate(`/ui/runs/${r.id}`)}>
                          <SelectCell
                            checked={selection.selected.has(r.id)}
                            disabled={LIVE_UI_RUN_STATUSES.includes(r.status)}
                            onChange={() => selection.toggle(r.id)}
                            label={
                              r.status === 'running'
                                ? 'Running runs cannot be deleted'
                                : `Select run of ${r.testName}`
                            }
                          />
                          <td className="small" style={{ paddingLeft: 24 }}>
                            <DateTime value={r.startedAt} relative />
                          </td>
                          <td className="small">
                            {r.status === 'running' ? (
                              <span className="muted">running…</span>
                            ) : (
                              <DateTime value={r.finishedAt} />
                            )}
                          </td>
                          <td style={{ minWidth: 190 }}>
                            {r.testCode && <span className="chip plain code test-code">{r.testCode}</span>}{' '}
                            <b>{r.testName}</b>
                            {r.scheduleName && (
                              <div>
                                <span className="chip plain" title="Started by Test Scheduler">
                                  <Icon name="clock" size={11} /> {r.scheduleName}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <StatusBadge status={r.status} />
                              {LIVE_UI_RUN_STATUSES.includes(r.status) && (
                                <StopRunButton
                                  compact
                                  pending={stop.isPending && stop.variables === r.id}
                                  what="The browser or Appium session closes (a queued test leaves the device queue) and the remaining steps are skipped."
                                  onStop={(done) => stop.mutate(r.id, done)}
                                />
                              )}
                            </span>
                          </td>
                          <td className="small">
                            <RunCounts
                              passed={r.counts.passed}
                              failed={r.counts.failed}
                              skipped={r.counts.skipped}
                            />
                          </td>
                          <td className="small muted">
                            {r.browser}
                            {r.target === 'mobile' ? ` · ${r.browser}` : r.headless ? '' : ' · visible'}
                          </td>
                          <td className="num code">
                            {LIVE_UI_RUN_STATUSES.includes(r.status) ? '…' : formatMs(r.durationMs)}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <EmptyState title="No runs match these filters">Try another folder or status.</EmptyState>
        </div>
      )}
    </>
  );
}
