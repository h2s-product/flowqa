import { formatNumber } from '@/lib/format';

/** Ringkasan hasil: "12 passed · 1 failed · 2 skipped" (nilai nol disembunyikan kecuali passed). */
export function RunCounts({
  passed,
  failed = 0,
  skipped = 0,
  noun,
}: {
  passed: number;
  failed?: number;
  skipped?: number;
  /** Kata benda opsional di depan, mis. "runs". */
  noun?: string;
}) {
  return (
    <span className="run-counts">
      <span className="text-pass">
        {formatNumber(passed)} passed{noun ? ` ${noun}` : ''}
      </span>
      {failed > 0 && <span className="text-fail"> · {formatNumber(failed)} failed</span>}
      {skipped > 0 && <span className="muted"> · {formatNumber(skipped)} skipped</span>}
    </span>
  );
}
