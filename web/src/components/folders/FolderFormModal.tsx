import { useState } from 'react';
import type { Folder, FolderKind } from '@flowqa/shared';
import { useSaveFolder } from '@/api/queries';
import { Modal } from '@/components/Modal';
import { Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { FolderSelect } from './FolderSelect';
import { descendants, folderPath, type FolderIndex } from './folderIndex';

export type FolderDialog =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: Folder }
  | { mode: 'move'; folder: Folder };

/** Buat folder, ganti nama, atau pindahkan folder ke induk lain. */
export function FolderFormModal({
  kind,
  projectId,
  index,
  dialog,
  onClose,
  onSaved,
}: {
  kind: FolderKind;
  projectId: string;
  index: FolderIndex;
  dialog: FolderDialog;
  onClose: () => void;
  onSaved?: (folder: Folder) => void;
}) {
  const save = useSaveFolder(kind, projectId);
  const toast = useToast();
  const [name, setName] = useState(dialog.mode === 'rename' ? dialog.folder.name : '');
  const [parentId, setParentId] = useState<string | null>(
    dialog.mode === 'create' ? dialog.parentId : dialog.folder.parentId,
  );

  const title =
    dialog.mode === 'create'
      ? parentId
        ? 'New subfolder'
        : 'New folder'
      : dialog.mode === 'rename'
        ? 'Rename folder'
        : `Move "${dialog.folder.name}"`;

  const submit = () => {
    const payload =
      dialog.mode === 'create'
        ? { name: name.trim(), parentId }
        : dialog.mode === 'rename'
          ? { id: dialog.folder.id, name: name.trim() }
          : { id: dialog.folder.id, parentId };
    save.mutate(payload, {
      onSuccess: (folder) => {
        toast(
          dialog.mode === 'create'
            ? 'Folder created'
            : dialog.mode === 'rename'
              ? 'Folder renamed'
              : 'Folder moved',
        );
        onSaved?.(folder);
        onClose();
      },
    });
  };

  const canSubmit = dialog.mode === 'move' ? parentId !== dialog.folder.parentId : !!name.trim();

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canSubmit || save.isPending}>
            {dialog.mode === 'create' ? 'Create folder' : dialog.mode === 'rename' ? 'Rename' : 'Move folder'}
          </button>
        </>
      }
    >
      <form
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        {dialog.mode !== 'move' && (
          <Field label="Folder name">
            <input
              className="in"
              autoFocus
              value={name}
              maxLength={80}
              placeholder="e.g. Orders"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        {dialog.mode === 'create' && (
          <Field label="Inside">
            <FolderSelect index={index} value={parentId} onChange={setParentId} rootLabel="Top level" />
          </Field>
        )}
        {dialog.mode === 'move' && (
          <Field
            label="Move into"
            hint={`Currently in: ${folderPath(index, dialog.folder.parentId) || 'Top level'}. Everything inside moves along with it.`}
          >
            <FolderSelect
              index={index}
              value={parentId}
              onChange={setParentId}
              rootLabel="Top level"
              exclude={descendants(index, dialog.folder.id)}
              autoFocus
            />
          </Field>
        )}
      </form>
    </Modal>
  );
}
