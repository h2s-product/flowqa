import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useDeleteScenario,
  useDuplicateScenario,
  useRunAll,
  useScenarios,
  useStartRunAndOpen,
} from '@/api/queries';
import { FolderBrowser } from '@/components/folders/FolderBrowser';
import { descendants } from '@/components/folders/folderIndex';
import { useFolderBrowser } from '@/components/folders/useFolderBrowser';
import { Icon } from '@/components/Icon';
import { ErrorBox, IconButton, Loading, SearchInput, SelectCell, StatusBadge } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { NewScenarioModal } from './NewScenarioModal';
import { DateTime } from '@/components/DateTime';
import { useConfirm } from '@/context/ConfirmContext';

const LABELS = { one: 'scenario', many: 'scenarios' };

export function ScenariosPage() {
  const { projectId = '', environment } = useWorkspace();
  const { data: scenarios = [], isLoading, error } = useScenarios(projectId);
  const duplicate = useDuplicateScenario(projectId);
  const remove = useDeleteScenario(projectId);
  const confirm = useConfirm();
  const startRun = useStartRunAndOpen();
  const runAll = useRunAll(projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const browser = useFolderBrowser({
    kind: 'scenario',
    projectId,
    items: scenarios,
    labels: LABELS,
    matches: (s, q) => `${s.name} ${s.description}`.toLowerCase().includes(q),
  });

  if (isLoading || browser.loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const folder = browser.selectedFolder;
  // Scenario yang ikut "Run": seluruh project, atau folder terpilih beserta subfoldernya.
  const inScope = folder
    ? scenarios.filter((s) => s.folderId && descendants(browser.index, folder.id).has(s.folderId))
    : scenarios;
  const runnable = inScope.filter((s) => s.steps.length).length;

  const run = (scenarioId: string) =>
    environment && startRun.run({ scenarioId, environmentId: environment.id });

  const runMany = () =>
    environment &&
    runAll.mutate(
      { environmentId: environment.id, folderId: folder?.id },
      {
        onSuccess: ({ queued }) => {
          toast(
            `Running ${queued} scenario${queued === 1 ? '' : 's'} on ${environment.name}. Results appear in Test Runs.`,
          );
          navigate('/runs');
        },
      },
    );

  return (
    <>
      <div className="row wrap toolbar">
        <SearchInput value={browser.search} onChange={browser.setSearch} placeholder="Search all scenarios" />
        <div className="grow" />
        {runnable > 0 && (
          <button
            className="btn"
            onClick={runMany}
            disabled={runAll.isPending}
            title={folder ? `Runs every scenario in "${folder.name}" and its subfolders` : undefined}
          >
            <Icon name="play" size={13} /> {folder ? `Run folder (${runnable})` : 'Run all'} on{' '}
            {environment?.name}
          </button>
        )}
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} /> New scenario
        </button>
      </div>

      <FolderBrowser
        browser={browser}
        allIcon="flow"
        searchHint="Try another name or description."
        onAddHere={() => setCreating(true)}
        emptyProject={{
          title: 'No scenarios yet',
          body: 'Create one and add steps like Login, Create Order and Verify Payment.',
          action: (
            <button className="btn primary" onClick={() => setCreating(true)}>
              Create your first scenario
            </button>
          ),
        }}
        tableHead={
          <thead>
            <tr>
              <th />
              <th>Scenario</th>
              <th>Steps</th>
              <th>Checks</th>
              <th>Last result</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
        }
        renderRows={(items, { showFolder }) =>
          items.map((s) => (
            <tr
              key={s.id}
              className={`click ${browser.checked.has(s.id) ? 'selected' : ''}`}
              onClick={() => navigate(`/scenarios/${s.id}`)}
              draggable
              onDragStart={(e) => browser.dragItem(e, s)}
            >
              <SelectCell
                checked={browser.checked.has(s.id)}
                onChange={() => browser.toggleCheck(s.id)}
                label={`Select ${s.name}`}
              />
              <td style={{ minWidth: 200 }}>
                <b>{s.name}</b>
                <div className="small muted">
                  {showFolder ? (
                    <>
                      <Icon name="folder" size={11} /> {browser.folderLabel(s)}
                    </>
                  ) : (
                    s.description
                  )}
                </div>
              </td>
              <td>{s.steps.length}</td>
              <td>{s.steps.reduce((n, st) => n + (st.type === 'api' ? st.assertions.length : 0), 0)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {s.lastRun ? (
                  <>
                    <StatusBadge status={s.lastRun.status} />{' '}
                    <span className="small">
                      <DateTime value={s.lastRun.startedAt} relative />
                      <span className="muted"> · {s.lastRun.environmentName}</span>
                    </span>
                  </>
                ) : (
                  <span className="muted small">Never run</span>
                )}
              </td>
              <td className="small">
                <DateTime value={s.updatedAt} />
              </td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                <button className="btn sm" onClick={() => run(s.id)} disabled={!s.steps.length}>
                  <Icon name="play" size={12} /> Run
                </button>
                <IconButton
                  icon="copy"
                  label="Duplicate"
                  onClick={() => duplicate.mutate(s.id, { onSuccess: () => toast('Scenario duplicated') })}
                />
                <IconButton
                  icon="trash"
                  label="Delete"
                  onClick={async () =>
                    (await confirm({
                      title: `Delete “${s.name}”?`,
                      message:
                        'The scenario and its schedules are deleted. Its run history stays in Test Runs.',
                    })) && remove.mutate(s.id)
                  }
                />
              </td>
            </tr>
          ))
        }
      />

      {creating && (
        <NewScenarioModal
          projectId={projectId}
          folderIndex={browser.index}
          defaultFolderId={folder?.id ?? null}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
