/**
 * Force stop emulator yang BUSY: test yang memakainya dihentikan (Stop), emulator
 * dimatikan, dan kunci perangkat dilepas — tanpa mengganggu pemakai berikutnya.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `force-stop-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');
const { DeviceLockManager } = await import('../src/services/device-lock-manager');

// Serial yang tidak ada: `adb emu kill` gagal cepat dan emulator dianggap sudah mati.
const SERIAL = 'emulator-5998';

async function until(check: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('Force stop a busy emulator', () => {
  it('a released old lease never frees the lock of the next user', async () => {
    const locks = new DeviceLockManager();
    const first = await locks.acquire([SERIAL], 'UI run a');
    assert.equal(locks.forceRelease(SERIAL), true);
    const second = await locks.acquire([SERIAL], 'UI run b');
    first.release(); // run lama akhirnya selesai
    assert.equal(locks.owners().get(SERIAL), 'UI run b', 'still locked by the new user');
    second.release();
    assert.equal(locks.busyIds().size, 0);
    assert.equal(locks.forceRelease(SERIAL), false);
  });

  it('refuses a plain Stop, and Force stop stops the test using the emulator first', async () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, {} as never, null);
    ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Long Android test',
          target: 'mobile',
          mobile: { platform: 'android', app: '', appPackage: 'com.demo', noReset: false },
          steps: [normalizeUiStep({ type: 'wait', value: '20000' })],
        },
        projectId,
      ),
    );
    const started = ctx.uiRuns.start(test.id, { mode: 'mock' });
    await until(() => repos.uiRuns.get(started.id)?.steps[0].status === 'running', 'the test to run');
    // Emulator dipakai run ini.
    await ctx.deviceLocks.acquire([SERIAL], `UI run ${started.id}`);

    await assert.rejects(ctx.android.stopEmulator(SERIAL), /busy .*Force stop/);
    assert.equal(ctx.android.describeDeviceUser?.(`UI run ${started.id}`), 'UI test "Long Android test"');

    const t0 = Date.now();
    const result = await ctx.android.stopEmulator(SERIAL, { force: true, stoppedBy: 'Admin' });
    assert.ok(Date.now() - t0 < 15_000);
    assert.match(result.message, /Stopped UI run/);
    const run = repos.uiRuns.get(started.id)!;
    assert.equal(run.status, 'stopped', 'the test on the emulator was stopped');
    assert.equal(run.stoppedBy, 'Admin');
    assert.ok(!ctx.deviceLocks.busyIds().has(SERIAL), 'the emulator lock is released');
  });
});
