import { useState } from 'react';
import type { ApiDefinition, HttpMethod } from '@flowqa/shared';
import { HTTP_METHODS, pathParameters } from '@flowqa/shared';
import { useDeleteApi, useSaveApi } from '@/api/queries';
import { BodyFieldEditor } from '@/components/BodyFieldEditor';
import { Icon } from '@/components/Icon';
import { KeyValueEditor } from '@/components/KeyValueEditor';
import { Modal } from '@/components/Modal';
import { Field, Segmented } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { FolderSelect } from '@/components/folders/FolderSelect';
import type { FolderIndex } from '@/components/folders/folderIndex';
import { DateTime } from '@/components/DateTime';
import { bodyToJson, jsonToBody } from '@/lib/bodyJson';
import { useConfirm } from '@/context/ConfirmContext';

const EMPTY: Partial<ApiDefinition> = {
  name: '',
  description: '',
  folderId: null,
  method: 'GET',
  path: '/',
  auth: 'bearer',
  contentType: 'application/json',
  headers: [],
  query: [],
  body: [],
  exampleResponse: {},
};

export function ApiFormModal({
  api,
  folderIndex,
  defaultFolderId = null,
  onClose,
}: {
  api?: ApiDefinition;
  folderIndex: FolderIndex;
  /** Folder awal untuk API baru (folder yang sedang dibuka). */
  defaultFolderId?: string | null;
  onClose: () => void;
}) {
  const { projectId = '', environment } = useWorkspace();
  const [draft, setDraft] = useState<Partial<ApiDefinition>>(
    api ? structuredClone(api) : { ...EMPTY, folderId: defaultFolderId },
  );
  const [bodyMode, setBodyMode] = useState<'visual' | 'json'>('visual');
  const [bodyJson, setBodyJson] = useState('');
  const [exampleText, setExampleText] = useState(JSON.stringify(api?.exampleResponse ?? {}, null, 2));
  const save = useSaveApi(projectId);
  const remove = useDeleteApi(projectId);
  const confirm = useConfirm();
  const toast = useToast();

  const set = (patch: Partial<ApiDefinition>) => setDraft((d) => ({ ...d, ...patch }));
  const params = pathParameters(draft.path ?? '');
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(draft.method ?? 'GET');

  const switchBody = (mode: 'visual' | 'json') => {
    try {
      if (mode === 'json') setBodyJson(bodyToJson(draft.body ?? []));
      else set({ body: jsonToBody(bodyJson) });
      setBodyMode(mode);
    } catch {
      toast('The JSON has an error, so it can’t be shown in the visual builder yet.');
    }
  };

  const submit = () => {
    let body = draft.body;
    let exampleResponse: unknown;
    try {
      if (bodyMode === 'json') body = jsonToBody(bodyJson);
    } catch {
      return toast('The request body JSON has an error.');
    }
    try {
      exampleResponse = exampleText.trim() ? JSON.parse(exampleText) : {};
    } catch {
      return toast('The example response is not valid JSON.');
    }
    save.mutate(
      { ...draft, body, exampleResponse },
      {
        onSuccess: () => (toast(api ? 'API saved' : 'API added'), onClose()),
      },
    );
  };

  const deleteApi = async () => {
    if (
      !api ||
      !(await confirm({
        title: `Delete “${api.name}”?`,
        message: 'Scenario steps that call this API will stop working until you pick another API.',
      }))
    )
      return;
    remove.mutate(api.id, { onSuccess: onClose });
  };

  return (
    <Modal
      wide
      title={api ? 'Edit API' : 'Add API'}
      subtitle="Describe one endpoint. Scenarios reuse it as a step."
      onClose={onClose}
      footer={
        <>
          {api && (
            <button className="btn ghost danger" onClick={deleteApi}>
              <Icon name="trash" size={14} /> Delete API
            </button>
          )}
          <span className="small muted" style={{ marginRight: 'auto' }}>
            {api && (
              <>
                Created <DateTime value={api.createdAt} /> · Updated <DateTime value={api.updatedAt} />
              </>
            )}
          </span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending}>
            {api ? 'Save changes' : 'Add API'}
          </button>
        </>
      }
    >
      <div className="grid">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="API name">
            <input
              className="in"
              autoFocus
              value={draft.name}
              placeholder="Create Customer"
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Folder">
            <FolderSelect
              index={folderIndex}
              value={draft.folderId ?? null}
              onChange={(folderId) => set({ folderId })}
            />
          </Field>
        </div>
        <Field label="Description">
          <input
            className="in"
            value={draft.description}
            placeholder="What does this API do?"
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <div className="field">
          <span>Method and endpoint</span>
          <div className="row">
            <select
              className="in"
              style={{ width: 120 }}
              value={draft.method}
              onChange={(e) => set({ method: e.target.value as HttpMethod })}
            >
              {HTTP_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <span className="code muted small" style={{ whiteSpace: 'nowrap' }}>
              {environment?.baseUrl}
            </span>
            <input
              className="in code"
              value={draft.path}
              placeholder="/api/customers/{customer_id}"
              onChange={(e) => set({ path: e.target.value })}
            />
          </div>
          <em>
            Put changing parts in braces, like {'{order_id}'}.{' '}
            {params.length > 0 && (
              <>
                Detected:{' '}
                {params.map((p) => (
                  <span key={p} className="chip var-in" style={{ marginRight: 4 }}>
                    {p}
                  </span>
                ))}
              </>
            )}
          </em>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Authentication">
            <select
              className="in"
              value={draft.auth}
              onChange={(e) => set({ auth: e.target.value as ApiDefinition['auth'] })}
            >
              <option value="bearer">Needs login (Bearer token)</option>
              <option value="none">No login needed</option>
            </select>
          </Field>
          <Field label="Content type">
            <select
              className="in"
              value={draft.contentType}
              onChange={(e) => set({ contentType: e.target.value })}
            >
              <option>application/json</option>
              <option>application/x-www-form-urlencoded</option>
            </select>
          </Field>
        </div>

        {hasBody && (
          <div className="field">
            <div className="row">
              <span className="grow" style={{ fontSize: 12.5, fontWeight: 550, color: 'var(--ink2)' }}>
                Request body (default values)
              </span>
              <Segmented
                options={[
                  { id: 'visual', label: 'Visual builder' },
                  { id: 'json', label: 'Advanced JSON' },
                ]}
                value={bodyMode}
                onChange={switchBody}
              />
            </div>
            {bodyMode === 'json' ? (
              <textarea
                className="in"
                rows={8}
                value={bodyJson}
                onChange={(e) => setBodyJson(e.target.value)}
              />
            ) : (
              <BodyFieldEditor rows={draft.body ?? []} onChange={(body) => set({ body })} />
            )}
          </div>
        )}

        <details className="adv">
          <summary>Advanced settings: headers, query parameters, example response</summary>
          <div className="grid">
            <div>
              <div className="small" style={{ fontWeight: 550, marginBottom: 4 }}>
                Headers
              </div>
              <KeyValueEditor
                rows={draft.headers ?? []}
                onChange={(headers) => set({ headers })}
                keyPlaceholder="Header-Name"
                addLabel="Add header"
              />
            </div>
            <div>
              <div className="small" style={{ fontWeight: 550, marginBottom: 4 }}>
                Query parameters
              </div>
              <KeyValueEditor
                rows={draft.query ?? []}
                onChange={(query) => set({ query })}
                addLabel="Add parameter"
              />
            </div>
            <Field
              label="Example response (JSON)"
              hint="Used to pick values to capture before the first run."
            >
              <textarea
                className="in"
                rows={7}
                value={exampleText}
                onChange={(e) => setExampleText(e.target.value)}
              />
            </Field>
          </div>
        </details>
      </div>
    </Modal>
  );
}
