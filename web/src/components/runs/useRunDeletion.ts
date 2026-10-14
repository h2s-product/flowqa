import { useDeleteRuns, type RunKind } from '@/api/queries';
import { useToast } from '@/context/ToastContext';
import { plural } from '@/lib/format';
import { useConfirm } from '@/context/ConfirmContext';

/**
 * Hapus run dengan konfirmasi & toast hasil. Dipakai daftar run (hapus massal)
 * dan halaman detail run (hapus satu).
 */
export function useRunDeletion(kind: RunKind) {
  const mutation = useDeleteRuns(kind);
  const toast = useToast();
  const confirm = useConfirm();

  const remove = async (projectId: string, ids: string[], onDeleted?: () => void) => {
    if (!ids.length) return;
    const what = ids.length === 1 ? 'this run' : plural(ids.length, 'run');
    const extra = kind === 'ui' ? ' Its step screenshots are deleted too.' : '';
    if (
      !(await confirm({
        title: `Delete ${what}?`,
        message: `This cannot be undone.${extra}`,
      }))
    )
      return;
    mutation.mutate(
      { projectId, ids },
      {
        onSuccess: ({ deleted, running }) => {
          toast(
            `Deleted ${plural(deleted, 'run')}` +
              (running
                ? ` · ${plural(running, 'run')} still running ${running === 1 ? 'was' : 'were'} kept`
                : ''),
          );
          onDeleted?.();
        },
      },
    );
  };

  return { remove, deleting: mutation.isPending };
}
