/**
 * Menerjemahkan kegagalan teknis menjadi penjelasan berbahasa sederhana
 * ("apa yang salah" + "cara memperbaiki") untuk pengguna non-teknis.
 */
import type {
  ApiDefinition,
  ApiStep,
  AssertionResult,
  CaptureResult,
  FailureExplanation,
  Scenario,
} from '@flowqa/shared';
import { UNARY_OPERATORS, pathParameters } from '@flowqa/shared';

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

const OPERATOR_VERBS: Record<string, string> = {
  equals: 'equal',
  'not equals': 'not equal',
  contains: 'contain',
  'not contains': 'not contain',
  'starts with': 'start with',
  'ends with': 'end with',
  'greater than': 'be greater than',
  'less than': 'be less than',
  'greater/equal': 'be at least',
  'less/equal': 'be at most',
  exists: 'exist',
  'not exists': 'not exist',
  'is empty': 'be empty',
  'is not empty': 'not be empty',
  'matches regex': 'match',
};

/** Cari step sebelum `beforeIndex` yang menghasilkan variabel tertentu. */
export function findProducer(scenario: Scenario, variable: string, beforeIndex: number) {
  for (let i = 0; i < Math.min(beforeIndex, scenario.steps.length); i++) {
    const step = scenario.steps[i];
    if (step.type === 'api' && step.captures.some((c) => c.variable === variable)) return { index: i, step };
    if (step.type === 'setVariable' && step.variable === variable) return { index: i, step };
  }
  return undefined;
}

export function explainMissingVariables(
  missing: string[],
  scenario: Scenario,
  index: number,
): FailureExplanation {
  const unique = [...new Set(missing)];
  const detail = unique
    .map((name) => {
      const producer = findProducer(scenario, name, index);
      return producer
        ? `{{${name}}} is captured in step ${producer.index + 1} (${producer.step.name}), but that step didn't run or didn't save a value.`
        : `Nothing earlier in this scenario saves {{${name}}}.`;
    })
    .join(' ');
  return {
    title: `This step needs ${unique.map((n) => `{{${n}}}`).join(', ')}, which has no value yet`,
    detail,
    fix: 'Capture the value in an earlier step (Capture values tab), add it as an environment variable, or run the whole scenario.',
  };
}

export function explainNetworkError(kind: string, message: string, url: string): FailureExplanation {
  if (kind === 'timeout') {
    return {
      title: 'The API did not respond in time',
      detail: message,
      fix: 'Raise the timeout in the step Settings or in the environment, or check that the service is running.',
    };
  }
  return {
    title: 'Could not reach the API',
    detail: `${message} (${url})`,
    fix: 'Check the environment base URL, your network/VPN, and that the service is running.',
  };
}

interface FailureInput {
  step: ApiStep;
  api: ApiDefinition;
  scenario: Scenario;
  index: number;
  status: number;
  body: unknown;
  failedAssertions: AssertionResult[];
  failedCaptures: CaptureResult[];
}

export function explainFailure(input: FailureInput): FailureExplanation {
  const { step, api, scenario, index, status, body, failedAssertions, failedCaptures } = input;
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const apiError =
    typeof payload.error === 'string'
      ? payload.error
      : typeof payload.message === 'string'
        ? payload.message
        : '';
  const said = apiError ? `The API said: “${apiError}”.` : '';
  const isLogin = /login|signin|auth\/token/i.test(api.path);

  if (status === 401 || status === 403) {
    const producer = findProducer(scenario, step.tokenVariable, index);
    return {
      title: isLogin
        ? `Sign-in was rejected (${status} ${STATUS_TEXT[status]})`
        : `The API rejected the access token (${status} ${STATUS_TEXT[status]})`,
      detail: said,
      fix: isLogin
        ? 'Check the username and password variables in the selected environment.'
        : producer
          ? `The token comes from step ${producer.index + 1} (${producer.step.name}). Make sure that step passes and runs before this one.`
          : `Add a Login step before this one and capture its token as ${step.tokenVariable}.`,
    };
  }
  if (status === 404) {
    const params = pathParameters(api.path);
    return {
      title: 'The record was not found (404 Not Found)',
      detail: said,
      fix: params.length
        ? `The ID in the address comes from {{${params[0]}}}. Check that the step which captures it saved the right field.`
        : 'Check the endpoint address in the API Catalog and the environment base URL.',
    };
  }
  if (status === 400 || status === 422) {
    const field = typeof payload.field === 'string' ? payload.field : '';
    return {
      title: `The API refused the data that was sent (${status} ${STATUS_TEXT[status]})`,
      detail: said,
      fix: field
        ? `Look at the “${field}” value on the Request tab.`
        : 'Compare the values on the Request tab with what the API expects.',
    };
  }
  if (status === 409) {
    return {
      title: 'The action is not allowed in the record’s current state (409 Conflict)',
      detail: said,
      fix: 'Check the order of steps — the record may already be paid, cancelled or changed.',
    };
  }
  if (status >= 500) {
    return {
      title: `The server had an error (${status} ${STATUS_TEXT[status] ?? ''})`.trim(),
      detail: said,
      fix: 'This is usually not a test problem. Retry the step (Settings → Retries) or contact the API team.',
    };
  }
  if (failedCaptures.length) {
    const c = failedCaptures[0];
    return {
      title: `Could not find “${c.field}” in the response, so {{${c.variable}}} was not saved`,
      detail: 'Later steps that use this value will not work.',
      fix: 'Open the Capture values tab and pick the field from the response preview.',
    };
  }

  const failed = failedAssertions[0];
  if (!failed)
    return {
      title: `The request was not successful (${status})`,
      detail: said,
      fix: 'Add a status code check to say which status is expected.',
    };
  const assertion = step.assertions.find((a) => a.id === failed.assertionId);

  if (!assertion || assertion.kind === 'status') {
    return {
      title:
        `Expected status ${failed.expected}, but the API returned ${failed.actual} ${STATUS_TEXT[Number(failed.actual)] ?? ''}`.trim(),
      detail: said,
      fix: 'Check the request values, or update the expected status if the API behaviour changed.',
    };
  }
  if (assertion.kind === 'time') {
    return {
      title: `Too slow: the API took ${failed.actual}; the limit is ${failed.expected}`,
      detail: '',
      fix: 'Raise the limit if this is acceptable, or share the timing with the API team.',
    };
  }
  if (assertion.kind === 'schema') {
    return {
      title: 'Some expected fields are missing from the response',
      detail: failed.actual,
      fix: 'Check whether the API changed, or update the required fields list.',
    };
  }

  const verb = OPERATOR_VERBS[assertion.operator] ?? assertion.operator;
  const expectedText = UNARY_OPERATORS.includes(assertion.operator) ? '' : ` ${failed.expected}`;
  let fix = 'Compare the expected value with the actual response on the Response tab.';
  if (assertion.field === 'status' && failed.actual === 'PENDING') {
    fix = 'The record may still be processing. Add a Wait step before this one, or set Retries in Settings.';
  }
  return {
    title: `Expected ${assertion.field} to ${verb}${expectedText}, but it was ${failed.actual}`,
    detail: said,
    fix,
  };
}
