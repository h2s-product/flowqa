import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { UiSchedule } from '@flowqa/shared';
import {
  useDeleteUiSchedule,
  useRunUiScheduleNow,
  useSaveUiSchedule,
  useUiSchedules,
  useUiTests,
} from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, IconButton, Loading, RunCounts, Toggle } from '@/components/ui';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { plural } from '@/lib/format';
import { describeSchedule } from '@/lib/labels';
import { UiScheduleFormModal } from './UiScheduleFormModal';

/** Test Scheduler: jadwal bernama berisi beberapa UI test case (Smoke Test, Regression Test, …). */
export function UiSchedulesPage() {
  const { projectId = '', environments } = useWorkspace();
  const { data: schedules = [], isLoading, error } = useUiSchedules(projectId);
  const { data: tests = [] } = useUiTests(projectId);
  const save = useSaveUiSchedule(projectId);
  const remove = useDeleteUiSchedule(projectId);
  const runNow = useRunUiScheduleNow(projectId);
  const confirm = useConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<UiSchedule | 'new' | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const testName = (id: string) => tests.find((t) => t.id === id)?.name;
  const envName = (id: string | null) =>
    id ? (environments.find((e) => e.id === id)?.name ?? '—') : 'No environment';
  const start = (s: UiSchedule) =>
    runNow.mutate(s.id, {
      onSuccess: ({ queued, skipped }) =>
        toast(
          `Running “${s.name}”: ${plural(queued, 'UI test')} one after another${skipped ? ` (${skipped} skipped)` : ''}.`,
        ),
    });
  const del = async (s: UiSchedule) =>
    (await confirm({
      title: `Delete the schedule “${s.name}”?`,
      message: 'Its UI tests stop running automatically. The tests themselves and their past runs are kept.',
    })) && remove.mutate(s.id, { onSuccess: () => toast('Schedule deleted') });

  return (
    <>
      <div className="row wrap toolbar">
        <span className="small muted">
          Group UI tests into named schedules — e.g. a daily <b>Smoke Test</b> and a weekly{' '}
          <b>Regression Test</b>. Each schedule runs its tests one after another, headless.
        </span>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!tests.length}>
          <Icon name="plus" size={14} /> New schedule
        </button>
      </div>

      <div className="panel">
        {schedules.length ? (
          <div className="tbl-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>UI tests</th>
                  <th>When</th>
                  <th>Last run</th>
                  <th className="num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => {
                  const names = s.testIds.map(testName).filter(Boolean) as string[];
                  const batch = s.lastBatch;
                  return (
                    <tr key={s.id}>
                      <td>
                        <b>{s.name}</b>
                        <div className="small muted">{envName(s.environmentId)}</div>
                      </td>
                      <td className="small" title={names.join('\n')}>
                        {plural(names.length, 'UI test')}
                        <div className="muted sched-names">
                          {names.slice(0, 3).join(', ')}
                          {names.length > 3 ? ', …' : ''}
                        </div>
                      </td>
                      <td className="small">
                        {describeSchedule(s)}
                        <div className="muted">
                          {s.enabled && s.nextRunAt ? (
                            <>
                              Next: <DateTime value={s.nextRunAt} relative />
                            </>
                          ) : (
                            'Schedule is off'
                          )}
                        </div>
                      </td>
                      <td className="small">
                        {batch ? (
                          <>
                            <DateTime value={batch.startedAt} relative />
                            <div>
                              {batch.finishedAt ? (
                                <RunCounts passed={batch.passed} failed={batch.failed} />
                              ) : (
                                <span className="muted">
                                  Running {batch.passed + batch.failed}/{batch.total}…
                                </span>
                              )}
                              {' · '}
                              <Link to="/ui/runs">View runs</Link>
                            </div>
                          </>
                        ) : (
                          <span className="muted">Never run</span>
                        )}
                      </td>
                      <td className="num">
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Toggle
                            checked={s.enabled}
                            label={s.enabled ? 'Turn this schedule off' : 'Turn this schedule on'}
                            onChange={(enabled) => save.mutate({ ...s, enabled })}
                          />
                          <button
                            className="btn sm"
                            disabled={runNow.isPending || (!!batch && !batch.finishedAt)}
                            onClick={() => start(s)}
                          >
                            <Icon name="play" size={12} /> Run now
                          </button>
                          <IconButton icon="edit" label="Edit" onClick={() => setEditing(s)} />
                          <IconButton icon="trash" label="Delete" onClick={() => del(s)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No test schedules yet"
            action={
              tests.length ? (
                <button className="btn primary" onClick={() => setEditing('new')}>
                  <Icon name="plus" size={14} /> Create a schedule
                </button>
              ) : (
                <Link className="btn" to="/ui/tests">
                  Record a UI test first
                </Link>
              )
            }
          >
            Pick the UI tests to run regularly, give the group a name like “Smoke Test”, and choose when it
            runs.
          </EmptyState>
        )}
      </div>

      {editing && (
        <UiScheduleFormModal
          schedule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
