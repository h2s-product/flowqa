import { useCallback, useEffect, useRef, useState } from 'react';
import type { Scenario, Step } from '@flowqa/shared';
import { useUpdateScenario } from '@/api/queries';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';
const AUTOSAVE_DELAY_MS = 700;

/**
 * Salinan lokal scenario yang bisa diedit bebas, dengan autosave (debounce)
 * ke server. `flush()` memaksa simpan sekarang — dipanggil sebelum menjalankan test.
 *
 * - Editan yang belum tersimpan tetap dikirim saat halaman ditinggalkan.
 * - Hasil simpan yang datang terlambat (lebih lama dari editan terbaru) diabaikan.
 */
export function useScenarioDraft(source: Scenario | undefined) {
  const [draft, setDraft] = useState<Scenario | undefined>(source);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const { mutateAsync } = useUpdateScenario();
  const timer = useRef<number>();
  const latest = useRef(draft);
  const pending = useRef(false);
  const editSeq = useRef(0);
  latest.current = draft;

  // Muat ulang dari server hanya saat membuka scenario lain.
  useEffect(() => {
    setDraft(source);
    setSaveState('saved');
    pending.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);

  const persist = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!latest.current) return;
    const seq = editSeq.current;
    pending.current = false;
    setSaveState('saving');
    try {
      await mutateAsync(latest.current);
      // Ada editan baru selama menyimpan → biarkan status "unsaved" dari editan itu.
      if (seq === editSeq.current) setSaveState('saved');
    } catch {
      if (seq === editSeq.current) setSaveState('error');
    }
  }, [mutateAsync]);

  const change = useCallback(
    (updater: (s: Scenario) => Scenario) => {
      setDraft((current) => (current ? updater(current) : current));
      editSeq.current++;
      pending.current = true;
      setSaveState('unsaved');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(persist, AUTOSAVE_DELAY_MS);
    },
    [persist],
  );

  // Saat halaman ditinggalkan: simpan editan yang masih tertunda, jangan dibuang.
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (pending.current) void persistRef.current();
    },
    [],
  );

  const updateStep = useCallback(
    (index: number, updater: (step: Step) => Step) =>
      change((s) => ({ ...s, steps: s.steps.map((st, i) => (i === index ? updater(st) : st)) })),
    [change],
  );

  return { draft, saveState, change, updateStep, flush: persist };
}
