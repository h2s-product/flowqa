import type { FailureExplanation } from '@flowqa/shared';

/** Penjelasan kegagalan dalam bahasa sederhana: apa yang salah & cara memperbaiki. */
export function FailureBox({
  explanation,
  stepLabel,
}: {
  explanation: FailureExplanation;
  stepLabel?: string;
}) {
  return (
    <div className="explain">
      {stepLabel && (
        <div className="small" style={{ fontWeight: 600, marginBottom: 2 }}>
          {stepLabel}
        </div>
      )}
      <b>{explanation.title}</b>
      {explanation.detail && <div>{explanation.detail}</div>}
      {explanation.fix && (
        <div className="fix">
          <b>How to fix:</b> {explanation.fix}
        </div>
      )}
    </div>
  );
}
