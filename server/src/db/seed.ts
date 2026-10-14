/**
 * Data demo: satu project "Maxxi Sales API" yang menunjuk ke demo API bawaan.
 * Hanya dijalankan bila database kosong dan FLOWQA_SEED != false.
 */
import type { Assertion, BodyField, Capture, Step } from '@flowqa/shared';
import { createId } from '@flowqa/shared';
import { DEMO_PASSWORD } from '../demo/demo-sales-api';
import { demoUiTestInput } from '../demo/demo-web';
import type { Repositories } from '../repositories';
import {
  normalizeApi,
  normalizeEnvironment,
  normalizeProject,
  normalizeScenario,
  normalizeUiTest,
  normalizeSchedule,
} from '../domain/normalizers';
import { FolderService } from '../services/folder-service';
import { computeNextRun } from '../domain/schedule-time';
import { log } from '../lib/log';

const fields = (rows: [string, BodyField['type'], string][]): BodyField[] =>
  rows.map(([field, type, value]) => ({ field, type, value }));
const status = (code: string): Assertion => ({
  id: createId('as'),
  kind: 'status',
  operator: 'equals',
  expected: code,
});
const field = (path: string, operator: Assertion['operator'], expected = ''): Assertion => ({
  id: createId('as'),
  kind: 'field',
  field: path,
  operator,
  expected,
});
const capture = (path: string, variable: string): Capture => ({ id: createId('cp'), field: path, variable });

export function seedDemoData(repos: Repositories, publicUrl: string): void {
  if (repos.projects.count() > 0) return;

  const project = repos.projects.save(
    normalizeProject({
      name: 'Maxxi Sales API',
      description: 'Customer, order and payment services behind the Maxxi sales app (demo).',
      owner: 'Rina Hartono',
      team: 'Sales Platform QA',
      tags: ['sales', 'payments', 'demo'],
    }),
  );
  const envVars = [
    { key: 'API_USER', value: 'qa.tester@maxxi.co', secret: false },
    { key: 'API_PASSWORD', value: DEMO_PASSWORD, secret: true },
    { key: 'CLIENT_ID', value: 'maxxi-web', secret: false },
    { key: 'DEFAULT_SKU', value: 'SKU-1001', secret: false },
  ];
  const dev = repos.environments.save(
    normalizeEnvironment(
      {
        name: 'Development',
        baseUrl: `${publicUrl}/demo-api/live`,
        timeoutMs: 10_000,
        verifySsl: true,
        variables: envVars,
        headers: [{ key: 'X-Client-Id', value: '{{CLIENT_ID}}' }],
      },
      project.id,
    ),
  );
  const staging = repos.environments.save(
    normalizeEnvironment(
      {
        name: 'Staging',
        baseUrl: `${publicUrl}/demo-api/sandbox`,
        timeoutMs: 10_000,
        verifySsl: true,
        variables: envVars,
        headers: [{ key: 'X-Client-Id', value: '{{CLIENT_ID}}' }],
      },
      project.id,
    ),
  );

  const customer = {
    id: 'CUS-10231',
    name: 'John Doe',
    phone: '08123456789',
    email: 'john@example.com',
    status: 'ACTIVE',
    created_at: '2026-09-25T08:00:00Z',
  };
  const order = {
    id: 'ORD-50012',
    customer_id: 'CUS-10231',
    status: 'CREATED',
    items: [{ sku: 'SKU-1001', quantity: 2, price: 125000 }],
    quantity: 2,
    total: 250000,
    currency: 'IDR',
    note: '',
  };
  const payment = {
    id: 'PAY-7781',
    order_id: 'ORD-50012',
    amount: 250000,
    method: 'VA_BCA',
    status: 'PAID',
    paid_at: '2026-09-25T08:02:11Z',
  };

  const folders = new FolderService(repos.apiFolders, repos.apis, 'API');
  const api = ({ group, ...input }: Record<string, unknown>) =>
    repos.apis.save(
      normalizeApi({ ...input, folderId: folders.ensure(project.id, null, String(group)).id }, project.id),
    );
  const apis = {
    login: api({
      name: 'Login',
      method: 'POST',
      path: '/auth/login',
      auth: 'none',
      group: 'Auth',
      description: 'Signs in and returns an access token.',
      body: fields([
        ['email', 'text', '{{API_USER}}'],
        ['password', 'text', '{{API_PASSWORD}}'],
        ['client_id', 'text', '{{CLIENT_ID}}'],
      ]),
      exampleResponse: {
        token: 'eyJhbGciOiJIUzI1NiJ9.sample',
        expires_in: 3600,
        user: { id: 123, name: 'QA Tester', role: 'tester' },
      },
    }),
    logout: api({
      name: 'Logout',
      method: 'POST',
      path: '/auth/logout',
      auth: 'bearer',
      group: 'Auth',
      description: 'Ends the session for the current token.',
      exampleResponse: { message: 'Logged out' },
    }),
    createCustomer: api({
      name: 'Create Customer',
      method: 'POST',
      path: '/api/customers',
      auth: 'bearer',
      group: 'Customers',
      description: 'Registers a new customer.',
      body: fields([
        ['name', 'text', '{{random_name}}'],
        ['phone', 'text', '{{random_phone}}'],
        ['email', 'text', '{{random_email}}'],
      ]),
      exampleResponse: customer,
    }),
    getCustomer: api({
      name: 'Get Customer',
      method: 'GET',
      path: '/api/customers/{customer_id}',
      auth: 'bearer',
      group: 'Customers',
      description: 'Returns one customer by ID.',
      exampleResponse: customer,
    }),
    createOrder: api({
      name: 'Create Order',
      method: 'POST',
      path: '/api/orders',
      auth: 'bearer',
      group: 'Orders',
      description: 'Creates an order for a customer.',
      body: fields([
        ['customer_id', 'text', '{{customer_id}}'],
        ['product_sku', 'text', '{{DEFAULT_SKU}}'],
        ['quantity', 'number', '2'],
      ]),
      exampleResponse: order,
    }),
    getOrder: api({
      name: 'Get Order',
      method: 'GET',
      path: '/api/orders/{order_id}',
      auth: 'bearer',
      group: 'Orders',
      description: 'Returns one order by ID.',
      exampleResponse: order,
    }),
    updateOrder: api({
      name: 'Update Order',
      method: 'PATCH',
      path: '/api/orders/{order_id}',
      auth: 'bearer',
      group: 'Orders',
      description: 'Changes quantity or note on an open order.',
      body: fields([
        ['quantity', 'number', '3'],
        ['note', 'text', 'Please deliver before noon'],
      ]),
      exampleResponse: { ...order, quantity: 3, total: 375000 },
    }),
    cancelOrder: api({
      name: 'Cancel Order',
      method: 'POST',
      path: '/api/orders/{order_id}/cancel',
      auth: 'bearer',
      group: 'Orders',
      description: 'Cancels an order and starts a refund if it was paid.',
      body: fields([['reason', 'text', 'Customer changed their mind']]),
      exampleResponse: {
        id: 'ORD-50012',
        status: 'CANCELLED',
        refund: { status: 'REFUND_INITIATED', amount: 375000 },
      },
    }),
    createPayment: api({
      name: 'Create Payment',
      method: 'POST',
      path: '/api/payments',
      auth: 'bearer',
      group: 'Payments',
      description: 'Pays for an order.',
      body: fields([
        ['order_id', 'text', '{{order_id}}'],
        ['amount', 'number', '{{order_total}}'],
        ['method', 'text', 'VA_BCA'],
      ]),
      exampleResponse: payment,
    }),
    getPayment: api({
      name: 'Get Payment',
      method: 'GET',
      path: '/api/payments/{payment_id}',
      auth: 'bearer',
      group: 'Payments',
      description: 'Returns payment details and status.',
      exampleResponse: payment,
    }),
  };

  const step = (
    apiKey: keyof typeof apis,
    name: string,
    captures: Capture[],
    assertions: Assertion[],
  ): Step => ({
    id: createId('st'),
    type: 'api',
    name,
    apiId: apis[apiKey].id,
    disabled: false,
    continueOnFailure: false,
    bodyMode: 'visual',
    body: structuredClone(apis[apiKey].body),
    bodyJson: '',
    query: [],
    headers: [],
    pathParams: {},
    tokenVariable: 'auth_token',
    captures,
    assertions,
    retries: 0,
    repeat: 1,
    timeoutMs: null,
  });

  const scenarioFolders = new FolderService(repos.scenarioFolders, repos.scenarios, 'scenario');
  const journeys = scenarioFolders.create(project.id, { name: 'End-to-end journeys' }).id;
  const smokeTests = scenarioFolders.create(project.id, { name: 'Smoke tests' }).id;

  const purchase = repos.scenarios.save(
    normalizeScenario(
      {
        name: 'Customer Purchase Flow',
        folderId: journeys,
        description: 'A new customer signs in, orders, pays, then cancels. Checks every hand-off.',
        steps: [
          step(
            'login',
            'Login',
            [capture('token', 'auth_token'), capture('user.id', 'user_id')],
            [status('200'), field('token', 'exists')],
          ),
          step(
            'createCustomer',
            'Create Customer',
            [capture('id', 'customer_id')],
            [status('201'), field('status', 'equals', 'ACTIVE')],
          ),
          step(
            'createOrder',
            'Create Order',
            [capture('id', 'order_id'), capture('total', 'order_total')],
            [status('201'), field('status', 'equals', 'CREATED')],
          ),
          step(
            'getOrder',
            'Check Order',
            [],
            [status('200'), field('customer_id', 'equals', '{{customer_id}}')],
          ),
          step(
            'updateOrder',
            'Update Order',
            [capture('total', 'order_total')],
            [status('200'), field('quantity', 'equals', '3'), field('total', 'equals', '375000')],
          ),
          step('createPayment', 'Create Payment', [capture('id', 'payment_id')], [status('201')]),
          step(
            'getPayment',
            'Verify Payment',
            [],
            [
              status('200'),
              field('status', 'equals', 'PAID'),
              { id: createId('as'), kind: 'time', operator: 'less than', expected: '1500' },
            ],
          ),
          step(
            'cancelOrder',
            'Cancel Order',
            [],
            [
              status('200'),
              field('status', 'equals', 'CANCELLED'),
              field('refund.status', 'equals', 'REFUND_INITIATED'),
            ],
          ),
          step('logout', 'Logout', [], [status('200')]),
        ],
      },
      project.id,
    ),
  );

  repos.scenarios.save(
    normalizeScenario(
      {
        name: 'Cancel Before Payment',
        folderId: journeys,
        description: 'An unpaid order can be cancelled and no refund is created.',
        steps: [
          step('login', 'Login', [capture('token', 'auth_token')], [status('200')]),
          step('createCustomer', 'Create Customer', [capture('id', 'customer_id')], [status('201')]),
          step('createOrder', 'Create Order', [capture('id', 'order_id')], [status('201')]),
          step(
            'cancelOrder',
            'Cancel Order',
            [],
            [status('200'), field('status', 'equals', 'CANCELLED'), field('refund', 'not exists')],
          ),
          step(
            'getOrder',
            'Order shows cancelled',
            [],
            [status('200'), field('status', 'equals', 'CANCELLED')],
          ),
        ],
      },
      project.id,
    ),
  );

  const smoke = repos.scenarios.save(
    normalizeScenario(
      {
        name: 'Login Smoke Test',
        folderId: smokeTests,
        description: 'Fast health check that sign-in works and responds quickly.',
        steps: [
          step(
            'login',
            'Login',
            [capture('token', 'auth_token')],
            [
              status('200'),
              field('token', 'is not empty'),
              { id: createId('as'), kind: 'time', operator: 'less than', expected: '800' },
            ],
          ),
          step('logout', 'Logout', [], [status('200')]),
        ],
      },
      project.id,
    ),
  );

  const schedule = normalizeSchedule(
    { scenarioId: smoke.id, environmentId: dev.id, frequency: '1h', enabled: true },
    project.id,
  );
  repos.schedules.save({ ...schedule, nextRunAt: computeNextRun(schedule) });
  const nightly = normalizeSchedule(
    {
      scenarioId: purchase.id,
      environmentId: staging.id,
      frequency: 'weekdays',
      time: '07:00',
      enabled: false,
    },
    project.id,
  );
  repos.schedules.save({ ...nightly, nextRunAt: null });

  log.info('demo project "Maxxi Sales API" created');

  // Contoh UI test untuk demo shop (/demo-web).
  const uiFolders = new FolderService(repos.uiFolders, repos.uiTests, 'UI test');
  const shopFolder = uiFolders.create(project.id, { name: 'Demo shop' }).id;
  repos.uiTests.save(normalizeUiTest({ ...demoUiTestInput(publicUrl), folderId: shopFolder }, project.id));
}
