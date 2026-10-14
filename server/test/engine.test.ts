import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Environment } from '@flowqa/shared';
import { compareValues, flattenObject, getByPath } from '@flowqa/shared';
import { VariableContext } from '../src/engine/variable-context';
import { SecretMasker } from '../src/engine/masking';
import { computeNextRun } from '../src/domain/schedule-time';
import { parseOpenApi } from '../src/domain/openapi-import';

const env: Environment = {
  id: 'env',
  projectId: 'p',
  name: 'Test',
  baseUrl: 'http://x',
  timeoutMs: 1000,
  verifySsl: true,
  proxy: '',
  variables: [
    { key: 'API_USER', value: 'qa@x.co', secret: false },
    { key: 'API_PASSWORD', value: 'Sup3rSecret', secret: true },
  ],
  headers: [],
  createdAt: '',
  updatedAt: '',
};

describe('shared utils', () => {
  it('reads nested paths', () => {
    assert.equal(getByPath({ a: { b: [{ c: 5 }] } }, 'a.b.0.c'), 5);
    assert.equal(getByPath({ a: 1 }, 'a.b'), undefined);
  });
  it('flattens objects to leaf paths', () => {
    assert.deepEqual(flattenObject({ a: 1, b: { c: 'x' } }), [
      ['a', 1],
      ['b.c', 'x'],
    ]);
  });
  it('compares numerically when both sides are numbers', () => {
    assert.ok(compareValues(375000, 'equals', '375000'));
    assert.ok(compareValues('10', 'greater than', '9'));
    assert.ok(compareValues(undefined, 'not exists', ''));
    assert.ok(!compareValues('PENDING', 'equals', 'PAID'));
  });
});

describe('VariableContext', () => {
  it('resolves captured, environment and dynamic variables', () => {
    const ctx = new VariableContext(env, { order_id: 'ORD-1' });
    assert.equal(ctx.resolve('/orders/{{order_id}} {{API_USER}}'), '/orders/ORD-1 qa@x.co');
    assert.match(ctx.resolve('{{uuid}}'), /^[0-9a-f-]{36}$/);
  });
  it('reports missing variables', () => {
    const missing: string[] = [];
    new VariableContext(env).resolve('{{nope}}', missing);
    assert.deepEqual(missing, ['nope']);
  });
  it('keeps number type for a whole-variable number field', () => {
    const ctx = new VariableContext(env, { total: 250000 });
    assert.deepEqual(
      ctx.buildBodyFromFields([{ field: 'payment.amount', type: 'number', value: '{{total}}' }]),
      { payment: { amount: 250000 } },
    );
  });
});

describe('SecretMasker', () => {
  it('never leaks secret values', () => {
    const masker = new SecretMasker(env);
    assert.ok(!JSON.stringify(masker.value({ password: 'Sup3rSecret' })).includes('Sup3rSecret'));
  });
});

describe('schedules', () => {
  it('skips weekends for weekday schedules', () => {
    const saturday = new Date(2026, 8, 26, 10, 0); // Sabtu
    const next = new Date(computeNextRun({ frequency: 'weekdays', time: '07:00' }, saturday));
    assert.equal(next.getDay(), 1);
  });

  it('schedules weekly runs on the chosen day and time', () => {
    const wednesday = new Date(2026, 8, 23, 10, 0); // Rabu 23 Sep 2026, 10:00
    const monday = new Date(computeNextRun({ frequency: 'weekly', time: '07:30', day: 1 }, wednesday));
    assert.deepEqual(
      [monday.getDay(), monday.getDate(), monday.getHours(), monday.getMinutes()],
      [1, 28, 7, 30],
    );
    const sameDayLater = new Date(computeNextRun({ frequency: 'weekly', time: '18:00', day: 3 }, wednesday));
    assert.deepEqual([sameDayLater.getDate(), sameDayLater.getHours()], [23, 18], 'later today');
  });
});

describe('OpenAPI import', () => {
  it('parses a minimal OpenAPI 3 YAML file', () => {
    const preview = parseOpenApi(`openapi: 3.0.0
info: {title: Demo, version: '1'}
paths:
  /items/{id}:
    get: {summary: Get item, responses: {'200': {description: ok}}}
  /items:
    post:
      summary: Create item
      requestBody: {content: {application/json: {schema: {type: object, properties: {qty: {type: integer, example: 2}}}}}}
      responses: {'201': {description: ok}}`);
    assert.equal(preview.apis.length, 2);
    assert.deepEqual(preview.apis[1].body, [{ field: 'qty', type: 'number', value: '2' }]);
  });
});
