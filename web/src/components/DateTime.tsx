import { formatDateTime, formatDateTimeFull, formatTime, timeAgo } from '@/lib/format';

/**
 * Tanggal & waktu dengan format standar. Tooltip selalu berisi waktu lengkap
 * (detik + zona waktu). `relative` menambahkan "· 5 min ago" di belakangnya,
 * `timeOnly` menampilkan jam saja (mis. untuk step dalam satu run).
 */
export function DateTime({
  value,
  relative,
  timeOnly,
  empty = '—',
  className,
}: {
  value?: string | null;
  relative?: boolean;
  timeOnly?: boolean;
  empty?: string;
  className?: string;
}) {
  if (!value) return <span className={`muted ${className ?? ''}`}>{empty}</span>;
  return (
    <time dateTime={value} title={formatDateTimeFull(value)} className={`dt ${className ?? ''}`}>
      {timeOnly ? formatTime(value) : formatDateTime(value)}
      {relative && <span className="muted"> · {timeAgo(value)}</span>}
    </time>
  );
}
