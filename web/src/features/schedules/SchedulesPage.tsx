import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Schedule } from '@flowqa/shared';
import {
  useDeleteSchedule,
  useRunSchedule,
  useSaveSchedule,
  useScenarios,
  useSchedules,
} from '@/api/queries';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, IconButton, Loading, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ScheduleFormModal } from './ScheduleFormModal';
import { DateTime } from '@/components/DateTime';
import { describeSchedule } from '@/lib/labels';
import { useConfirm } from '@/context/ConfirmContext';

export function SchedulesPage() {
  const { projectId = '', environments } = useWorkspace();
  const { data: schedules = [], isLoading, error } = useSchedules(projectId);
  const { data: scenarios = [] } = useScenarios(projectId);
  const save = useSaveSchedule(projectId);
  const confirm = useConfirm();
  const remove = useDeleteSchedule(projectId);
  const runNow = useRunSchedule(projectId);
  const toast = useToast();
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const describe = (s: Schedule) => describeSchedule(s);

  return (
    <>
      <div className="row wrap toolbar">
        <p className="muted" style={{ margin: 0 }}>
          Run scenarios automatically, for example every morning before the team starts testing.
        </p>
        <div className="grow" />
        <button className="btn primary" onClick={() => setEditing('new')} disabled={!scenarios.length}>
          <Icon name="plus" size={14} /> New schedule
        </button>
      </div>

      {schedules.length ? (
        <div className="panel tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Environment</th>
                <th>When</th>
                <th>Next run</th>
                <th>Last run</th>
                <th>Created</th>
                <th>On</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{scenarios.find((x) => x.id === s.scenarioId)?.name ?? 'Deleted scenario'}</b>
                  </td>
                  <td>{environments.find((e) => e.id === s.environmentId)?.name ?? '—'}</td>
                  <td>{describe(s)}</td>
                  <td className="small">
                    {s.enabled ? (
                      <DateTime value={s.nextRunAt} relative />
                    ) : (
                      <span className="muted">paused</span>
                    )}
                  </td>
                  <td className="small">
                    {s.lastRunId ? (
                      <Link to={`/runs/${s.lastRunId}`}>
                        {s.lastRunAt ? <DateTime value={s.lastRunAt} /> : 'View'}
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="small">
                    <DateTime value={s.createdAt} />
                  </td>
                  <td>
                    <Toggle
                      checked={s.enabled}
                      onChange={(enabled) => save.mutate({ ...s, enabled })}
                      label="Enabled"
                    />
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button
                      className="btn sm"
                      onClick={() =>
                        runNow.mutate(s.id, { onSuccess: () => toast('Run started — see Test Runs') })
                      }
                    >
                      <Icon name="play" size={12} /> Run now
                    </button>
                    <button className="btn sm ghost" onClick={() => setEditing(s)}>
                      Edit
                    </button>
                    <IconButton
                      icon="trash"
                      label="Delete"
                      onClick={async () =>
                        (await confirm({
                          title: 'Delete this schedule?',
                          message: 'The scenario stops running automatically. Past runs stay in Test Runs.',
                        })) && remove.mutate(s.id)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel">
          <EmptyState title="No schedules yet">Create a scenario first, then schedule it here.</EmptyState>
        </div>
      )}

      {editing && (
        <ScheduleFormModal
          schedule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
