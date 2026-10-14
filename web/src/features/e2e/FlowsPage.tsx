import { useNavigate } from 'react-router-dom';
import type { FlowNodeKind } from '@flowqa/shared';
import { useDeleteFlow, useDuplicateFlow, useFlows, useRunFlow, useSaveFlow } from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, IconButton, Loading, StatusBadge } from '@/components/ui';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { KIND_META } from './FlowCanvas';
import { newNodeId } from './flowNodes';

const COUNTED: FlowNodeKind[] = ['web', 'mobile', 'api'];

/** Daftar E2E Flow di project. */
export function FlowsPage() {
  const { projectId = '', environment } = useWorkspace();
  const { data: flows = [], isLoading, error } = useFlows(projectId);
  const create = useSaveFlow(projectId);
  const run = useRunFlow(projectId);
  const duplicate = useDuplicateFlow(projectId);
  const remove = useDeleteFlow(projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const newFlow = () =>
    create.mutate(
      {
        name: 'Untitled flow',
        description: '',
        environmentId: environment?.id ?? null,
        nodes: [{ id: newNodeId(), kind: 'start', refId: null, label: 'Start', x: 0, y: 0, config: {} }],
        edges: [],
      },
      { onSuccess: (f) => navigate(`/e2e/flows/${f.id}`) },
    );

  return (
    <>
      <div className="row wrap toolbar">
        <p className="muted small grow" style={{ margin: 0 }}>
          End-to-end tests across platforms: connect web UI tests, Android tests and API scenarios with
          arrows. Values created in one step (an order id, a new user’s email) flow into the next ones.
        </p>
        <button className="btn primary" disabled={create.isPending} onClick={newFlow}>
          <Icon name="plus" size={14} /> New flow
        </button>
      </div>
      {!flows.length ? (
        <div className="panel">
          <EmptyState
            title="No E2E flows yet"
            action={
              <button className="btn primary" onClick={newFlow}>
                <Icon name="plus" size={14} /> Create your first flow
              </button>
            }
          >
            For example: an API scenario plays the mobile app and submits an order → a web UI test approves it
            in the backoffice → an Android test checks the status in the app.
          </EmptyState>
        </div>
      ) : (
        <div className="panel tbl-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Nodes</th>
                <th>Last run</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flows.map((f) => (
                <tr key={f.id} className="click" onClick={() => navigate(`/e2e/flows/${f.id}`)}>
                  <td style={{ minWidth: 220 }}>
                    <b>{f.name}</b>
                    {f.problems.length > 0 && <div className="small text-fail">{f.problems[0]}</div>}
                    {f.description && !f.problems.length && (
                      <div className="small muted ellipsis">{f.description}</div>
                    )}
                  </td>
                  <td>
                    <span className="row" style={{ gap: 10 }}>
                      {COUNTED.map((k) => {
                        const n = f.nodes.filter((x) => x.kind === k).length;
                        return n ? (
                          <span key={k} className={`flow-count k-${k}`} title={`${n} ${KIND_META[k].label}`}>
                            <Icon name={KIND_META[k].icon} size={12} /> {n}
                          </span>
                        ) : null;
                      })}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {f.lastRun ? (
                      <span onClick={(e) => (e.stopPropagation(), navigate(`/e2e/runs/${f.lastRun!.id}`))}>
                        <StatusBadge status={f.lastRun.status} />{' '}
                        <span className="small">
                          <DateTime value={f.lastRun.startedAt} relative />
                        </span>
                      </span>
                    ) : (
                      <span className="muted small">Never run</span>
                    )}
                  </td>
                  <td className="small">
                    <DateTime value={f.updatedAt} />
                  </td>
                  <td
                    style={{ whiteSpace: 'nowrap', textAlign: 'right' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="btn sm"
                      disabled={run.isPending || f.problems.length > 0}
                      title={f.problems.join(' ') || 'Run this flow'}
                      onClick={() =>
                        run.mutate({ id: f.id }, { onSuccess: (r) => navigate(`/e2e/runs/${r.id}`) })
                      }
                    >
                      <Icon name="play" size={12} /> Run
                    </button>
                    <IconButton
                      icon="copy"
                      label="Duplicate"
                      onClick={() => duplicate.mutate(f.id, { onSuccess: () => toast('Flow duplicated') })}
                    />
                    <IconButton
                      icon="trash"
                      label="Delete"
                      onClick={async () =>
                        (await confirm({
                          title: `Delete “${f.name}”?`,
                          message: 'The flow is deleted. Its test cases and run history stay.',
                        })) && remove.mutate(f.id)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
