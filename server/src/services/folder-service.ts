/**
 * Pohon folder per project (bersarang sampai FOLDER_MAX_DEPTH), dipakai oleh
 * API Catalog dan Test Scenarios. Menghapus folder tidak pernah menghapus isinya —
 * item & subfolder naik ke folder induk.
 */
import type { ApiDefinition, Folder } from '@flowqa/shared';
import { FOLDER_MAX_DEPTH, createId } from '@flowqa/shared';
import { HttpError, notFound } from '../lib/http';
import { nowIso } from '../lib/time';
import type { DocumentRepository } from '../repositories/document-repository';

const MAX_NAME_LENGTH = 80;

/** Item yang bisa dimasukkan ke folder (API, scenario). */
export interface FolderItem {
  id: string;
  projectId: string;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Kedalaman folder (folder level teratas = 1). */
export function folderDepth(folders: Folder[], id: string | null): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let depth = 0;
  for (let cur = id ? byId.get(id) : undefined; cur && depth <= folders.length; depth++)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  return depth;
}

/** Semua id turunan `id` (tidak termasuk dirinya). */
export function descendantIds(folders: Folder[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parent: string) =>
    folders
      .filter((f) => f.parentId === parent && !out.has(f.id))
      .forEach((f) => (out.add(f.id), walk(f.id)));
  walk(id);
  return out;
}

/** Tinggi subtree yang berakar di `id` (folder tanpa anak = 1). */
function subtreeHeight(folders: Folder[], id: string): number {
  const children = folders.filter((f) => f.parentId === id);
  return 1 + Math.max(0, ...children.map((c) => subtreeHeight(folders, c.id)));
}

export class FolderService<T extends FolderItem> {
  constructor(
    private readonly folders: DocumentRepository<Folder>,
    private readonly items: DocumentRepository<T>,
    /** Nama item untuk pesan error, mis. "API" atau "scenario". */
    private readonly itemLabel: string,
  ) {}

  list(projectId: string): Folder[] {
    return this.folders
      .list({ project_id: projectId })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  /** Pastikan folder ada di project ini (null = level teratas selalu valid). */
  assertFolder(projectId: string, folderId: string | null | undefined): string | null {
    if (!folderId) return null;
    const folder = this.folders.get(folderId);
    if (!folder || folder.projectId !== projectId) throw new HttpError(400, 'That folder does not exist');
    return folder.id;
  }

  create(projectId: string, input: { name?: unknown; parentId?: unknown }): Folder {
    const parentId = this.assertFolder(projectId, input.parentId as string | null);
    const folders = this.list(projectId);
    if (folderDepth(folders, parentId) + 1 > FOLDER_MAX_DEPTH)
      throw new HttpError(400, `Folders can be nested at most ${FOLDER_MAX_DEPTH} levels deep`);
    const name = this.validName(folders, input.name, parentId);
    const now = nowIso();
    return this.folders.save({
      id: createId('fld'),
      projectId,
      name,
      parentId,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Ganti nama dan/atau pindahkan folder. */
  update(folder: Folder, input: { name?: unknown; parentId?: unknown }): Folder {
    const folders = this.list(folder.projectId);
    const parentId =
      input.parentId === undefined
        ? folder.parentId
        : this.assertFolder(folder.projectId, input.parentId as string | null);
    if (parentId !== folder.parentId) {
      if (parentId === folder.id || (parentId && descendantIds(folders, folder.id).has(parentId)))
        throw new HttpError(400, 'A folder cannot be moved into itself or one of its subfolders');
      if (folderDepth(folders, parentId) + subtreeHeight(folders, folder.id) > FOLDER_MAX_DEPTH)
        throw new HttpError(400, `Folders can be nested at most ${FOLDER_MAX_DEPTH} levels deep`);
    }
    const name =
      input.name === undefined && parentId === folder.parentId
        ? folder.name
        : this.validName(folders, input.name ?? folder.name, parentId, folder.id);
    return this.folders.save({ ...folder, name, parentId, updatedAt: nowIso() });
  }

  /** Hapus folder; subfolder & item di dalamnya dipindah ke folder induk. */
  delete(folder: Folder): { movedItems: number; movedFolders: number } {
    const now = nowIso();
    const folders = this.list(folder.projectId);
    const siblings = folders.filter((f) => f.parentId === folder.parentId && f.id !== folder.id);
    const children = folders.filter((f) => f.parentId === folder.id);
    for (const child of children) {
      // Hindari nama kembar di folder induk: tambahkan akhiran bila perlu.
      let name = child.name;
      for (let n = 2; siblings.some((s) => same(s.name, name)); n++) name = `${child.name} (${n})`;
      siblings.push({ ...child, name });
      this.folders.save({ ...child, name, parentId: folder.parentId, updatedAt: now });
    }
    const items = this.items.list({ project_id: folder.projectId }).filter((i) => i.folderId === folder.id);
    items.forEach((i) => this.items.save({ ...i, folderId: folder.parentId, updatedAt: now }));
    this.folders.delete(folder.id);
    return { movedItems: items.length, movedFolders: children.length };
  }

  /** Pindahkan beberapa item sekaligus ke satu folder (null = Unfiled). */
  moveItems(projectId: string, itemIds: unknown, folderIdInput: unknown): number {
    const folderId = this.assertFolder(projectId, folderIdInput as string | null);
    if (!Array.isArray(itemIds) || !itemIds.length)
      throw new HttpError(400, `Choose at least one ${this.itemLabel} to move`);
    const now = nowIso();
    let moved = 0;
    for (const id of new Set(itemIds)) {
      const item = typeof id === 'string' ? this.items.get(id) : undefined;
      if (!item || item.projectId !== projectId) throw notFound(this.itemLabel);
      if ((item.folderId ?? null) === folderId) continue;
      this.items.save({ ...item, folderId, updatedAt: now });
      moved++;
    }
    return moved;
  }

  /** Cari subfolder bernama `name` di `parentId`, atau buat bila belum ada. */
  ensure(projectId: string, parentId: string | null, name: string): Folder {
    const clean = name.trim().slice(0, MAX_NAME_LENGTH) || 'General';
    const existing = this.folders
      .list({ project_id: projectId })
      .find((f) => f.parentId === parentId && same(f.name, clean));
    return existing ?? this.create(projectId, { name: clean, parentId });
  }

  private validName(folders: Folder[], value: unknown, parentId: string | null, selfId?: string): string {
    const name = String(value ?? '').trim();
    if (!name) throw new HttpError(400, 'Give the folder a name');
    if (name.length > MAX_NAME_LENGTH)
      throw new HttpError(400, `Keep folder names under ${MAX_NAME_LENGTH} characters`);
    if (folders.some((f) => f.parentId === parentId && f.id !== selfId && same(f.name, name)))
      throw new HttpError(409, `A folder named "${name}" already exists here`);
    return name;
  }
}

/**
 * Migrasi data lama: API dengan field `group` (sebelum ada folder) dipindah ke
 * folder bernama sama. Aman dijalankan berulang kali.
 */
export function migrateLegacyApiGroups(
  apis: DocumentRepository<ApiDefinition>,
  folders: FolderService<ApiDefinition>,
): number {
  let migrated = 0;
  for (const api of apis.list()) {
    const legacy = api as ApiDefinition & { group?: string };
    if (legacy.folderId !== undefined && legacy.group === undefined) continue;
    const { group, ...rest } = legacy;
    const folderId =
      legacy.folderId ?? (group?.trim() ? folders.ensure(api.projectId, null, group).id : null);
    apis.save({ ...rest, folderId });
    migrated++;
  }
  return migrated;
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
