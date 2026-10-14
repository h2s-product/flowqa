import { useState } from 'react';
import { useRuns } from '@/api/queries';
import { ErrorBox, Loading, Segmented } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { RunTable } from '@/components/runs/RunTable';
import { RunBulkBar } from '@/components/runs/RunBulkBar';
import { useRunDeletion } from '@/components/runs/useRunDeletion';
import { useSelection } from '@/hooks/useSelection';

type Filter = 'all' | 'passed' | 'failed' | 'running';

export function RunsPage() {
  const { projectId } = useWorkspace();
  const [filter, setFilter] = useState<Filter>('all');
  const {
    data: runs = [],
    isLoading,
    error,
  } = useRuns(projectId, { status: filter === 'all' ? undefined : filter, limit: 200 });
  const selection = useSelection(runs.filter((r) => r.status !== 'running').map((r) => r.id));
  const deletion = useRunDeletion('api');
  const deleteSelected = () =>
    projectId && deletion.remove(projectId, [...selection.selected], selection.clear);

  return (
    <>
      <div className="row wrap toolbar">
        <Segmented
          options={[
            { id: 'all', label: 'All' },
            { id: 'passed', label: 'Passed' },
            { id: 'failed', label: 'Failed' },
            { id: 'running', label: 'Running' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div className="grow" />
        {projectId && (
          <a className="btn" href={`/api/projects/${projectId}/runs.csv`} download>
            Download report (CSV)
          </a>
        )}
      </div>
      <RunBulkBar
        count={selection.selected.size}
        deleting={deletion.deleting}
        onDelete={deleteSelected}
        onClear={selection.clear}
      />
      <div className="panel">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <RunTable runs={runs} selection={selection} />
        )}
      </div>
    </>
  );
}
