/** Form konfigurasi untuk step non-API: wait, set variable, condition. */
import type {
  ConditionStep,
  Environment,
  Operator,
  Scenario,
  SetVariableStep,
  WaitStep,
} from '@flowqa/shared';
import { DYNAMIC_VARIABLES, OPERATORS, UNARY_OPERATORS } from '@flowqa/shared';
import { Field } from '@/components/ui';
import { SourceHint, VariablePicker } from './VariablePicker';
import { availableVariables } from './variables';

interface Common<T> {
  step: T;
  update: (patch: Partial<T>) => void;
  scenario: Scenario;
  index: number;
  environment?: Environment;
}

export function WaitForm({ step, update }: Common<WaitStep>) {
  return (
    <div className="cfg-section">
      <h4>Pause</h4>
      <p>Give the system time to finish work, for example a payment being confirmed.</p>
      <Field label="Wait for (milliseconds)" hint="Maximum 60,000 ms.">
        <input
          className="in"
          type="number"
          min={0}
          max={60000}
          value={step.durationMs}
          onChange={(e) => update({ durationMs: Number(e.target.value) })}
        />
      </Field>
    </div>
  );
}

export function SetVariableForm({ step, update, scenario, index, environment }: Common<SetVariableStep>) {
  const vars = availableVariables(scenario, index, environment);
  return (
    <div className="cfg-section">
      <h4>Save a value</h4>
      <p>Later steps can use it as {`{{${step.variable || 'name'}}}`}.</p>
      <div className="grid">
        <Field label="Variable name">
          <input
            className="in code"
            value={step.variable}
            placeholder="customer_email"
            onChange={(e) => update({ variable: e.target.value.replace(/[^\w]/g, '_') })}
          />
        </Field>
        <div className="field">
          <span>Value</span>
          <div className="row" style={{ gap: 4 }}>
            <input
              className="in code"
              value={step.value}
              placeholder="{{random_email}}"
              onChange={(e) => update({ value: e.target.value })}
            />
            <VariablePicker variables={vars} onPick={(token) => update({ value: step.value + token })} />
          </div>
          <em>
            <SourceHint value={step.value} scenario={scenario} index={index} environment={environment} />
          </em>
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          {DYNAMIC_VARIABLES.map((d) => (
            <button key={d.key} className="btn sm ghost" onClick={() => update({ value: `{{${d.key}}}` })}>
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConditionForm({ step, update, scenario, index, environment }: Common<ConditionStep>) {
  const vars = availableVariables(scenario, index, environment);
  return (
    <div className="cfg-section">
      <h4>Only continue when…</h4>
      <p>If the check is false, the next steps are skipped.</p>
      <div className="grid">
        <div className="field">
          <span>Value to check</span>
          <div className="row" style={{ gap: 4 }}>
            <input
              className="in code"
              value={step.left}
              placeholder="{{payment_status}}"
              onChange={(e) => update({ left: e.target.value })}
            />
            <VariablePicker variables={vars} onPick={(left) => update({ left })} />
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Rule">
            <select
              className="in"
              value={step.operator}
              onChange={(e) => update({ operator: e.target.value as Operator })}
            >
              {OPERATORS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </Field>
          {!UNARY_OPERATORS.includes(step.operator) && (
            <Field label="Compared with">
              <input
                className="in code"
                value={step.right}
                onChange={(e) => update({ right: e.target.value })}
              />
            </Field>
          )}
        </div>
        <Field label="If false, skip the next">
          <select
            className="in"
            value={step.skipCount}
            onChange={(e) => update({ skipCount: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} step{n > 1 ? 's' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}
