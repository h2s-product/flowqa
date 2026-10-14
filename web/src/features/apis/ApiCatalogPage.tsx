import { useState } from 'react';
import type { ApiDefinition } from '@flowqa/shared';
import { useApis, useScenarios } from '@/api/queries';
import { FolderBrowser } from '@/components/folders/FolderBrowser';
import { useFolderBrowser } from '@/components/folders/useFolderBrowser';
import { Icon } from '@/components/Icon';
import { ErrorBox, Loading, MethodBadge, SearchInput, SelectCell } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ApiFormModal } from './ApiFormModal';
import { ImportApisModal } from './ImportApisModal';
import { DateTime } from '@/components/DateTime';

const LABELS = { one: 'API', many: 'APIs' };

export function ApiCatalogPage() {
  const { projectId = '' } = useWorkspace();
  const { data: apis = [], isLoading, error } = useApis(projectId);
  const { data: scenarios = [] } = useScenarios(projectId);
  const [editing, setEditing] = useState<ApiDefinition | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const browser = useFolderBrowser({
    kind: 'api',
    projectId,
    items: apis,
    labels: LABELS,
    matches: (a, q) => `${a.name} ${a.path} ${a.method}`.toLowerCase().includes(q),
  });

  if (isLoading || browser.loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const usage = (id: string) =>
    scenarios.filter((s) => s.steps.some((st) => st.type === 'api' && st.apiId === id)).length;

  return (
    <>
      <div className="row wrap toolbar">
        <SearchInput
          value={browser.search}
          onChange={browser.setSearch}
          placeholder="Search all APIs by name or path"
        />
        <div className="grow" />
        <button className="btn" onClick={() => setImporting(true)}>
          Import OpenAPI / Swagger
        </button>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> Add API
        </button>
      </div>

      <FolderBrowser
        browser={browser}
        allIcon="code"
        searchHint="Try another name or path."
        onAddHere={() => setEditing('new')}
        emptyProject={{
          title: 'No APIs in this project yet',
          body: 'Import an OpenAPI or Swagger file to add many at once, or add one manually.',
        }}
        renderRows={(items, { showFolder }) =>
          items.map((a) => {
            const used = usage(a.id);
            return (
              <tr
                key={a.id}
                className={`click ${browser.checked.has(a.id) ? 'selected' : ''}`}
                onClick={() => setEditing(a)}
                draggable
                onDragStart={(e) => browser.dragItem(e, a)}
              >
                <SelectCell
                  checked={browser.checked.has(a.id)}
                  onChange={() => browser.toggleCheck(a.id)}
                  label={`Select ${a.name}`}
                />
                <td style={{ width: 80 }}>
                  <MethodBadge method={a.method} />
                </td>
                <td style={{ minWidth: 180 }}>
                  <b>{a.name}</b>
                  <div className="small muted">
                    {showFolder ? (
                      <>
                        <Icon name="folder" size={11} /> {browser.folderLabel(a)}
                      </>
                    ) : (
                      a.description
                    )}
                  </div>
                </td>
                <td className="code small">{a.path}</td>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                  {a.auth === 'bearer' ? (
                    <>
                      <Icon name="lock" size={13} /> Needs login
                    </>
                  ) : (
                    'No login'
                  )}
                </td>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                  {used ? `Used in ${used} scenario${used > 1 ? 's' : ''}` : 'Not used yet'}
                </td>
                <td className="small" title="Last updated">
                  <DateTime value={a.updatedAt} />
                </td>
              </tr>
            );
          })
        }
      />

      {editing && (
        <ApiFormModal
          api={editing === 'new' ? undefined : editing}
          defaultFolderId={browser.selectedFolder?.id ?? null}
          folderIndex={browser.index}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && projectId && (
        <ImportApisModal
          projectId={projectId}
          defaultFolderId={browser.selectedFolder?.id ?? null}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
