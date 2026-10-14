/**
 * State & aksi untuk halaman yang isinya dikelompokkan dalam folder
 * (API Catalog, Test Scenarios): folder terpilih, pohon terbuka, centang,
 * drag & drop, pindah massal, dan hapus folder.
 */
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { Folder, FolderKind } from '@flowqa/shared';
import { useDeleteFolder, useFolders, useMoveToFolder, useSaveFolder } from '@/api/queries';
import { useToast } from '@/context/ToastContext';
import type { FolderDialog } from './FolderFormModal';
import { ALL, UNFILED, folderChain, folderPath, indexFolders, type FolderItem } from './folderIndex';
import { useConfirm } from '@/context/ConfirmContext';

const DRAG_ITEMS = 'application/x-flowqa-items';
const DRAG_FOLDER = 'application/x-flowqa-folder';

interface ViewState {
  selected: string;
  expanded: string[];
}

export interface ItemLabels {
  /** Tunggal, mis. "API" / "scenario". */
  one: string;
  /** Jamak, mis. "APIs" / "scenarios". */
  many: string;
}

export interface FolderSection<T> {
  key: string;
  /** Kosong = tanpa judul (tampilan satu folder atau hasil pencarian). */
  title: string;
  folderId: string | null;
  items: T[];
}

const storageKey = (kind: FolderKind) => `flowqa.folders.${kind}`;

function readView(kind: FolderKind, projectId: string): ViewState {
  try {
    const all = JSON.parse(localStorage.getItem(storageKey(kind)) ?? '{}');
    return { selected: ALL, expanded: [], ...all[projectId] };
  } catch {
    return { selected: ALL, expanded: [] };
  }
}

function writeView(kind: FolderKind, projectId: string, view: ViewState) {
  try {
    const all = JSON.parse(localStorage.getItem(storageKey(kind)) ?? '{}');
    localStorage.setItem(storageKey(kind), JSON.stringify({ ...all, [projectId]: view }));
  } catch {
    /* storage tidak tersedia */
  }
}

export function useFolderBrowser<T extends FolderItem>({
  kind,
  projectId,
  items,
  labels,
  matches,
}: {
  kind: FolderKind;
  projectId: string;
  items: T[];
  labels: ItemLabels;
  /** Apakah item cocok dengan kata kunci pencarian (sudah lowercase). */
  matches: (item: T, query: string) => boolean;
}) {
  const { data: folders = [], isLoading } = useFolders(kind, projectId);
  const moveItems = useMoveToFolder(kind, projectId);
  const saveFolder = useSaveFolder(kind, projectId);
  const deleteFolder = useDeleteFolder(kind, projectId);
  const confirm = useConfirm();
  const toast = useToast();

  const [view, setView] = useState<ViewState>(() => readView(kind, projectId));
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FolderDialog | null>(null);

  useEffect(() => setView(readView(kind, projectId)), [kind, projectId]);
  useEffect(() => writeView(kind, projectId, view), [kind, projectId, view]);
  useEffect(() => setChecked(new Set()), [projectId, view.selected, search]);

  const index = useMemo(() => indexFolders(folders, items), [folders, items]);
  // Folder terpilih sudah dihapus → kembali ke "All".
  const selected =
    view.selected === ALL || view.selected === UNFILED || index.byId.has(view.selected) ? view.selected : ALL;
  const selectedFolder = index.byId.get(selected);
  const expanded = useMemo(() => new Set(view.expanded), [view.expanded]);

  /** `parentId` diisi untuk folder yang baru dibuat (belum ada di index). */
  const select = (id: string, parentId?: string | null) => {
    setSearch('');
    // Buka semua induk supaya folder terpilih terlihat di pohon.
    const parents = folderChain(index, parentId ?? index.byId.get(id)?.parentId).map((f) => f.id);
    setView((v) => ({ selected: id, expanded: [...new Set([...v.expanded, ...parents])] }));
  };
  const toggleExpand = (id: string) =>
    setView((v) => ({
      ...v,
      expanded: v.expanded.includes(id) ? v.expanded.filter((x) => x !== id) : [...v.expanded, id],
    }));

  const inFolder = (item: T, folderId: string | null) =>
    folderId ? item.folderId === folderId : !item.folderId || !index.byId.has(item.folderId);
  const count = (n: number) => `${n} ${n === 1 ? labels.one : labels.many}`;

  /* ------------------------------- actions ------------------------------- */

  const move = (ids: string[], folderId: string | null) =>
    moveItems.mutate(
      { ids, folderId },
      {
        onSuccess: ({ moved }) => {
          setChecked(new Set());
          toast(
            moved
              ? `Moved ${count(moved)} to ${folderPath(index, folderId) || 'Unfiled'}`
              : 'Already in that folder',
          );
        },
      },
    );

  const moveFolder = (folder: Folder, parentId: string | null) =>
    folder.parentId !== parentId &&
    saveFolder.mutate(
      { id: folder.id, parentId },
      {
        onSuccess: () => toast(`Moved "${folder.name}" to ${folderPath(index, parentId) || 'top level'}`),
      },
    );

  const removeFolder = async (folder: Folder) => {
    const total = index.totalCount.get(folder.id) ?? 0;
    const where = folderPath(index, folder.parentId) || 'Unfiled / top level';
    if (
      !(await confirm({
        title: `Delete the folder “${folder.name}”?`,
        message: `No ${labels.many} are deleted. ${total ? `Its ${count(total)} and subfolders` : 'Its subfolders'} move to: ${where}.`,
      }))
    )
      return;
    deleteFolder.mutate(folder.id, {
      onSuccess: () => {
        toast('Folder deleted');
        if (selected === folder.id) select(folder.parentId ?? ALL);
      },
    });
  };

  /* ---------------------------- drag and drop ---------------------------- */

  /** Seret satu item; bila item itu dicentang, semua item tercentang ikut. */
  const dragItem = (e: DragEvent, item: T) => {
    const ids = checked.has(item.id) ? [...checked] : [item.id];
    e.dataTransfer.setData(DRAG_ITEMS, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };
  const dragFolder = (e: DragEvent, folder: Folder) => {
    e.stopPropagation();
    e.dataTransfer.setData(DRAG_FOLDER, folder.id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const dropProps = (targetKey: string, folderId: string | null, acceptsFolders = true) => ({
    onDragOver: (e: DragEvent) => {
      const types = e.dataTransfer.types;
      if (types.includes(DRAG_ITEMS) || (acceptsFolders && types.includes(DRAG_FOLDER))) {
        e.preventDefault();
        setDropTarget(targetKey);
      }
    },
    onDragLeave: () => setDropTarget((t) => (t === targetKey ? null : t)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const ids = e.dataTransfer.getData(DRAG_ITEMS);
      const draggedFolder = e.dataTransfer.getData(DRAG_FOLDER);
      if (ids) move(JSON.parse(ids), folderId);
      else if (draggedFolder && acceptsFolders) {
        const folder = index.byId.get(draggedFolder);
        if (folder && folder.id !== folderId) moveFolder(folder, folderId);
      }
    },
  });

  /* -------------------------------- lists -------------------------------- */

  const q = search.trim().toLowerCase();
  const results = q ? items.filter((i) => matches(i, q)) : [];
  const subfolders = selectedFolder ? (index.children.get(selectedFolder.id) ?? []) : [];
  const sections: FolderSection<T>[] = q
    ? [{ key: 'search', title: '', folderId: null, items: results }]
    : selected === ALL
      ? [
          ...folders
            .map((f) => ({
              key: f.id,
              title: folderPath(index, f.id),
              folderId: f.id as string | null,
              items: items.filter((i) => i.folderId === f.id),
            }))
            .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
          { key: UNFILED, title: 'Unfiled', folderId: null, items: items.filter((i) => inFolder(i, null)) },
        ].filter((s) => s.items.length)
      : [
          {
            key: selected,
            title: '',
            folderId: selectedFolder?.id ?? null,
            items: items.filter((i) => inFolder(i, selectedFolder?.id ?? null)),
          },
        ];
  const visibleIds = sections.flatMap((s) => s.items.map((i) => i.id));
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.has(id));
  const toggleCheck = (id: string) =>
    setChecked((c) => new Set(c.has(id) ? [...c].filter((x) => x !== id) : [...c, id]));

  return {
    kind,
    projectId,
    labels,
    loading: isLoading,
    items,
    folders,
    index,
    selected,
    selectedFolder,
    expanded,
    select,
    toggleExpand,
    search,
    setSearch,
    query: q,
    results,
    subfolders,
    sections,
    visibleIds,
    checked,
    setChecked,
    toggleCheck,
    allChecked,
    bulkTarget,
    setBulkTarget,
    moving: moveItems.isPending,
    move,
    removeFolder,
    dropTarget,
    dropProps,
    dragItem,
    dragFolder,
    dialog,
    setDialog,
    /** Lokasi folder item, untuk ditampilkan di hasil pencarian. */
    folderLabel: (item: T) => folderPath(index, item.folderId) || 'Unfiled',
  };
}

export type FolderBrowserState<T extends FolderItem> = ReturnType<typeof useFolderBrowser<T>>;
