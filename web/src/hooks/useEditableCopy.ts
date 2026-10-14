import { useEffect, useMemo, useState, type SetStateAction } from 'react';

interface State<T> {
  /** Versi server yang terakhir disalin ke draft. */
  base: T | null;
  draft: T | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const copy = <T>(value: T | null | undefined): T | null => (value ? structuredClone(value) : null);

/**
 * Salinan lokal sebuah entitas untuk form edit (dengan tombol Save).
 * Data dari server hanya disalin ulang bila entitas yang dibuka berganti atau
 * draft belum diubah — refresh data di latar belakang tidak menimpa editan user.
 */
export function useEditableCopy<T extends { id: string }>(source: T | null | undefined) {
  const [state, setState] = useState<State<T>>(() => ({ base: source ?? null, draft: copy(source) }));

  useEffect(() => {
    setState((prev) => {
      if (!source) return { base: null, draft: null };
      const edited = prev.base?.id === source.id && prev.draft && !same(prev.draft, prev.base);
      // Editan yang belum disimpan dipertahankan, kecuali isinya sudah sama dengan versi server.
      if (edited && !same(prev.draft, source)) return prev;
      return { base: source, draft: copy(source) };
    });
  }, [source]);

  const dirty = useMemo(() => !!state.draft && !same(state.draft, state.base), [state]);

  const setDraft = (action: SetStateAction<T | null>) =>
    setState((prev) => ({
      ...prev,
      draft: typeof action === 'function' ? (action as (d: T | null) => T | null)(prev.draft) : action,
    }));

  /** Buang editan dan kembali ke versi server. */
  const reset = () => setState((prev) => ({ ...prev, draft: copy(prev.base) }));

  return { draft: state.draft, setDraft, dirty, reset };
}
