/** Statistik run yang dipakai dashboard & report (satu definisi untuk semua). */

/** Persentase dengan satu angka desimal, mis. 83.3. */
export const percent = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : 0);

/** Rata-rata durasi (ms, dibulatkan). */
export const averageDuration = (runs: { durationMs: number }[]) =>
  runs.length ? Math.round(runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length) : 0;

/** Durasi yang mudah dibaca, mis. "850 ms", "4.2 s", "3 min 5 s". */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}
