import type { FolderIndex } from './folderIndex';
import { flattenTree } from './folderIndex';

/** Dropdown folder bertingkat. Nilai '' = level teratas / Unfiled. */
export function FolderSelect({
  index,
  value,
  onChange,
  rootLabel = 'No folder (Unfiled)',
  exclude,
  autoFocus,
}: {
  index: FolderIndex;
  value: string | null;
  onChange: (folderId: string | null) => void;
  rootLabel?: string;
  exclude?: Set<string>;
  autoFocus?: boolean;
}) {
  return (
    <select
      className="in"
      value={value ?? ''}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{rootLabel}</option>
      {flattenTree(index, exclude).map(({ folder, depth }) => (
        <option key={folder.id} value={folder.id}>
          {'   '.repeat(depth)}
          {depth ? '└ ' : ''}
          {folder.name}
        </option>
      ))}
    </select>
  );
}
