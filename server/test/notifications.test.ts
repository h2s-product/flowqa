import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createApp } from '../src/app';
import { createAppContext } from '../src/app-context';
import { openDatabase } from '../src/db/database';
import { renderRunEmail } from '../src/domain/run-email';
import { normalizeEnvironment, normalizeProject, normalizeScenario } from '../src/domain/normalizers';
import type { HttpClient } from '../src/engine/http-client';
import type { MailMessage, Mailer } from '../src/lib/mailer';
import { createRepositories } from '../src/repositories';

const noHttp: HttpClient = { send: () => Promise.reject(new Error('no network in tests')) };

/** Mailer palsu: menyimpan email, tidak mengirim apa pun. */
function fakeMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return { from: 'qa@testora.test', sent, send: async (m) => void sent.push(m) };
}

async function until(check: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
}

function setup(email: { enabled: boolean; recipients: string[]; when?: string }) {
  const repos = createRepositories(openDatabase(':memory:'));
  const mailer = fakeMailer();
  const ctx = createAppContext(repos, noHttp, mailer);
  const project = repos.projects.save(normalizeProject({ name: 'Shop', notifications: { email } }));
  const env = repos.environments.save(
    normalizeEnvironment({ name: 'Dev', baseUrl: 'http://api' }, project.id),
  );
  const scenario = (name: string, failing = false) =>
    repos.scenarios.save(
      normalizeScenario(
        {
          name,
          steps: failing
            ? [{ type: 'api', name: 'Call', method: 'GET', path: '/x' }] // gagal: tidak ada jaringan
            : [{ type: 'wait', name: 'Wait', durationMs: 0 }],
        },
        project.id,
      ),
    );
  return { repos, ctx, mailer, project, env, scenario };
}

describe('email notifications', () => {
  it('emails the result of every run to the project recipients', async () => {
    const { ctx, mailer, env, scenario } = setup({
      enabled: true,
      recipients: ['qa@shop.id', 'lead@shop.id'],
    });
    const run = await ctx.runs.wait(
      ctx.runs.start({ scenarioId: scenario('Checkout <b>').id, environmentId: env.id }).id,
    )!;
    await until(() => mailer.sent.length > 0);
    assert.equal(mailer.sent.length, 1);
    const [mail] = mailer.sent;
    assert.deepEqual(mail.to, ['qa@shop.id', 'lead@shop.id']);
    assert.equal(mail.subject, '✅ Passed · Checkout <b> · Shop');
    assert.match(mail.text, new RegExp(`/runs/${run.id}`));
    assert.ok(
      mail.html.includes('Checkout &lt;b&gt;') && !mail.html.includes('Checkout <b>'),
      'names are escaped',
    );
  });

  it('can send only failures, and sends nothing when turned off', async () => {
    const onlyFailed = setup({ enabled: true, recipients: ['qa@shop.id'], when: 'failed' });
    const ok = onlyFailed.scenario('Passes');
    const bad = onlyFailed.scenario('Fails', true);
    await onlyFailed.ctx.runs.wait(
      onlyFailed.ctx.runs.start({ scenarioId: ok.id, environmentId: onlyFailed.env.id }).id,
    );
    await onlyFailed.ctx.runs.wait(
      onlyFailed.ctx.runs.start({ scenarioId: bad.id, environmentId: onlyFailed.env.id }).id,
    );
    await until(() => onlyFailed.mailer.sent.length > 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(
      onlyFailed.mailer.sent.map((m) => m.subject),
      ['❌ Failed · Fails · Shop'],
    );

    const off = setup({ enabled: false, recipients: ['qa@shop.id'] });
    await off.ctx.runs.wait(
      off.ctx.runs.start({ scenarioId: off.scenario('A').id, environmentId: off.env.id }).id,
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(off.mailer.sent.length, 0);
  });

  it('uses the default recipients from Settings → Email Report when a project has none', async () => {
    const { ctx, mailer, env, scenario } = setup({ enabled: true, recipients: [] });
    ctx.emailSettings.save({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      user: '',
      password: '',
      from: 'qa@testora.test',
      appUrl: '',
      recipients: ['team@shop.id', 'boss@shop.id'],
    });
    await ctx.runs.wait(ctx.runs.start({ scenarioId: scenario('Default').id, environmentId: env.id }).id);
    await until(() => mailer.sent.length > 0);
    assert.deepEqual(mailer.sent[0].to, ['team@shop.id', 'boss@shop.id']);
    assert.deepEqual(ctx.notifications.status().defaultRecipients, ['team@shop.id', 'boss@shop.id']);
  });

  it('sends one summary email for a bulk run instead of one per test', async () => {
    const { ctx, mailer, project, env, scenario } = setup({ enabled: true, recipients: ['qa@shop.id'] });
    const ids = [scenario('One').id, scenario('Two', true).id, scenario('Three').id];
    ctx.runs.startBatch(ids, env.id);
    await until(() => mailer.sent.length > 0, 5000);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(mailer.sent.length, 1);
    assert.equal(mailer.sent[0].subject, `❌ 1 of 3 failed · Run all scenarios · ${project.name}`);
    assert.match(mailer.sent[0].text, /Passed  One[\s\S]*Failed  Two[\s\S]*Passed  Three/);
  });

  it('renders readable run details', () => {
    const mail = renderRunEmail('Shop', {
      kind: 'UI test',
      name: 'Login',
      status: 'failed',
      target: 'Google Chrome · headless',
      startedAt: '2026-09-27T01:00:00.000Z',
      durationMs: 4200,
      counts: { passed: 3, failed: 1, skipped: 2 },
      failure: 'Step 4 · Click "Sign in": not found',
      url: 'http://app/ui/runs/uir_1',
    });
    assert.match(mail.text, /Duration: 4\.2 s/);
    assert.match(mail.text, /Steps: 3 passed · 1 failed · 2 skipped/);
    assert.match(mail.text, /Why it failed: Step 4/);
    assert.match(mail.html, /href="http:\/\/app\/ui\/runs\/uir_1"/);
  });

  it('validates settings and sends a test email over HTTP', async () => {
    const { ctx, repos, mailer, project } = setup({ enabled: false, recipients: [] });
    const app = createApp(ctx);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    try {
      await ctx.auth.createUser({ name: 'Admin', email: 'admin@x.co', password: 'admin-pass' });
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 't' },
        body: JSON.stringify({ email: 'admin@x.co', password: 'admin-pass' }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const call = (method: string, path: string, body?: unknown) =>
        fetch(`${base}${path}`, {
          method,
          headers: { cookie, 'X-Requested-With': 't', 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });

      assert.deepEqual(await (await call('GET', '/notifications/status')).json(), {
        emailConfigured: true,
        from: 'qa@testora.test',
        defaultRecipients: [],
      });
      const invalid = await call('PUT', `/projects/${project.id}`, {
        name: 'Shop',
        notifications: { email: { enabled: true, recipients: 'qa@shop.id, not-an-email' } },
      });
      assert.equal(invalid.status, 400);
      assert.match(((await invalid.json()) as { error: string }).error, /not-an-email/);

      const saved = await call('PUT', `/projects/${project.id}`, {
        name: 'Shop',
        notifications: { email: { enabled: true, recipients: 'QA@shop.id; lead@shop.id', when: 'failed' } },
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(repos.projects.get(project.id)!.notifications, {
        email: { enabled: true, recipients: ['qa@shop.id', 'lead@shop.id'], when: 'failed' },
      });

      const test = await call('POST', `/projects/${project.id}/notifications/test`, {
        recipients: 'me@shop.id',
      });
      assert.deepEqual(await test.json(), { sentTo: ['me@shop.id'] });
      assert.equal(mailer.sent[0].subject, 'Testora test email · Shop');
    } finally {
      server.close();
    }
  });

  it('emails a report with the Reports page attached as HTML', async () => {
    const { ctx, repos, mailer, project, env, scenario } = setup({
      enabled: false,
      recipients: ['qa@shop.id'],
    });
    await ctx.runs.wait(ctx.runs.start({ scenarioId: scenario('Checkout').id, environmentId: env.id }).id);
    await ctx.runs.wait(
      ctx.runs.start({ scenarioId: scenario('Refund', true).id, environmentId: env.id }).id,
    );
    const app = createApp(ctx);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    try {
      await ctx.auth.createUser({ name: 'Admin', email: 'admin@x.co', password: 'admin-pass' });
      const login = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 't' },
        body: JSON.stringify({ email: 'admin@x.co', password: 'admin-pass' }),
      });
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const send = (body: unknown) =>
        fetch(`${base}/projects/${project.id}/reports/email`, {
          method: 'POST',
          headers: { cookie, 'X-Requested-With': 't', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const page =
        '<!doctype html><html><body><div class="report"><b>Report</b><script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">x</a></div></body></html>';

      const res = await send({
        kind: 'api',
        recipients: [],
        message: 'Weekly check',
        html: page,
        fileName: 'my report',
      });
      assert.equal(res.status, 200, await res.clone().text());
      assert.deepEqual(await res.json(), { sentTo: ['qa@shop.id'] }, 'defaults to the project recipients');
      const [mail] = mailer.sent;
      assert.equal(mail.subject, '❌ Test Report · Shop · 1 of 2 scenarios failing');
      assert.match(mail.text, /Weekly check/);
      assert.match(mail.text, /Failing:\n- Refund/);
      assert.equal(mail.attachments?.[0].filename, 'my-report.html');
      assert.equal(mail.attachments?.[0].contentType, 'text/html; charset=utf-8');
      const attached = mail.attachments![0].content;
      assert.ok(attached.includes('<b>Report</b>'));
      assert.ok(!/script|onclick|javascript:/i.test(attached), 'scripts and handlers are removed');

      assert.equal(
        (await send({ kind: 'api', recipients: ['boss@shop.id'] })).status,
        400,
        'attachment required',
      );
      assert.equal((await send({ kind: 'api', recipients: ['nope'], html: page })).status, 400);
      assert.equal(repos.projects.get(project.id)!.name, 'Shop');
    } finally {
      server.close();
    }
  });

  it('explains when email is not set up on the server', async () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, noHttp, null);
    const project = repos.projects.save(normalizeProject({ name: 'P' }));
    assert.deepEqual(ctx.notifications.status(), { emailConfigured: false, from: '', defaultRecipients: [] });
    await assert.rejects(ctx.notifications.sendTest(project.id, ['a@b.co']), /Settings → Email Report/);
  });
});
