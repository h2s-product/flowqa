import { useState, type MouseEvent } from 'react';
import { formatNumber } from '@/lib/format';

export interface Series {
  label: string;
  color: string;
  values: number[];
  /** Area berisi di bawah garis. */
  fill?: string;
  /** Tampilkan sebagai batang, bukan garis. */
  bars?: boolean;
}

/**
 * Grafik time-series ringan (SVG, tanpa dependensi). Sumbu x = detik sejak test
 * dimulai. Arahkan kursor untuk melihat nilai setiap seri pada detik tersebut.
 */
export function TimeSeriesChart({
  series,
  times,
  unit = '',
  height = 170,
  maxHint = 1,
  label,
}: {
  series: Series[];
  times: number[];
  unit?: string;
  height?: number;
  maxHint?: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = height;
  const padL = 40;
  const padB = 20;
  const n = times.length;
  const max = niceMax(Math.max(maxHint, ...series.flatMap((s) => s.values)));
  const x = (i: number) => padL + (n > 1 ? (i / (n - 1)) * (W - padL - 4) : 0);
  const y = (v: number) => H - padB - (v / max) * (H - padB - 8);
  const barW = Math.max(1, ((W - padL) / Math.max(n, 1)) * 0.7);

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.min(n - 1, Math.max(0, Math.round(((px - padL) / (W - padL - 4)) * (n - 1)))));
  };

  const ticks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];

  return (
    <div className="ts-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={label}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <g fontSize="10" fill="var(--ink3)">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" />
              <text x={padL - 6} y={y(max * f) + 3} textAnchor="end">
                {compact(max * f)}
              </text>
            </g>
          ))}
          {n > 0 &&
            ticks.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={H - 4}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              >
                {clock(times[i])}
              </text>
            ))}
        </g>
        {series.map((s) =>
          s.bars ? (
            <g key={s.label} fill={s.color}>
              {s.values.map((v, i) =>
                v > 0 ? (
                  <rect key={i} x={x(i) - barW / 2} y={y(v)} width={barW} height={y(0) - y(v)} rx={1} />
                ) : null,
              )}
            </g>
          ) : (
            <g key={s.label}>
              {s.fill && n > 1 && (
                <polygon
                  points={`${x(0)},${y(0)} ${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} ${x(n - 1)},${y(0)}`}
                  fill={s.fill}
                />
              )}
              <polyline
                points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            </g>
          ),
        )}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={8} y2={H - padB} stroke="var(--ink3)" strokeDasharray="3 3" />
        )}
      </svg>
      <div className="ts-legend small">
        {hover !== null ? <span className="muted">{clock(times[hover])}</span> : null}
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
            {hover !== null && (
              <b>
                {' '}
                {formatNumber(Math.round(s.values[hover] ?? 0))}
                {unit}
              </b>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * magnitude >= v) ?? 10;
  return step * magnitude;
}

const compact = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 10) / 10));

const clock = (sec = 0) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
