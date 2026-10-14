import { Field, Toggle } from '@/components/ui';
import type { ApiStepTabProps } from './types';

export function SettingsTab({ step, update, environment }: ApiStepTabProps) {
  return (
    <div className="cfg-section">
      <h4>When this step fails</h4>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <Field label="Retries" hint="Useful when data takes a moment to update.">
          <select
            className="in"
            value={step.retries}
            onChange={(e) => update({ retries: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'Don’t retry' : `Retry ${n} time${n > 1 ? 's' : ''}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Repeat (loop)" hint="Run this request several times; all must pass.">
          <input
            className="in"
            type="number"
            min={1}
            max={50}
            value={step.repeat}
            onChange={(e) => update({ repeat: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="Timeout (ms)">
          <input
            className="in"
            type="number"
            placeholder={`Use environment (${environment?.timeoutMs ?? 30000})`}
            value={step.timeoutMs ?? ''}
            onChange={(e) => update({ timeoutMs: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
      </div>
      <div className="grid" style={{ marginTop: 14, gap: 10 }}>
        <Toggle
          checked={step.continueOnFailure}
          onChange={(continueOnFailure) => update({ continueOnFailure })}
        >
          Keep going if this step fails
        </Toggle>
        <Toggle checked={step.disabled} onChange={(disabled) => update({ disabled })}>
          Turn this step off
        </Toggle>
      </div>
    </div>
  );
}
