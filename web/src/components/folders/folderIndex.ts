import type { Folder } from '@flowqa/shared';

/** Pilihan khusus di pohon folder selain folder biasa. */
export const ALL = '__all__';
export const UNFILED = '__unfiled__';

export interface FolderIndex {
  byId: Map<string, Folder>;
  children: Map<string | null, Folder[]>;
  /** Jumlah item di folder beserta semua subfoldernya. */
  totalCount: Map<string, number>;
  unfiledCount: number;
}

/** Item apa pun yang bisa dimasukkan ke folder (API, scenario). */
export interface FolderItem {
  id: string;
  folderId?: string | null;
}

export function indexFolders(folders: Folder[], items: FolderItem[]): FolderIndex {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const parent = f.parentId && byId.has(f.parentId) ? f.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  children.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));

  const direct = new Map<string, number>();
  let unfiledCount = 0;
  for (const a of items) {
    if (a.folderId && byId.has(a.folderId)) direct.set(a.folderId, (direct.get(a.folderId) ?? 0) + 1);
    else unfiledCount++;
  }
  const totalCount = new Map<string, number>();
  const total = (id: string): number => {
    const cached = totalCount.get(id);
    if (cached !== undefined) return cached;
    const n = (direct.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, c) => sum + total(c.id), 0);
    totalCount.set(id, n);
    return n;
  };
  folders.forEach((f) => total(f.id));
  return { byId, children, totalCount, unfiledCount };
}

/** Rantai folder dari level teratas sampai `id`. */
export function folderChain(index: FolderIndex, id: string | null | undefined): Folder[] {
  const chain: Folder[] = [];
  for (let cur = id ? index.byId.get(id) : undefined; cur && chain.length < 50;) {
    chain.unshift(cur);
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  }
  return chain;
}

export const folderPath = (index: FolderIndex, id: string | null | undefined) =>
  folderChain(index, id)
    .map((f) => f.name)
    .join(' / ');

/** Folder berurutan seperti pohon (depth-first) beserta kedalamannya, untuk dropdown. */
export function flattenTree(index: FolderIndex, exclude?: Set<string>): { folder: Folder; depth: number }[] {
  const out: { folder: Folder; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) =>
    (index.children.get(parent) ?? []).forEach((f) => {
      if (exclude?.has(f.id)) return;
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    });
  walk(null, 0);
  return out;
}

export function descendants(index: FolderIndex, id: string): Set<string> {
  const out = new Set<string>([id]);
  const walk = (parent: string) =>
    (index.children.get(parent) ?? []).forEach((c) => (out.add(c.id), walk(c.id)));
  walk(id);
  return out;
}
