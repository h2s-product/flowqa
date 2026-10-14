/** Grafik garis kecil (sparkline) untuk persentase, mis. failure rate per hari. */
export function FailureRateChart({ values }: { values: number[] }) {
  const W = 300;
  const H = 70;
  const max = Math.max(10, ...values);
  const points = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * W},${H - (v / max) * (H - 8) - 2}`)
    .join(' ');
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Failure rate per day">
        <polyline points={`0,${H} ${points} ${W},${H}`} fill="var(--red-soft)" stroke="none" />
        <polyline points={points} fill="none" stroke="var(--red)" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>{values.length} days ago</span>
        <span>Today {Math.round(values[values.length - 1] ?? 0)}%</span>
      </div>
    </>
  );
}
