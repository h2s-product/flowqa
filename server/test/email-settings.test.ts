import assert from 'node:assert/strict';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import { SECRET_MASK } from '@flowqa/shared';
import { createApp } from '../src/app';
import { createAppContext } from '../src/app-context';
import { openDatabase } from '../src/db/database';
import type { HttpClient } from '../src/engine/http-client';
import { createRepositories } from '../src/repositories';
import { EmailSettingsService } from '../src/services/email-settings-service';

const noHttp: HttpClient = { send: () => Promise.reject(new Error('no network in tests')) };
const NO_ENV = {
  smtp: { host: '', port: 587, security: 'starttls' as const, user: '', password: '', from: '' },
  appUrl: 'http://env',
};

/** Server SMTP tiruan: menerima email dan menyimpan isi mentahnya (tanpa TLS / auth). */
function smtpSink() {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let data = '';
    let inData = false;
    socket.write('220 sink ESMTP\r\n');
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\r\n')) {
        if (inData) {
          if (line === '.') {
            inData = false;
            messages.push(data);
            data = '';
            socket.write('250 OK\r\n');
          } else data += `${line}\n`;
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') socket.end('221 bye\r\n');
        else if (line) socket.write('250 OK\r\n');
      }
    });
  });
  return { messages, server };
}

describe('Settings → Email Report', () => {
  const sink = smtpSink();
  let port = 0;
  before(async () => {
    await new Promise<void>((r) => sink.server.listen(0, '127.0.0.1', r));
    port = (sink.server.address() as net.AddressInfo).port;
  });
  after(() => sink.server.close());

  it('saves settings, never returns the password, and keeps it when the mask is sent back', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const service = new EmailSettingsService(repos.settings, NO_ENV);
    assert.equal(service.view().source, 'none');
    assert.equal(service.mailer(), null);

    const saved = service.save({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      user: 'qa@example.com',
      password: 's3cret',
      from: 'Testora <qa@example.com>',
      appUrl: 'https://testora.example.com/',
      recipients: ['qa@example.com', 'Lead@Example.com', 'qa@example.com'],
    });
    assert.deepEqual(saved.recipients, ['qa@example.com', 'lead@example.com'], 'several recipients are kept');
    assert.deepEqual(service.defaultRecipients(), ['qa@example.com', 'lead@example.com']);
    assert.throws(
      () => service.save({ ...saved, password: SECRET_MASK, recipients: ['nope'] }),
      /not a valid email/,
    );
    assert.equal(saved.source, 'app');
    assert.equal(saved.password, SECRET_MASK);
    assert.equal(saved.passwordSet, true);
    assert.equal(service.appUrl(), 'https://testora.example.com');
    assert.equal(service.mailer()?.from, 'Testora <qa@example.com>', 'used right away, no restart');

    service.save({ ...saved, password: SECRET_MASK, port: 465, security: 'ssl' });
    assert.equal(
      repos.settings.get<{ password: string }>('email')!.password,
      's3cret',
      'mask keeps the password',
    );

    assert.throws(() => service.save({ ...saved, host: '' }), /SMTP server/);
    assert.throws(() => service.save({ ...saved, from: 'nope' }), /sender address/);
    assert.throws(() => service.save({ ...saved, port: 70000 }), /port/);

    assert.equal(service.reset().source, 'none');
  });

  it('reads settings saved before report recipients existed', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    // Bentuk lama: belum ada field "recipients".
    repos.settings.set('email', {
      host: 'smtp.old.test',
      port: 587,
      security: 'starttls',
      user: '',
      password: 'x',
      from: 'qa@old.test',
      appUrl: '',
    });
    const service = new EmailSettingsService(repos.settings, NO_ENV);
    assert.deepEqual(service.view().recipients, []);
    assert.deepEqual(service.defaultRecipients(), []);
    assert.equal(service.mailer()?.from, 'qa@old.test');
  });

  it('falls back to .env when nothing is saved in the app', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const service = new EmailSettingsService(repos.settings, {
      smtp: { ...NO_ENV.smtp, host: 'smtp.env.test', password: 'envpass', from: 'env@test.co' },
      appUrl: 'http://env',
    });
    const view = service.view();
    assert.equal(view.source, 'env');
    assert.equal(view.host, 'smtp.env.test');
    assert.equal(view.password, SECRET_MASK);
    assert.equal(service.mailer()?.from, 'env@test.co');
  });

  it('is admin-only over HTTP and sends a real test email through SMTP', async () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, noHttp);
    const app = createApp(ctx);
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/api`;
    const login = async (email: string, password: string) => {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 't' },
        body: JSON.stringify({ email, password }),
      });
      return res.headers.get('set-cookie')!.split(';')[0];
    };
    try {
      await ctx.auth.createUser({ name: 'Admin', email: 'admin@x.co', password: 'admin-pass' });
      await ctx.users.create({
        name: 'Member',
        email: 'member@x.co',
        password: 'member-pass',
        role: 'member',
        projectIds: [],
      });
      const admin = await login('admin@x.co', 'admin-pass');
      const member = await login('member@x.co', 'member-pass');
      const call = (cookie: string, method: string, path: string, body?: unknown) =>
        fetch(`${base}${path}`, {
          method,
          headers: { cookie, 'X-Requested-With': 't', 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });

      assert.equal((await call(member, 'GET', '/settings/email')).status, 403);
      assert.equal((await call(member, 'PUT', '/settings/email', {})).status, 403);

      const settings = {
        host: '127.0.0.1',
        port,
        security: 'none',
        user: '',
        password: '',
        from: 'Testora <qa@testora.test>',
        recipients: ['team@shop.id', 'ops@shop.id'],
      };
      const test = await call(admin, 'POST', '/settings/email/test', {
        to: ['me@shop.id', 'Lead@Shop.id'],
        settings,
      });
      assert.equal(test.status, 200, await test.clone().text());
      assert.deepEqual(await test.json(), { sentTo: ['me@shop.id', 'lead@shop.id'] });
      assert.equal(sink.messages.length, 1);
      assert.match(sink.messages[0], /To: me@shop\.id, lead@shop\.id/);
      const bad = await call(admin, 'POST', '/settings/email/test', { to: ['me@shop.id', 'oops'], settings });
      assert.equal(bad.status, 400);

      const saved = await call(admin, 'PUT', '/settings/email', settings);
      assert.equal(saved.status, 200);
      assert.deepEqual(await (await call(member, 'GET', '/notifications/status')).json(), {
        emailConfigured: true,
        from: 'Testora <qa@testora.test>',
        defaultRecipients: ['team@shop.id', 'ops@shop.id'],
      });
      // Tanpa "to": email percobaan dikirim ke penerima laporan yang tersimpan.
      const toSaved = await call(admin, 'POST', '/settings/email/test', {});
      assert.deepEqual(await toSaved.json(), { sentTo: ['team@shop.id', 'ops@shop.id'] });
    } finally {
      server.close();
    }
  });
});
