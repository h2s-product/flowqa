/** Pembuat objek step/assertion/capture baru dengan nilai default yang masuk akal. */
import type {
  ApiDefinition,
  ApiStep,
  Assertion,
  AssertionKind,
  Capture,
  ConditionStep,
  SetVariableStep,
  WaitStep,
} from '@flowqa/shared';
import { createId } from '@flowqa/shared';

const base = (name: string) => ({ id: createId('st'), name, disabled: false, continueOnFailure: false });

export function createApiStep(api: ApiDefinition, options: { captureToken?: boolean } = {}): ApiStep {
  const hasToken =
    !!api.exampleResponse &&
    typeof api.exampleResponse === 'object' &&
    'token' in (api.exampleResponse as object);
  return {
    ...base(api.name),
    type: 'api',
    apiId: api.id,
    bodyMode: 'visual',
    body: structuredClone(api.body),
    bodyJson: '',
    query: [],
    headers: [],
    pathParams: {},
    tokenVariable: 'auth_token',
    captures: options.captureToken && hasToken ? [createCapture('token', 'auth_token')] : [],
    assertions: [createAssertion('status', api.method === 'POST' ? '201' : '200')],
    retries: 0,
    repeat: 1,
    timeoutMs: null,
  };
}

export const createWaitStep = (): WaitStep => ({ ...base('Wait'), type: 'wait', durationMs: 1000 });

export const createSetVariableStep = (value = '', variable = ''): SetVariableStep => ({
  ...base(variable ? `Generate ${variable.replace(/_/g, ' ')}` : 'Set variable'),
  type: 'setVariable',
  variable,
  value,
});

export const createConditionStep = (): ConditionStep => ({
  ...base('Check before continuing'),
  type: 'condition',
  left: '',
  operator: 'equals',
  right: '',
  skipCount: 1,
});

export function createAssertion(kind: AssertionKind, expectedOrField = ''): Assertion {
  switch (kind) {
    case 'status':
      return { id: createId('as'), kind, operator: 'equals', expected: expectedOrField || '200' };
    case 'time':
      return { id: createId('as'), kind, operator: 'less than', expected: expectedOrField || '1000' };
    case 'schema':
      return { id: createId('as'), kind, operator: 'equals', expected: expectedOrField };
    case 'field':
      return {
        id: createId('as'),
        kind,
        field: expectedOrField || 'status',
        operator: 'equals',
        expected: '',
      };
  }
}

export const createCapture = (field: string, variable: string): Capture => ({
  id: createId('cp'),
  field,
  variable,
});
