import { useMemo, useState, type DragEvent } from 'react';
import type { ImportPreview } from '@flowqa/shared';
import { useApis, useFolders, useImportApis, usePreviewImport } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { MethodBadge } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { errorMessage } from '@/lib/format';
import { FolderSelect } from '@/components/folders/FolderSelect';
import { indexFolders } from '@/components/folders/folderIndex';

/** Impor OpenAPI/Swagger dua langkah: pratinjau → pilih → simpan. */
export function ImportApisModal({
  projectId,
  defaultFolderId = null,
  onClose,
}: {
  projectId: string;
  defaultFolderId?: string | null;
  onClose: () => void;
}) {
  const preview = usePreviewImport(projectId);
  const { data: folders = [] } = useFolders('api', projectId);
  const { data: apis = [] } = useApis(projectId);
  const folderIndex = useMemo(() => indexFolders(folders, apis), [folders, apis]);
  const importApis = useImportApis(projectId);
  const toast = useToast();
  const [result, setResult] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState<string | null>(defaultFolderId);
  const [folderPerTag, setFolderPerTag] = useState(true);

  const load = (content: string, name: string) =>
    preview.mutate(content, {
      onSuccess: (data) => {
        setResult(data);
        setFileName(name);
        setSelected(new Set(data.apis.map((_, i) => i)));
      },
    });

  const readFile = (file?: File) => {
    if (!file) return;
    file.text().then((text) => load(text, file.name));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    readFile(e.dataTransfer.files[0]);
  };

  const toggle = (i: number) =>
    setSelected((s) => new Set(s.has(i) ? [...s].filter((x) => x !== i) : [...s, i]));

  const submit = () =>
    result &&
    importApis.mutate(
      { apis: result.apis.filter((_, i) => selected.has(i)), targetFolderId, folderPerTag },
      {
        onSuccess: ({ created, updated }) => {
          toast(
            `${created} API${created === 1 ? '' : 's'} imported successfully${updated ? `, ${updated} updated` : ''}.`,
          );
          onClose();
        },
      },
    );

  return (
    <Modal
      wide
      title="Import OpenAPI / Swagger"
      subtitle="JSON or YAML, OpenAPI 3 or Swagger 2."
      onClose={onClose}
      footer={
        <>
          {result && (
            <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => setResult(null)}>
              Choose another file
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {result && (
            <button
              className="btn primary"
              onClick={submit}
              disabled={!selected.size || importApis.isPending}
            >
              Import {selected.size} API{selected.size === 1 ? '' : 's'}
            </button>
          )}
        </>
      }
    >
      {!result ? (
        <>
          <label
            className={`drop ${dragging ? 'over' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setDragging(true))}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <Icon name="upload" size={22} />
            <div style={{ fontWeight: 600, marginTop: 8 }}>
              {preview.isPending ? 'Reading file…' : 'Drop a file here or choose one'}
            </div>
            <div className="small muted">.json, .yaml or .yml</div>
            <input
              type="file"
              accept=".json,.yaml,.yml"
              style={{ display: 'none' }}
              onChange={(e) => {
                readFile(e.target.files?.[0]);
                // Reset agar memilih file yang sama lagi tetap memicu onChange.
                e.target.value = '';
              }}
            />
          </label>
          <details className="adv" style={{ marginTop: 16 }}>
            <summary>Paste the spec instead</summary>
            <textarea
              className="in"
              rows={8}
              value={pasted}
              placeholder="openapi: 3.0.0 …"
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              className="btn sm"
              style={{ marginTop: 8 }}
              onClick={() => load(pasted, 'pasted spec')}
              disabled={!pasted.trim()}
            >
              Read spec
            </button>
          </details>
          {preview.error && (
            <div className="explain" style={{ marginTop: 14 }}>
              <b>Can’t read this file</b>
              {errorMessage(preview.error)}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="banner" style={{ marginBottom: 12 }}>
            <div>
              <b>{result.title}</b> {result.version} · {result.apis.length} endpoints found in {fileName}.
              Choose which to add to the catalog.
            </div>
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12, marginBottom: 12 }}
          >
            <label className="field">
              <span>Save into folder</span>
              <FolderSelect
                index={folderIndex}
                value={targetFolderId}
                onChange={setTargetFolderId}
                rootLabel="Top level"
              />
            </label>
            <label className="row small" style={{ alignSelf: 'end', paddingBottom: 9 }}>
              <input
                type="checkbox"
                checked={folderPerTag}
                onChange={(e) => setFolderPerTag(e.target.checked)}
              />
              Create a subfolder for each OpenAPI tag
            </label>
          </div>
          <div className="row" style={{ marginBottom: 8 }}>
            <label className="row small">
              <input
                type="checkbox"
                checked={selected.size === result.apis.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(result.apis.map((_, i) => i)) : new Set())
                }
              />{' '}
              Select all
            </label>
            <div className="grow" />
            <span className="small muted">{selected.size} selected</span>
          </div>
          <div className="panel" style={{ maxHeight: 380, overflow: 'auto' }}>
            <table className="t">
              <tbody>
                {result.apis.map((a, i) => (
                  <tr key={`${a.method}${a.path}`} className="click" onClick={() => toggle(i)}>
                    <td style={{ width: 30 }}>
                      <input
                        type="checkbox"
                        readOnly
                        checked={selected.has(i)}
                        style={{ pointerEvents: 'none' }}
                      />
                    </td>
                    <td style={{ width: 80 }}>
                      <MethodBadge method={a.method} />
                    </td>
                    <td>
                      <b>{a.name}</b>
                    </td>
                    <td className="code small">{a.path}</td>
                    <td className="small muted">
                      {folderPerTag && a.tag ? (
                        <>
                          <Icon name="folder" size={11} /> {a.tag}
                        </>
                      ) : null}
                    </td>
                    <td className="small muted">{a.body.length ? `${a.body.length} body fields` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
