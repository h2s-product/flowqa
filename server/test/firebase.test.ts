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
const { normalizeProject, normalizeUiSchedule, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PROJECT = '123456789012';
const APP = '1:123456789012:android:abc123def456';

function fakeGoogle() {
  const state = {
    tokens: 0,
    releases: [] as {
      name: string;
      displayVersion: string;
      buildVersion: string;
      createTime: string;
      kind?: 'aab';
    }[],
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
    if (req.params.app !== APP) return res.status(404).json({ error: { message: 'App not found' } });
    assert.equal(req.query.orderBy, 'createTime desc');
    res.json({
      releases: state.releases.map((r) => ({
        name: `projects/${PROJECT}/apps/${APP}/releases/${r.name}`,
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
    return { repos, ctx };
  };

  it('keeps the private key on the server and validates the input', () => {
    const { ctx } = setup();
    assert.throws(
      () => ctx.firebase.save({ serviceAccount: '{"type":"user"}' }),
      /not a service account key/,
    );
    assert.throws(
      () => ctx.firebase.save({ serviceAccount: key(), projectNumber: 'abc', appId: APP }),
      /project number/,
    );
    assert.throws(
      () => ctx.firebase.save({ serviceAccount: key(), projectNumber: PROJECT, appId: 'com.demo' }),
      /App ID/,
    );
    const view = ctx.firebase.save({ serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    assert.equal(view.keySet, true);
    assert.equal(view.configured, true);
    assert.equal(view.serviceAccountEmail, 'qa-bot@demo.iam.gserviceaccount.com');
    assert.ok(!JSON.stringify(view).includes('PRIVATE KEY'), 'the private key never leaves the server');
    // Menyimpan tanpa key = key lama dipertahankan.
    assert.equal(ctx.firebase.save({ intervalMinutes: 1 }).keySet, true);
    assert.equal(ctx.firebase.view().intervalMinutes, 5, 'the interval has a minimum');
    assert.throws(() => ctx.firebase.save({ runSchedule: true, scheduleId: 'nope' }), /schedule/);
    assert.equal(ctx.firebase.reset().keySet, false);
  });

  it('signs in with the service account, lists releases and downloads & installs an APK', async () => {
    const { ctx } = setup();
    google.state.releases = [
      { name: 'r1', displayVersion: '1.0.0', buildVersion: '10', createTime: '2026-09-01T00:00:00Z' },
      { name: 'r2', displayVersion: '1.1.0', buildVersion: '11', createTime: '2026-09-20T00:00:00Z' },
    ];
    ctx.firebase.save({ serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    const test = await ctx.firebase.test();
    assert.equal(test.ok, true, test.message);
    assert.match(test.message, /Latest release: 1\.1\.0 \(11\)/);
    const wrong = await ctx.firebase.test({ appId: '1:123456789012:android:ffff000000' });
    assert.equal(wrong.ok, false);
    assert.match(wrong.message, /Not found/);

    const releases = await ctx.firebase.releases();
    assert.deepEqual(
      releases.map((r) => r.displayVersion),
      ['1.1.0', '1.0.0'],
      'newest first',
    );
    assert.equal(releases[0].releaseNotes, 'Notes 1.1.0');
    assert.equal(releases[0].downloaded, false);
    const apk = await ctx.firebase.download('r2');
    assert.equal(apk.name, 'firebase-1.1.0-11-r2.apk');
    assert.ok(fs.existsSync(apk.path));
    assert.equal((await ctx.firebase.releases())[0].downloaded, true);
    const done = await ctx.firebase.install('latest', { mode: 'emulator' });
    assert.equal(done.release, '1.1.0 (11)');
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.1.0-11-r2.apk');
    assert.equal(google.state.tokens, 1, 'the access token is cached');
    assert.equal(ctx.firebase.events()[0].kind, 'install');
  });

  it('refuses app bundles and reports a missing device', async () => {
    const { ctx } = setup();
    google.state.releases = [
      {
        name: 'b1',
        displayVersion: '2.0.0',
        buildVersion: '20',
        createTime: '2026-09-25T00:00:00Z',
        kind: 'aab',
      },
    ];
    ctx.firebase.save({ serviceAccount: key(), projectNumber: PROJECT, appId: APP });
    await assert.rejects(ctx.firebase.download('latest'), /Android App Bundle/);
    google.state.releases = [
      { name: 'r3', displayVersion: '1.2.0', buildVersion: '12', createTime: '2026-09-26T00:00:00Z' },
    ];
    devices = [];
    try {
      await assert.rejects(
        ctx.firebase.install('latest', { mode: 'device' }),
        /No Android phone is connected/,
      );
    } finally {
      devices = [EMULATOR];
    }
  });

  it('checks for new releases, installs them once, and optionally runs a test schedule', async () => {
    const { ctx, repos } = setup();
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
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
    ctx.firebase.save({
      serviceAccount: key(),
      projectNumber: PROJECT,
      appId: APP,
      autoInstall: true,
      installMode: 'emulator',
    });

    const first = await ctx.firebase.checkNow();
    assert.equal(first.kind, 'install', first.message);
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.5.0-15-r5.apk');
    assert.equal(ctx.firebase.view().lastSeenRelease.endsWith('/r5'), true);
    const again = await ctx.firebase.checkNow();
    assert.match(again.message, /No new release/, 'the same release is not installed twice');

    // Release baru + toggle "jalankan jadwal".
    ctx.firebase.save({ runSchedule: true, scheduleId: schedule.id });
    google.state.releases.unshift({
      name: 'r6',
      displayVersion: '1.6.0',
      buildVersion: '16',
      createTime: '2026-09-28T00:00:00Z',
    });
    const next = await ctx.firebase.checkNow();
    assert.equal(next.kind, 'schedule', next.message);
    assert.match(next.message, /Started "Smoke Test" \(1 test\) on 1\.6\.0 \(16\)/);
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.6.0-16-r6.apk');
    const kinds = ctx.firebase.events().map((e) => e.kind);
    assert.deepEqual(kinds.slice(0, 4), ['schedule', 'install', 'download', 'check'], 'newest first');

    // Build baru dengan nomor versi yang SAMA (tim sering selalu mengunggah "1.6.0 (16)"):
    // tetap diunduh & dipasang sebagai file terpisah, bukan memakai APK lama dari cache.
    google.state.releases.unshift({
      name: 'r7',
      displayVersion: '1.6.0',
      buildVersion: '16',
      createTime: '2026-09-29T00:00:00Z',
    });
    const sameVersion = await ctx.firebase.checkNow();
    assert.notEqual(sameVersion.kind, 'check', sameVersion.message);
    assert.equal(installs.at(-1), 'emulator-5554:firebase-1.6.0-16-r7.apk');
  });

  it('turns a failed check into an event instead of crashing', async () => {
    const { ctx } = setup();
    ctx.firebase.save({
      serviceAccount: key(),
      projectNumber: PROJECT,
      appId: '1:123456789012:android:0000000000',
    });
    const failed = await ctx.firebase.checkNow();
    assert.equal(failed.kind, 'error');
    assert.match(failed.message, /Checking Firebase failed: Not found/);
  });
});
