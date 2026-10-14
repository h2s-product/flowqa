/**
 * Tata letak halaman berfolder: pohon folder di kiri, breadcrumb + aksi folder,
 * bar pindah massal, kartu subfolder, dan daftar item per bagian.
 * Baris tabel dirender oleh halaman pemakai lewat `renderRows`.
 */
import { Fragment, type DragEvent, type ReactNode } from 'react';
import type { Folder } from '@flowqa/shared';
import { Icon, type IconName } from '@/components/Icon';
import { EmptyState, IconButton } from '@/components/ui';
import { FolderFormModal } from './FolderFormModal';
import { FolderSelect } from './FolderSelect';
import { ALL, UNFILED, folderChain, type FolderIndex, type FolderItem } from './folderIndex';
import type { FolderBrowserState } from './useFolderBrowser';

export function FolderBrowser<T extends FolderItem>({
  browser: b,
  allIcon,
  renderRows,
  tableHead,
  emptyProject,
  searchHint,
  onAddHere,
  bulkActions,
}: {
  browser: FolderBrowserState<T>;
  /** Ikon untuk entri "All …" di pohon. */
  allIcon: IconName;
  /** Render baris <tr> untuk item; `showFolder` = tampilkan lokasi folder (hasil pencarian). */
  renderRows: (items: T[], opts: { showFolder: boolean }) => ReactNode;
  /** Baris <thead> opsional untuk setiap tabel. */
  tableHead?: ReactNode;
  emptyProject: { title: string; body: ReactNode; action?: ReactNode };
  searchHint: string;
  /** Tombol "Add … here" saat folder kosong. */
  onAddHere?: () => void;
  /** Aksi tambahan untuk item yang dicentang (mis. "Run selected"), tampil di bar pilihan. */
  bulkActions?: (ids: string[]) => ReactNode;
}) {
  const { index, labels, query: q, selected, selectedFolder, subfolders } = b;
  const Many = labels.many[0].toUpperCase() + labels.many.slice(1);

  return (
    <div className="catalog">
      <aside className="panel folder-tree" aria-label="Folders">
        <div className="panel-h">
          <h3>Folders</h3>
          <div className="grow" />
          <IconButton
            icon="folderPlus"
            label="New folder"
            size={16}
            onClick={() => b.setDialog({ mode: 'create', parentId: null })}
          />
        </div>
        <div className="tree-body" role="tree">
          <TreeItem
            label={`All ${labels.many}`}
            icon={allIcon}
            count={b.items.length}
            active={!q && selected === ALL}
            dropping={b.dropTarget === ALL}
            onClick={() => b.select(ALL)}
            title="Drop a folder here to move it to the top level"
            {...b.dropProps(ALL, null)}
          />
          <FolderBranch parentId={null} depth={0} browser={b} />
          <TreeItem
            label="Unfiled"
            icon="minus"
            count={index.unfiledCount}
            active={!q && selected === UNFILED}
            dropping={b.dropTarget === UNFILED}
            onClick={() => b.select(UNFILED)}
            muted
            title={`${Many} that are not in any folder`}
            {...b.dropProps(UNFILED, null, false)}
          />
        </div>
        <div className="tree-hint small muted">Drag {labels.many} or folders onto a folder to move them.</div>
      </aside>

      <section className="catalog-main">
        <div className="panel catalog-head">
          <div className="crumbs">
            {q ? (
              <span>
                {b.results.length} result{b.results.length === 1 ? '' : 's'} for “{b.search.trim()}”
              </span>
            ) : (
              <>
                <button className="link" onClick={() => b.select(ALL)}>
                  All {labels.many}
                </button>
                {selected === UNFILED && (
                  <>
                    <span className="sep">/</span>
                    <b>Unfiled</b>
                  </>
                )}
                {folderChain(index, selectedFolder?.id).map((f, i, chain) => (
                  <Fragment key={f.id}>
                    <span className="sep">/</span>
                    {i === chain.length - 1 ? (
                      <b>{f.name}</b>
                    ) : (
                      <button className="link" onClick={() => b.select(f.id)}>
                        {f.name}
                      </button>
                    )}
                  </Fragment>
                ))}
              </>
            )}
          </div>
          <div className="grow" />
          {selectedFolder && !q && (
            <div className="row" style={{ gap: 4 }}>
              <button
                className="btn sm ghost"
                onClick={() => b.setDialog({ mode: 'create', parentId: selectedFolder.id })}
              >
                <Icon name="folderPlus" size={13} /> Subfolder
              </button>
              <button
                className="btn sm ghost"
                onClick={() => b.setDialog({ mode: 'rename', folder: selectedFolder })}
              >
                Rename
              </button>
              <button
                className="btn sm ghost"
                onClick={() => b.setDialog({ mode: 'move', folder: selectedFolder })}
              >
                Move
              </button>
              <IconButton icon="trash" label="Delete folder" onClick={() => b.removeFolder(selectedFolder)} />
            </div>
          )}
        </div>

        {b.checked.size > 0 && (
          <div className="bulk-bar">
            <b>{b.checked.size} selected</b>
            <span className="muted">Move to</span>
            <div style={{ minWidth: 200 }}>
              <FolderSelect index={index} value={b.bulkTarget} onChange={b.setBulkTarget} />
            </div>
            <button
              className="btn sm primary"
              disabled={b.moving}
              onClick={() => b.move([...b.checked], b.bulkTarget)}
            >
              Move
            </button>
            {bulkActions?.([...b.checked])}
            <div className="grow" />
            <button className="btn sm ghost" onClick={() => b.setChecked(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        <div className="panel">
          {subfolders.length > 0 && !q && (
            <div className="subfolders">
              {subfolders.map((f) => (
                <button
                  key={f.id}
                  className={`subfolder ${b.dropTarget === `sub:${f.id}` ? 'drop' : ''}`}
                  onClick={() => b.select(f.id)}
                  draggable
                  onDragStart={(e) => b.dragFolder(e, f)}
                  {...b.dropProps(`sub:${f.id}`, f.id)}
                >
                  <Icon name="folder" size={16} />
                  <span className="grow">{f.name}</span>
                  <span className="small muted">{index.totalCount.get(f.id) ?? 0}</span>
                </button>
              ))}
            </div>
          )}

          {b.visibleIds.length > 0 ? (
            <>
              <div className="catalog-cols small muted">
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={b.allChecked}
                    onChange={(e) => b.setChecked(e.target.checked ? new Set(b.visibleIds) : new Set())}
                    aria-label={`Select all ${labels.many} shown`}
                  />
                  {b.allChecked ? 'Clear all' : 'Select all'}
                </label>
              </div>
              {b.sections.map((section) => (
                <div key={section.key}>
                  {section.title && (
                    <button
                      className="group-h link"
                      onClick={() => section.folderId && b.select(section.folderId)}
                    >
                      {section.title} <span style={{ fontWeight: 400 }}>({section.items.length})</span>
                    </button>
                  )}
                  <div className="tbl-wrap">
                    <table className="t">
                      {tableHead}
                      <tbody>{renderRows(section.items, { showFolder: !!q })}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          ) : b.items.length === 0 && !q ? (
            <EmptyState title={emptyProject.title} action={emptyProject.action}>
              {emptyProject.body}
            </EmptyState>
          ) : (
            <EmptyState
              title={
                q
                  ? `No ${labels.many} match this search`
                  : selectedFolder
                    ? subfolders.length
                      ? `No ${labels.many} directly in this folder`
                      : 'This folder is empty'
                    : 'Nothing here'
              }
              action={
                !q && selectedFolder && onAddHere ? (
                  <button className="btn" onClick={onAddHere}>
                    <Icon name="plus" size={14} /> Add {labels.one} here
                  </button>
                ) : undefined
              }
            >
              {q
                ? searchHint
                : selectedFolder
                  ? `Drag ${labels.many} here from another folder, or add a new one.`
                  : undefined}
            </EmptyState>
          )}
        </div>
      </section>

      {b.dialog && (
        <FolderFormModal
          kind={b.kind}
          projectId={b.projectId}
          index={index}
          dialog={b.dialog}
          onClose={() => b.setDialog(null)}
          onSaved={(folder) => b.dialog?.mode === 'create' && b.select(folder.id, folder.parentId)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function FolderBranch<T extends FolderItem>({
  parentId,
  depth,
  browser: b,
}: {
  parentId: string | null;
  depth: number;
  browser: FolderBrowserState<T>;
}) {
  const index: FolderIndex = b.index;
  return (
    <>
      {(index.children.get(parentId) ?? []).map((f: Folder) => {
        const hasChildren = (index.children.get(f.id)?.length ?? 0) > 0;
        const open = b.expanded.has(f.id);
        return (
          <div key={f.id} role="treeitem" aria-expanded={hasChildren ? open : undefined}>
            <TreeItem
              label={f.name}
              icon="folder"
              count={index.totalCount.get(f.id) ?? 0}
              depth={depth}
              active={!b.query && b.selected === f.id}
              dropping={b.dropTarget === f.id}
              expandable={hasChildren}
              open={open}
              onToggle={() => b.toggleExpand(f.id)}
              onClick={() => b.select(f.id)}
              draggable
              onDragStart={(e) => b.dragFolder(e, f)}
              {...b.dropProps(f.id, f.id)}
            />
            {hasChildren && open && <FolderBranch parentId={f.id} depth={depth + 1} browser={b} />}
          </div>
        );
      })}
    </>
  );
}

function TreeItem({
  label,
  icon,
  count,
  depth = 0,
  active,
  dropping,
  expandable,
  open,
  muted,
  title,
  onToggle,
  onClick,
  draggable,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  icon: IconName;
  count: number;
  depth?: number;
  active: boolean;
  dropping: boolean;
  expandable?: boolean;
  open?: boolean;
  muted?: boolean;
  title?: string;
  onToggle?: () => void;
  onClick: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
}) {
  return (
    <div
      className={`tree-item ${active ? 'on' : ''} ${dropping ? 'drop' : ''} ${muted ? 'muted' : ''}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={title}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        className={`tree-caret ${open ? 'open' : ''}`}
        onClick={onToggle}
        tabIndex={expandable ? 0 : -1}
        aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
        style={{ visibility: expandable ? 'visible' : 'hidden' }}
      >
        <Icon name="down" size={12} />
      </button>
      <button className="tree-label" onClick={onClick}>
        <Icon name={icon} size={15} />
        <span className="grow">{label}</span>
        <span className="tree-count">{count}</span>
      </button>
    </div>
  );
}
