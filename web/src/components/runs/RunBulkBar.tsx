import { Icon } from '@/components/Icon';
import { plural } from '@/lib/format';

/** Bar aksi untuk run yang dicentang: hapus atau batalkan pilihan. */
export function RunBulkBar({
  count,
  deleting,
  onDelete,
  onClear,
}: {
  count: number;
  deleting: boolean;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (!count) return null;
  return (
    <div className="bulk-bar danger mb-12" role="region" aria-label="Selected runs">
      <b>{plural(count, 'run')} selected</b>
      <button className="btn sm danger" onClick={onDelete} disabled={deleting}>
        <Icon name="trash" size={13} /> {deleting ? 'Deleting…' : 'Delete'}
      </button>
      <div className="grow" />
      <button className="btn sm ghost" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
