import { displayValue, flattenObject } from '@flowqa/shared';
import { useToast } from '@/context/ToastContext';
import { createCapture } from '../step-factory';
import { suggestVariableName, variablesProduced, variablesUsed } from '../variables';
import { responseSample, type ApiStepTabProps } from './types';
import { IconButton } from '@/components/ui';

export function CaptureTab(props: ApiStepTabProps) {
  const { step, update, api, apis, scenario, index } = props;
  const toast = useToast();
  const { data, fromRun } = responseSample(props);
  const rows = flattenObject(data);
  const captured = new Set(step.captures.map((c) => c.field));

  const capture = (field: string) => {
    const taken = new Set(scenario.steps.flatMap(variablesProduced));
    const variable = suggestVariableName(api, field, taken);
    update({ captures: [...step.captures, createCapture(field, variable)] });
    toast(`Saved “${field}” as {{${variable}}}`);
  };
  const setCapture = (i: number, patch: { field?: string; variable?: string }) =>
    update({ captures: step.captures.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <>
      <div className="cfg-section">
        <h4>Values passed to later steps</h4>
        <p>
          Pick something from the response and give it a name. Later steps can then use it, for example as the
          order ID.
        </p>
        {step.captures.length ? (
          <table className="kv">
            <thead>
              <tr>
                <th>Response field</th>
                <th />
                <th>Saved as</th>
                <th>Used by</th>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {step.captures.map((c, i) => {
                const users = scenario.steps
                  .map((s, k) => (k > index && variablesUsed(s, apis).includes(c.variable) ? k + 1 : null))
                  .filter(Boolean);
                return (
                  <tr key={c.id}>
                    <td>
                      <input
                        className="in code"
                        list={`paths-${step.id}`}
                        value={c.field}
                        onChange={(e) => setCapture(i, { field: e.target.value })}
                      />
                    </td>
                    <td className="muted">→</td>
                    <td>
                      <input
                        className="in code"
                        value={c.variable}
                        onChange={(e) => setCapture(i, { variable: e.target.value.replace(/[^\w]/g, '_') })}
                      />
                    </td>
                    <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                      {users.length ? `step ${users.join(', ')}` : 'not used yet'}
                    </td>
                    <td>
                      <IconButton
                        icon="trash"
                        label="Remove this capture"
                        onClick={() => update({ captures: step.captures.filter((_, j) => j !== i) })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="banner">Nothing is captured yet. Choose a value below.</div>
        )}
        <datalist id={`paths-${step.id}`}>
          {rows.map(([k]) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </div>

      <div className="cfg-section">
        <h4>Select a response value</h4>
        <p>{fromRun ? 'From the last run.' : 'From the example response. Run the test to see real data.'}</p>
        <div className="tree">
          {rows.length ? (
            rows.map(([key, value]) => (
              <div key={key} className={`tree-row ${captured.has(key) ? 'captured' : ''}`}>
                <span className="k code">{key}</span>
                <span className="v" title={displayValue(value)}>
                  {displayValue(value)}
                </span>
                {captured.has(key) ? (
                  <span className="chip var-out">saved</span>
                ) : (
                  <button className="btn sm" onClick={() => capture(key)}>
                    Capture
                  </button>
                )}
              </div>
            ))
          ) : (
            <div className="empty small">This response has no fields.</div>
          )}
        </div>
      </div>
    </>
  );
}
