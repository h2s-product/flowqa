import type { DailyRunStat } from '@flowqa/shared';

/** Grafik batang bertumpuk passed/failed per hari. */
export function RunTrendChart({ days }: { days: DailyRunStat[] }) {
  const W = 640;
  const H = 190;
  const pad = 24;
  // Dibulatkan ke bilangan genap supaya label tengah sumbu Y selalu bilangan bulat yang unik.
  const max = Math.ceil(Math.max(2, ...days.map((d) => d.passed + d.failed)) / 2) * 2;
  const bw = (W - pad) / Math.max(days.length, 1);
  const label = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="Test runs per day">
      <g fontSize="10" fill="var(--ink3)">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={W} y1={H - f * (H - 10)} y2={H - f * (H - 10)} stroke="var(--line)" />
            <text x={0} y={H - f * (H - 10) + 3}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const x = pad + i * bw + bw * 0.2;
          const w = bw * 0.6;
          const hp = (d.passed / max) * (H - 10);
          const hf = (d.failed / max) * (H - 10);
          return (
            <g key={d.date}>
              <title>{`${label(d.date)}: ${d.passed} passed, ${d.failed} failed`}</title>
              <rect x={x} y={H - hp} width={w} height={hp} rx={3} fill="var(--green)" />
              <rect x={x} y={H - hp - hf - (hf ? 2 : 0)} width={w} height={hf} rx={3} fill="var(--red)" />
              {i % 2 === 0 && (
                <text x={x + w / 2} y={H + 15} textAnchor="middle">
                  {label(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
