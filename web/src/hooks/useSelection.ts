import { useEffect, useMemo, useState } from 'react';

/**
 * Pilihan (centang) baris di daftar. `available` = id yang boleh dipilih saat
 * ini; id yang hilang dari daftar (dihapus / tersaring) otomatis dibuang.
 */
export function useSelection(available: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Key string agar set hanya dibuat ulang bila isi daftar benar-benar berubah.
  const availableKey = available.join('|');
  const availableSet = useMemo(() => new Set(availableKey ? availableKey.split('|') : []), [availableKey]);

  useEffect(() => {
    setSelected((current) => {
      const kept = [...current].filter((id) => availableSet.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [availableSet]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Pilih / batalkan sekelompok id sekaligus (mis. "pilih semua" atau satu grup). */
  const setMany = (ids: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  /** Status centang untuk sekelompok id: semua, sebagian, atau tidak ada. */
  const stateOf = (ids: string[]) => {
    const count = ids.filter((id) => selected.has(id)).length;
    return { all: ids.length > 0 && count === ids.length, some: count > 0 };
  };

  return { selected, toggle, setMany, stateOf, clear: () => setSelected(new Set()) };
}

export type Selection = ReturnType<typeof useSelection>;
