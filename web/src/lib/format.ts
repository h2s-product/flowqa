export const formatMs = (ms?: number | null) =>
  ms == null ? '' : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;

/** Waktu relatif: "just now", "5 min ago", atau "in 2 h" untuk waktu di masa depan. */
export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const seconds = Math.abs(diff);
  if (seconds < 60) return 'just now';
  const amount =
    seconds < 3600
      ? `${Math.floor(seconds / 60)} min`
      : seconds < 86400
        ? `${Math.floor(seconds / 3600)} h`
        : `${Math.floor(seconds / 86400)} d`;
  return diff >= 0 ? `${amount} ago` : `in ${amount}`;
}

/** Format tanggal & waktu standar di seluruh aplikasi, mis. "26 Sep 2026, 17:08". */
export const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** Versi lengkap dengan detik & zona waktu, mis. "26 Sep 2026, 17:08:23 GMT+7" (untuk tooltip & detail). */
export const formatDateTimeFull = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      })
    : '—';

/** Jam saja dengan detik, mis. "17:08:23" (untuk step di dalam satu run). */
export const formatTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

/** Nama environment yang tampak seperti production (dipakai untuk peringatan). */
export const isProdEnv = (name = '') => /prod/i.test(name);

export const envColor = (name = '') =>
  isProdEnv(name) ? 'var(--red)' : /stag|uat/i.test(name) ? 'var(--amber)' : 'var(--green)';

/** Angka dengan pemisah ribuan, mis. 1,234,567. null/undefined → 0. */
export const formatNumber = (n?: number | null) => (n == null ? '0' : n.toLocaleString('en-US'));

/** Durasi dalam detik → "45s", "2m 30s", "1h 5m". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "1 run", "3 runs" — bentuk jamak sederhana (bahasa Inggris). */
export const plural = (count: number, word: string, pluralWord = `${word}s`) =>
  `${formatNumber(count)} ${count === 1 ? word : pluralWord}`;

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong';
