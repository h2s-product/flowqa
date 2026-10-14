import type { Environment, Scenario } from '@flowqa/shared';
import { DYNAMIC_VARIABLES, extractVariables } from '@flowqa/shared';
import type { AvailableVariable } from './variables';
import { findProducer } from './variables';

/** Dropdown "Insert value…" untuk menyisipkan {{variabel}} ke sebuah input. */
export function VariablePicker({
  variables,
  onPick,
}: {
  variables: AvailableVariable[];
  onPick: (token: string) => void;
}) {
  const group = (source: AvailableVariable['source']) => variables.filter((v) => v.source === source);
  return (
    <select
      className="in"
      style={{ width: 'auto', maxWidth: 150, fontSize: 12, padding: '5px 6px' }}
      value=""
      aria-label="Insert a variable"
      onChange={(e) => e.target.value && onPick(e.target.value)}
    >
      <option value="">Insert value…</option>
      <optgroup label="From earlier steps">
        {group('step').map((v) => (
          <option key={`s${v.key}`} value={`{{${v.key}}}`}>
            {v.key} ({v.label})
          </option>
        ))}
      </optgroup>
      <optgroup label="Environment">
        {group('environment').map((v) => (
          <option key={`e${v.key}`} value={`{{${v.key}}}`}>
            {v.key}
          </option>
        ))}
      </optgroup>
      <optgroup label="Generated">
        {group('dynamic').map((v) => (
          <option key={`d${v.key}`} value={`{{${v.key}}}`}>
            {v.label}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/** Keterangan kecil dari mana nilai sebuah {{variabel}} berasal. */
export function SourceHint({
  value,
  scenario,
  index,
  environment,
}: {
  value: string;
  scenario: Scenario;
  index: number;
  environment?: Environment;
}) {
  const name = extractVariables(value)[0];
  if (!name) return null;
  const producer = findProducer(scenario, name, index);
  if (producer)
    return (
      <span className="from">
        from{' '}
        <b>
          step {producer.index + 1} · {producer.step.name}
        </b>
      </span>
    );
  if (environment?.variables.some((v) => v.key === name))
    return (
      <span className="from">
        from <b>environment</b>
      </span>
    );
  if (DYNAMIC_VARIABLES.some((d) => d.key === name)) return <span className="from">generated each run</span>;
  return <span className="from text-fail">no value found yet</span>;
}
