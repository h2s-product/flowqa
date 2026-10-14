import { useState, type MouseEvent } from 'react';
import { Icon, type IconName } from '../Icon';
import { formatNumber } from '@/lib/format';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Warna status (token CSS), selalu disertai ikon + label di legenda. */
  color: string;
  icon: IconName;
}

const SIZE = 180;
const R_OUTER = 80;
const R_INNER = 54;
const C = SIZE / 2;

/** Titik pada lingkaran; sudut 0 = jam 12, searah jarum jam. */
const point = (r: number, angle: number) => [C + r * Math.sin(angle), C - r * Math.cos(angle)];

function arcPath(start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = point(R_OUTER, start);
  const [x2, y2] = point(R_OUTER, end);
  const [x3, y3] = point(R_INNER, end);
  const [x4, y4] = point(R_INNER, start);
  return `M${x1} ${y1} A${R_OUTER} ${R_OUTER} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${R_INNER} ${R_INNER} 0 ${large} 0 ${x4} ${y4}Z`;
}

/**
 * Donut chart untuk komposisi bagian-dari-keseluruhan (maks. ~6 potongan).
 * Legenda selalu tampil dengan ikon, jumlah dan persentase (sekaligus tampilan tabel),
 * dan setiap potongan punya tooltip saat di-hover.
 */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
  label,
}: {
  slices: DonutSlice[];
  centerValue: string;
  centerLabel: string;
  label: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
  const visible = slices.filter((s) => s.value > 0);

  let angle = 0;
  const arcs = visible.map((s) => {
    const start = angle;
    angle += (s.value / total) * Math.PI * 2;
    return { ...s, start, end: angle };
  });
  const activeSlice = slices.find((s) => s.key === active);

  const onMove = (e: MouseEvent, key: string) => {
    const box = (e.currentTarget.closest('.donut') as HTMLElement).getBoundingClientRect();
    setActive(key);
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  };

  return (
    <div className="donut">
      <div className="donut-plot">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
          {total === 0 ? (
            <circle
              cx={C}
              cy={C}
              r={(R_OUTER + R_INNER) / 2}
              fill="none"
              stroke="var(--line)"
              strokeWidth={R_OUTER - R_INNER}
            />
          ) : arcs.length === 1 ? (
            // Satu potongan penuh: gambar sebagai cincin (busur 360° tidak bisa dibuat dengan path).
            <circle
              cx={C}
              cy={C}
              r={(R_OUTER + R_INNER) / 2}
              fill="none"
              stroke={arcs[0].color}
              strokeWidth={R_OUTER - R_INNER}
              onMouseMove={(e) => onMove(e, arcs[0].key)}
              onMouseLeave={() => (setActive(null), setTip(null))}
            />
          ) : (
            arcs.map((a) => (
              <path
                key={a.key}
                d={arcPath(a.start, a.end)}
                fill={a.color}
                stroke="var(--surface)"
                strokeWidth={2}
                strokeLinejoin="round"
                opacity={active && active !== a.key ? 0.4 : 1}
                onMouseMove={(e) => onMove(e, a.key)}
                onMouseLeave={() => (setActive(null), setTip(null))}
                style={{ transition: 'opacity .12s' }}
              />
            ))
          )}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <b>{activeSlice ? `${pct(activeSlice.value)}%` : centerValue}</b>
          <span>{activeSlice ? activeSlice.label : centerLabel}</span>
        </div>
      </div>

      <ul className="donut-legend">
        {slices.map((s) => (
          <li
            key={s.key}
            className={active && active !== s.key ? 'dim' : ''}
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="swatch" style={{ background: s.color }}>
              <Icon name={s.icon} size={10} strokeWidth={3.2} />
            </span>
            <span className="grow">{s.label}</span>
            <b>{formatNumber(s.value)}</b>
            <span className="muted pct">{pct(s.value)}%</span>
          </li>
        ))}
        <li className="total">
          <span className="grow">Total</span>
          <b>{formatNumber(total)}</b>
          <span className="pct" />
        </li>
      </ul>

      {tip && activeSlice && (
        <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="tooltip">
          <b>{activeSlice.label}</b>
          <span>
            {formatNumber(activeSlice.value)} · {pct(activeSlice.value)}%
          </span>
        </div>
      )}
    </div>
  );
}
