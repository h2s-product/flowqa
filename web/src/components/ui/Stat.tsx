import type { CSSProperties, ReactNode } from 'react';

/** Warna nilai statistik: g = baik (hijau), r = perlu perhatian (merah). */
export type StatTone = 'g' | 'r';

/**
 * Grid tile statistik (KPI). Isi dengan <Stat>. Tanpa `columns` jumlah kolom
 * menyesuaikan lebar layar; dengan `columns` grid tetap N kolom (turun ke 2
 * di layar sempit) — pakai di halaman detail agar tile rata tanpa sisa.
 */
export const StatGrid = ({
  children,
  className,
  columns,
}: {
  children: ReactNode;
  className?: string;
  columns?: number;
}) => (
  <div
    className={`stats ${columns ? 'fixed' : ''} ${className ?? ''}`}
    style={columns ? ({ '--stat-cols': columns } as CSSProperties) : undefined}
  >
    {children}
  </div>
);

/**
 * Satu tile statistik. `tone` mewarnai nilai (g = hijau/baik, r = merah/buruk),
 * `size="sm"` untuk nilai berupa teks panjang (nama, tanggal), `sub` untuk
 * keterangan kecil di bawah nilai (mis. waktu relatif, versi).
 */
export function Stat({
  label,
  value,
  tone,
  size = 'md',
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  size?: 'md' | 'sm';
  sub?: ReactNode;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={`${tone ?? ''} ${size === 'sm' ? 'stat-sm' : ''}`}>{value}</b>
      {sub != null && <small className="stat-sub">{sub}</small>}
    </div>
  );
}
