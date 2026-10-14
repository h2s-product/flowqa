/**
 * Manual Book: HTML mandiri berisi langkah-langkah test + screenshot run
 * (gambar disisipkan), nilai rahasia disamarkan, bisa diunduh lewat API.
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `manual-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');
const { createApp } = await import('../src/app');
const { actionText } = await import('../src/domain/manual-book');

describe('Manual Book (HTML)', () => {
  const repos = createRepositories(openDatabase(':memory:'));
  const ctx = createAppContext(repos, { send: () => Promise.reject(new Error('no network')) } as never, null);
  ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
  const app = createApp(ctx);
  let server: ReturnType<typeof app.listen>;
  let base = '';
  let cookie = '';
  const projectId = repos.projects.save(normalizeProject({ name: 'Maxxi Sales' })).id;
  const folder = repos.uiFolders.save({
    id: 'fld_a',
    projectId,
    parentId: null,
    name: 'SALES APP',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as never);
  const test = repos.uiTests.save(
    normalizeUiTest(
      {
        name: 'Login & lihat pesanan',
        description: 'Login lalu pastikan pesanan tampil.',
        target: 'mobile',
        folderId: folder.id,
        mobile: { platform: 'android', app: '', appPackage: 'com.demo' },
        steps: [
          {
            type: 'fill',
            selectors: ['id=com.demo:id/email'],
            value: '{{MOBILE_USER}}',
            description: 'Isi email',
          },
          {
            type: 'fill',
            selectors: ['id=com.demo:id/password'],
            value: 'super-secret-pw',
            sensitive: true,
            description: 'Isi kata sandi',
          },
          { type: 'click', selectors: ['~login'], description: 'Tap Masuk' },
          {
            type: 'assertVisible',
            selectors: ['id=com.demo:id/order'],
            description: 'Daftar pesanan tampil',
            onFailPass: true,
          },
        ].map((s) => normalizeUiStep(s)),
      },
      projectId,
    ),
  );
  const get = (p: string) => fetch(`${base}/api${p}`, { headers: { cookie, 'X-Requested-With': 'test' } });

  before(async () => {
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await ctx.auth.createUser({ name: 'Admin', email: 'admin@x.co', password: 'admin-pass' });
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'test' },
      body: JSON.stringify({ email: 'admin@x.co', password: 'admin-pass' }),
    });
    cookie = res.headers.get('set-cookie')!.split(';')[0];
  });
  after(() => server?.close());

  it('writes clear Indonesian instructions per step', () => {
    assert.equal(
      actionText(normalizeUiStep({ type: 'click', selectors: ['x'] }), true),
      'Tap elemen yang dimaksud',
    );
    assert.equal(
      actionText(normalizeUiStep({ type: 'fill', selectors: ['x'], value: 'Budi' }), false),
      'Isi kolom dengan “Budi”',
    );
    assert.equal(
      actionText(normalizeUiStep({ type: 'assertColor', selectors: ['x'], value: 'red' }), false),
      'Pastikan warna elemen “red”',
    );
  });

  it('without a run: steps only, with a hint to run the test', async () => {
    const res = await get(`/ui-tests/${test.id}/manual`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Belum ada run/);
    assert.ok(!html.includes('data:image'));
  });

  it('downloads a standalone HTML with the steps and the screenshots of the latest run', async () => {
    const run = (await ctx.uiRuns.wait(
      ctx.uiRuns.start(test.id, { mode: 'mock', initialVariables: { MOBILE_USER: 'qa@demo.test' } }).id,
    ))!;
    assert.equal(run.status, 'passed', run.failureReason);
    const res = await get(`/ui-tests/${test.id}/manual`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(
      res.headers.get('content-disposition') ?? '',
      /attachment; .*Manual%20Book%20-%20TC-0001%20-%20Login%20%26%20lihat%20pesanan\.html/,
    );
    const html = await res.text();
    assert.match(html, /<span class="code">TC-0001<\/span>/);
    assert.match(html, /Login &amp; lihat pesanan/);
    assert.match(html, /Maxxi Sales/);
    assert.match(html, /SALES APP/);
    assert.match(html, /Android · com\.demo/);
    assert.equal(
      (html.match(/<img src="data:image\/png;base64,/g) ?? []).length,
      4,
      'one embedded screenshot per step',
    );
    assert.match(html, /\{\{MOBILE_USER\}\}/);
    assert.ok(!html.includes('super-secret-pw'), 'the secret value is masked');
    assert.match(html, /Nilai rahasia disamarkan/);
    assert.match(html, /Hasil yang diharapkan/);
    assert.match(html, /pengujian selesai dan dianggap lulus/);
    // Dari run tertentu & tampil di browser.
    const inline = await get(`/ui-tests/${test.id}/manual?runId=${run.id}&inline=1`);
    assert.match(inline.headers.get('content-disposition') ?? '', /^inline/);
    assert.equal((await get(`/ui-tests/${test.id}/manual?runId=uir_other`)).status, 404);
  });
});
