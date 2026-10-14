import type { Assertion, AssertionResult } from '@flowqa/shared';
import { compareValues, describeAssertion, displayValue, getByPath } from '@flowqa/shared';
import type { VariableContext } from './variable-context';

export interface ResponseSnapshot {
  status: number;
  body: unknown;
  durationMs: number;
}

export function evaluateAssertion(
  assertion: Assertion,
  response: ResponseSnapshot,
  variables: VariableContext,
): AssertionResult {
  const expected = variables.resolve(String(assertion.expected ?? ''));
  const label = describeAssertion({ ...assertion, expected });
  const base = { assertionId: assertion.id, label };

  switch (assertion.kind) {
    case 'status':
      return {
        ...base,
        passed: compareValues(response.status, assertion.operator, expected),
        expected,
        actual: String(response.status),
      };
    case 'time': {
      const ms = Math.round(response.durationMs);
      return {
        ...base,
        passed: compareValues(ms, assertion.operator, expected),
        expected: `${expected} ms`,
        actual: `${ms} ms`,
      };
    }
    case 'schema': {
      const required = expected
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const missing = required.filter((field) => getByPath(response.body, field) === undefined);
      return {
        ...base,
        passed: missing.length === 0,
        expected: required.join(', '),
        actual: missing.length ? `missing: ${missing.join(', ')}` : 'all present',
      };
    }
    case 'field':
    default: {
      const actual = getByPath(response.body, assertion.field ?? '');
      return {
        ...base,
        passed: compareValues(actual, assertion.operator, expected),
        expected,
        actual: displayValue(actual),
      };
    }
  }
}

/** Assertion implisit bila step tidak punya pengecekan status sama sekali. */
export function defaultSuccessAssertion(status: number): AssertionResult {
  return {
    label: 'Request succeeded (2xx) — default check',
    passed: status >= 200 && status < 300,
    expected: '2xx',
    actual: String(status),
  };
}
