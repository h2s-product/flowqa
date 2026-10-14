import type { Assertion, AssertionKind, Operator } from '@flowqa/shared';
import { OPERATORS, UNARY_OPERATORS, flattenObject } from '@flowqa/shared';
import { Icon } from '@/components/Icon';
import { createAssertion } from '../step-factory';
import { responseSample, type ApiStepTabProps } from './types';
import { IconButton } from '@/components/ui';

const KINDS: { id: AssertionKind; label: string }[] = [
  { id: 'status', label: 'Status code' },
  { id: 'field', label: 'Response field' },
  { id: 'time', label: 'Response time' },
  { id: 'schema', label: 'Required fields' },
];

const operatorsFor = (kind: AssertionKind): readonly Operator[] =>
  kind === 'time'
    ? ['less than', 'less/equal', 'greater than']
    : kind === 'status'
      ? ['equals', 'not equals', 'less than', 'greater than']
      : OPERATORS;

export function ExpectTab(props: ApiStepTabProps) {
  const { step, update, result } = props;
  const paths = flattenObject(responseSample(props).data).map(([k]) => k);
  const topLevel = paths.filter((p) => !p.includes('.'));

  const setAssertion = (i: number, patch: Partial<Assertion>) =>
    update({ assertions: step.assertions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const add = (a: Assertion) => update({ assertions: [...step.assertions, a] });

  return (
    <div className="cfg-section">
      <h4>What should happen</h4>
      <p>The step passes only when every check below is true.</p>
      {step.assertions.length === 0 && (
        <div className="banner">
          No checks yet. Without checks, the step passes when the API responds successfully (2xx).
        </div>
      )}

      {step.assertions.map((a, i) => {
        const res = result?.assertions?.find((r) => r.assertionId === a.id);
        const isField = a.kind === 'field';
        return (
          <div key={a.id} className={`assert-row ${isField ? '' : 'nofield'}`}>
            <select
              className="in"
              value={a.kind}
              onChange={(e) =>
                setAssertion(i, {
                  ...createAssertion(
                    e.target.value as AssertionKind,
                    e.target.value === 'field' ? paths[0] : '',
                  ),
                  id: a.id,
                })
              }
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            {isField && (
              <select
                className="in code"
                value={a.field}
                onChange={(e) => setAssertion(i, { field: e.target.value })}
              >
                {[...new Set([a.field ?? '', ...paths])].filter(Boolean).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            )}
            {a.kind === 'schema' ? (
              <span className="small muted">must include</span>
            ) : (
              <select
                className="in"
                value={a.operator}
                onChange={(e) => setAssertion(i, { operator: e.target.value as Operator })}
              >
                {operatorsFor(a.kind).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            )}
            {UNARY_OPERATORS.includes(a.operator) && a.kind !== 'schema' ? (
              <span />
            ) : (
              <input
                className="in code"
                value={a.expected}
                placeholder={
                  a.kind === 'schema' ? 'id, status, total' : a.kind === 'time' ? '1000' : 'expected value'
                }
                onChange={(e) => setAssertion(i, { expected: e.target.value })}
              />
            )}
            <IconButton
              icon="trash"
              label="Remove check"
              onClick={() => update({ assertions: step.assertions.filter((_, j) => j !== i) })}
            />
            {res && (
              <div className={`assert-result ${res.passed ? 'pass' : 'fail'}`}>
                {res.passed ? '✓ Passed last run' : '✕ Failed last run'} · expected <b>{res.expected}</b>,
                actual <b>{res.actual}</b>
              </div>
            )}
          </div>
        );
      })}

      <div className="row wrap" style={{ marginTop: 12, gap: 6 }}>
        <button className="btn sm" onClick={() => add(createAssertion('status'))}>
          <Icon name="plus" size={14} /> Status code
        </button>
        <button className="btn sm" onClick={() => add(createAssertion('field', paths[0]))}>
          <Icon name="plus" size={14} /> Response field
        </button>
        <button className="btn sm" onClick={() => add(createAssertion('time'))}>
          <Icon name="plus" size={14} /> Response time
        </button>
        <button
          className="btn sm"
          onClick={() => add(createAssertion('schema', topLevel.slice(0, 3).join(', ')))}
        >
          <Icon name="plus" size={14} /> Required fields
        </button>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        Tip: expected values can use variables, for example <span className="code">{'{{customer_id}}'}</span>.
      </p>
    </div>
  );
}
