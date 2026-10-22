/**
 * Firebase App Distribution terhadap server Google/Firebase tiruan: login
 * Service Account (JWT RS256 diverifikasi), daftar release, unduh APK, pasang ke
 * perangkat, pengecekan otomatis + menjalankan jadwal, dan kunci yang tidak bocor.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AndroidDevice } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `firebase-artifacts-${process.pid}`, 'ui');
const express = (await import('express')).default;
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeApp, normalizeProject, normalizeUiSchedule, normalizeUiTest } =
  await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PROJECT = '123456789012';
const APP = '1:123456789012:android:abc123def456';
/** App Firebase kedua (mis. project MTT). */
const APP2 = '1:123456789012:android:feedbeef0002';

type Release = {
  name: string;
  displayVersion: string;
  buildVersion: string;
  createTime: string;
  kind?: 'aab';
};

function fakeGoogle() {
  const state = {
    tokens: 0,
    releases: [] as Release[],
    /** Release app kedua (APP2). */
    releases2: [] as Release[],
    lastAuth: '',
  };
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  let base = '';
  app.post('/token', (req, res) => {
    const [header, claims, signature] = String(req.body.assertion).split('.');
    const ok = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${claims}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    );
    const c = JSON.parse(Buffer.from(claims, 'base64url').toString());
    if (
      !ok ||
      req.body.grant_type !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' ||
      c.iss !== 'qa-bot@demo.iam.gserviceaccount.com'
    )
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid JWT signature.' });
    assert.equal(c.aud, `${base}/token`);
    assert.equal(c.scope, 'https://www.googleapis.com/auth/cloud-platform');
    state.tokens++;
    res.json({ access_token: 'ya29.fake-token', expires_in: 3600 });
  });
  app.get(`/v1/projects/${PROJECT}/apps/:app/releases`, (req, res) => {
    state.lastAuth = String(req.headers.authorization);
    if (req.headers.authorization !== 'Bearer ya29.fake-token')
      return res.status(401).json({ error: { message: 'unauthenticated' } });
    if (req.params.app !== APP && req.params.app !== APP2)
      return res.status(404).json({ error: { message: 'App not found' } });
    assert.equal(req.query.orderBy, 'createTime desc');
    res.json({
      releases: (req.params.app === APP2 ? state.releases2 : state.releases).map((r) => ({
        name: `projects/${PROJECT}/apps/${req.params.app}/releases/${r.name}`,
        displayVersion: r.displayVersion,
        buildVersion: r.buildVersion,
        createTime: r.createTime,
        releaseNotes: { text: `Notes ${r.displayVersion}` },
        firebaseConsoleUri: 'https://console.firebase.google.com/x',
        binaryDownloadUri: `${base}/download/${r.name}${r.kind === 'aab' ? '?aab=1' : ''}`,
      })),
    });
  });
  app.get('/download/:name', (req, res) => {
    // APK = ZIP ("PK…"); AAB berisi BundleConfig.pb.
    res.send(
      Buffer.concat([
        Buffer.from('PK\x03\x04'),
        Buffer.from(req.query.aab ? 'BundleConfig.pb' : 'AndroidManifest.xml'),
        Buffer.alloc(64),
      ]),
    );
  });
  const server = http.createServer(app);
  return {
    state,
    server,
    listen: () =>
      new Promise<string>((resolve) =>
        server.listen(0, '127.0.0.1', () => {
          base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          resolve(base);
        }),
      ),
  };
}

const EMULATOR: AndroidDevice = {
  id: 'emulator-5554',
  name: 'Pixel_8_API_36',
  type: 'emulator',
  androidVersion: 'Android 16',
  apiLevel: '36',
  connection: 'Emulator',
  status: 'CONNECTED',
  automationReady: true,
  detail: 'Ready',
};

describe('Firebase App Distribution', () => {
  const google = fakeGoogle();
  let base = '';
  const installs: string[] = [];
  let devices: AndroidDevice[] = [EMULATOR];
  before(async () => {
    base = await google.listen();
  });
  after(() => google.server.close());

  const key = () =>
    JSON.stringify({
      type: 'service_account',
      project_id: 'demo-project',
      client_email: 'qa-bot@demo.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `${base}/token`,
    });

  const setup = () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const probe = {
      devices: async () => devices,
      uiautomator2: async () => true,
      appVersion: async () => '',
      logcat: async () => '',
      startEmulator: () => {},
      waitForBoot: async () => true,
      installApk: async (udid: string, apk: string) => {
        installs.push(`${udid}:${path.basename(apk)}`);
      },
      isLocked: async () => false,
    };
    const ctx = createAppContext(repos, undefined as never, null, probe, base);
    // Jangan pernah menyalakan Appium sungguhan dari test: server Appium di alamat yang tidak ada.
    ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '' });
    const project = repos.projects.save(normalizeProject({ name: 'MAXXI ALSINTAN' })).id;
    const androidApp = (name: string, formFactor = '') =>
      repos.apps.save(
        normalizeApp({ name, platform: 'android', android: { app: 'firebase:latest', formFactor } }, project),
      ).id;
    const pid = androidApp('Sales App');
    return { repos, ctx, pid, project, androidApp };
  };

  it('keeps the private key on the server and validates the input', () => {
    const { ctx, pid } = setup();
    assert.throws(
      () => ctx.firebase.save(pid, { serviceAccount: '{"type":"user"}' }),
      /not a service account key/,
    );
    assert.throws(
      () => ctx.firebase.save(pid, { serviceAccount: key(), projectNumber: 'abc', appId: APP }),
      /project number/,
    );
    assert.throws(
      () => ctx.firebase.save(pid, { serviceAccount: key(), projectNumber: PROJECT, appId: 'com.demo' }),
      /App ID/,
    );
    const view = ctx.firebase.save(pid, { serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    assert.equal(view.keySet, true);
    assert.equal(view.configured, true);
    assert.equal(view.serviceAccountEmail, 'qa-bot@demo.iam.gserviceaccount.com');
    assert.ok(!JSON.stringify(view).includes('PRIVATE KEY'), 'the private key never leaves the server');
    // Menyimpan tanpa key = key lama dipertahankan.
    assert.equal(ctx.firebase.save(pid, { intervalMinutes: 1 }).keySet, true);
    assert.equal(ctx.firebase.view(pid).intervalMinutes, 5, 'the interval has a minimum');
    assert.throws(() => ctx.firebase.save(pid, { runSchedule: true, scheduleId: 'nope' }), /schedule/);
    assert.equal(ctx.firebase.reset(pid).keySet, false);
  });

  it('signs in with the service account, lists releases and downloads & installs an APK', async () => {
    const { ctx, pid } = setup();
    google.state.releases = [
      { name: 'r1', displayVersion: '1.0.0', buildVersion: '10', createTime: '2026-09-01T00:00:00Z' },
      { name: 'r2', displayVersion: '1.1.0', buildVersion: '11', createTime: '2026-09-20T00:00:00Z' },
    ];
    ctx.firebase.save(pid, { serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    const test = await ctx.firebase.test(pid);
    assert.equal(test.ok, true, test.message);
    assert.match(test.message, /Latest release: 1\.1\.0 \(11\)/);
    const wrong = await ctx.firebase.test(pid, { appId: '1:123456789012:android:ffff000000' });
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /Not found/);

    const releases = await ctx.firebase.releases(pid);
    assert.deepEqual(
      releases.map((r) => r.displayVersion),
      ['1.1.0', '1.0.0'],
      'newest first',
    );
    assert.equal(releases[0].releaseNotes, 'Notes 1.1.0');
    assert.equal(releases[0].downloaded, false);
    const apk = await ctx.firebase.download(pid, 'r2');
    assert.equal(apk.name, 'firebase-1.1.0-11-r2.apk');
    assert.ok(fs.existsSync(apk.path));
    assert.equal((await ctx.firebase.releases(pid))[0].downloaded, true);
    const done = await ctx.firebase.install(pid, 'latest', { mode: 'emulator' });
    assert.equal(done.release, '1.1.0 (11)');
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.1.0-11-r2.apk');
    assert.equal(google.state.tokens, 1, 'the access token is cached');
    assert.equal(ctx.firebase.events(pid)[0].kind, 'install');
  });

  it('refuses app bundles and reports a missing device', async () => {
    const { ctx, pid } = setup();
    google.state.releases = [
      {
        name: 'b1',
        displayVersion: '2.0.0',
        buildVersion: '20',
        createTime: '2026-09-25T00:00:00Z',
        kind: 'aab',
      },
    ];
    ctx.firebase.save(pid, { serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    await assert.rejects(ctx.firebase.download(pid, 'latest'), /Android App Bundle/);
    google.state.releases = [
      { name: 'r3', displayVersion: '1.2.0', buildVersion: '12', createTime: '2026-09-26T00:00:00Z' },
    ];
    devices = [];
    try {
      await assert.rejects(
        ctx.firebase.install(pid, 'latest', { mode: 'device' }),
        /No Android phone is connected/,
      );
    } finally {
      devices = [EMULATOR];
    }
  });

  it('checks for new releases, installs them once, and optionally runs a test schedule', async () => {
    const { ctx, repos, pid, project } = setup();
    const projectId = project;
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Smoke',
          target: 'mobile',
          mobile: { appPackage: 'com.demo', app: 'firebase:latest' },
          steps: [{ type: 'wait', value: '10' }],
        },
        projectId,
      ),
    );
    const schedule = repos.uiSchedules.save(
      normalizeUiSchedule({ name: 'Smoke Test', testIds: [test.id] }, projectId),
    );
    google.state.releases = [
      { name: 'r5', displayVersion: '1.5.0', buildVersion: '15', createTime: '2026-09-27T00:00:00Z' },
    ];
    ctx.firebase.save(pid, {
      serviceAccount: key(),
      projectNumber: PROJECT,
      appId: APP,
      autoInstall: true,
      installMode: 'emulator',
    });

    const first = await ctx.firebase.checkNow(pid);
    assert.equal(first.kind, 'install', first.message);
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.5.0-15-r5.apk');
    assert.equal(ctx.firebase.view(pid).lastSeenRelease.endsWith('/r5'), true);
    const again = await ctx.firebase.checkNow(pid);
    assert.match(again.message, /No new release/, 'the same release is not installed twice');

    // Release baru + toggle "jalankan jadwal".
    ctx.firebase.save(pid, { runSchedule: true, scheduleId: schedule.id });
    google.state.releases.unshift({
      name: 'r6',
      displayVersion: '1.6.0',
      buildVersion: '16',
      createTime: '2026-09-28T00:00:00Z',
    });
    const next = await ctx.firebase.checkNow(pid);
    assert.equal(next.kind, 'schedule', next.message);
    assert.match(next.message, /Started "Smoke Test" \(1 test\) on 1\.6\.0 \(16\)/);
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.6.0-16-r6.apk');
    const kinds = ctx.firebase.events(pid).map((e) => e.kind);
    assert.deepEqual(kinds.slice(0, 4), ['schedule', 'install', 'download', 'check'], 'newest first');

    // Build baru dengan nomor versi yang SAMA (tim sering selalu mengunggah "1.6.0 (16)"):
    // tetap diunduh & dipasang sebagai file terpisah, bukan memakai APK lama dari cache.
    google.state.releases.unshift({
      name: 'r7',
      displayVersion: '1.6.0',
      buildVersion: '16',
      createTime: '2026-09-29T00:00:00Z',
    });
    const sameVersion = await ctx.firebase.checkNow(pid);
    assert.notEqual(sameVersion.kind, 'check', sameVersion.message);
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.6.0-16-r7.apk');
  });

  it('turns a failed check into an event instead of crashing', async () => {
    const { ctx, pid } = setup();
    ctx.firebase.save(pid, {
      serviceAccount: key(),
      projectNumber: PROJECT,
      appId: '1:123456789012:android:0000000000',
    });
    const failed = await ctx.firebase.checkNow(pid);
    assert.equal(failed.kind, 'error');
    assert.match(failed.message, /Checking Firebase failed: Not found/);
  });
  it('keeps a separate Firebase connection per app (FO Apps vs Agro Apps)', async () => {
    const { ctx, repos, pid: fo, project, androidApp } = setup();
    const agro = androidApp('Agro Apps', 'tablet');
    google.state.releases = [
      { name: 'a1', displayVersion: '1.0', buildVersion: '1', createTime: '2026-10-01T00:00:00Z' },
    ];
    google.state.releases2 = [
      { name: 'm9', displayVersion: '3.2.0', buildVersion: '32', createTime: '2026-10-02T00:00:00Z' },
    ];
    ctx.firebase.save(fo, { serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    assert.equal(ctx.firebase.view(agro).configured, false, 'a new app starts without a connection');
    ctx.firebase.save(agro, {
      serviceAccount: key(),
      projectNumber: PROJECT,
      appId: APP2,
      intervalMinutes: 60,
    });
    assert.equal(ctx.firebase.view(fo).appId, APP);
    assert.equal(ctx.firebase.view(agro).appId, APP2);
    assert.equal(ctx.firebase.view(fo).intervalMinutes, 15, 'settings do not leak between apps');
    assert.deepEqual(
      (await ctx.firebase.releases(agro)).map((r) => r.displayVersion),
      ['3.2.0'],
      'each app lists the releases of its own Firebase app',
    );
    assert.match(await ctx.firebase.latestApk(fo), /firebase-1\.0-1-a1\.apk$/);
    assert.match(await ctx.firebase.latestApk(agro), /firebase-3\.2\.0-32-m9\.apk$/);
    // Jadwal milik project lain tidak bisa dipilih.
    const other = repos.projects.save(normalizeProject({ name: 'Other' })).id;
    const smoke = repos.uiTests.save(
      normalizeUiTest(
        { name: 'Smoke', startUrl: 'https://x.test', steps: [{ type: 'wait', value: '10' }] },
        other,
      ),
    );
    const foreign = repos.uiSchedules.save(
      normalizeUiSchedule({ name: 'Other smoke', testIds: [smoke.id] }, other),
    );
    assert.throws(
      () => ctx.firebase.save(agro, { runSchedule: true, scheduleId: foreign.id }),
      /of this project/,
    );
    // Agro Apps = tablet: hanya dipasang ke tablet; HP emulator ditolak.
    devices = [{ ...EMULATOR, formFactor: 'phone' }];
    try {
      await assert.rejects(ctx.firebase.install(agro, 'latest', { mode: 'emulator' }), /tablet/);
      devices = [
        { ...EMULATOR, formFactor: 'phone' },
        { ...EMULATOR, id: 'emulator-5556', formFactor: 'tablet' },
      ];
      assert.match(
        (await ctx.firebase.install(agro, 'latest', { mode: 'emulator' })).device,
        /emulator-5556/,
      );
    } finally {
      devices = [EMULATOR];
    }
    // Riwayat & disconnect per app.
    const before = ctx.firebase.events(fo).length;
    await ctx.firebase.checkNow(agro);
    assert.equal(ctx.firebase.events(fo).length, before, 'activity is per app');
    assert.equal(ctx.firebase.reset(agro).keySet, false);
    assert.equal(ctx.firebase.view(fo).keySet, true, 'disconnecting Agro Apps keeps FO Apps');
    // App dihapus → koneksinya ikut dibuang; project dihapus → koneksi app-nya juga.
    ctx.firebase.save(agro, { serviceAccount: key(), projectNumber: PROJECT, appId: APP2 });
    ctx.apps.delete(project, agro);
    assert.equal(repos.settings.get(`firebase:app:${agro}`), undefined);
    ctx.deletion.deleteProject(project);
    assert.equal(repos.settings.get(`firebase:app:${fo}`), undefined);
  });

  it('moves the old global Firebase connection to an Android app of MAXXI ALSINTAN', () => {
    const repos = createRepositories(openDatabase(':memory:'));
    repos.projects.save(normalizeProject({ name: 'MTT' }));
    const alsintan = repos.projects.save(normalizeProject({ name: 'MAXXI ALSINTAN' })).id;
    repos.settings.set('firebase', {
      serviceAccount: key(),
      projectNumber: PROJECT,
      appId: APP,
      intervalMinutes: 30,
    });
    repos.settings.set('firebase-state', { lastSeenRelease: 'x/r1', lastCheckAt: '', events: [] });
    const ctx = createAppContext(repos, undefined as never, null, undefined, base);
    const [app] = ctx.apps.list(alsintan);
    assert.equal(app?.platform, 'android');
    const view = ctx.firebase.view(app.id);
    assert.equal(view.configured, true);
    assert.equal(view.intervalMinutes, 30);
    assert.equal(view.lastSeenRelease, 'x/r1');
    assert.equal(repos.settings.get('firebase'), undefined, 'the old global key is removed');
    ctx.firebase.close();
  });
});
