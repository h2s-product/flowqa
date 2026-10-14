/**
 * Android automation: selector, page source, capabilities, sdkmanager/adb parser,
 * DeviceLockManager, Mock Mode, Real Android Mode (provider sungguhan terhadap
 * Appium tiruan + perangkat tiruan), Mobile Inspector, dan Settings.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AndroidDevice, MobileAppConfig, UiStep } from '@flowqa/shared';
import { SECRET_MASK } from '@flowqa/shared';
import { fakeAppium } from './fake-appium';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `mobile-artifacts-${process.pid}`);
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');
const { describeSelector, toLocator } = await import('../src/engine/mobile/locators');
const { parsePageSource } = await import('../src/engine/mobile/page-source');
const { buildCapabilities } = await import('../src/engine/mobile/capabilities');
const { randomPolygon } = await import('../src/engine/mobile/mobile-executor');
const { chooseComponents, parseSdkList } = await import('../src/engine/android/sdk');
const { parseAdbDevices } = await import('../src/engine/android/devices');
const { maskSecrets } = await import('../src/engine/android/toolchain');
const { dynamicGenerators } = await import('../src/engine/dynamic-variables');
const { DeviceLockManager } = await import('../src/services/device-lock-manager');

const APP: MobileAppConfig = {
  platform: 'android',
  app: '',
  appPackage: 'com.demo',
  appActivity: '.MainActivity',
  deviceName: '',
  platformVersion: '',
  udid: '',
  noReset: false,
  capabilities: '',
};

const step = (input: Partial<UiStep>): UiStep => normalizeUiStep(input as never);

const until = async (check: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

/** Perangkat tiruan untuk AppiumAndroidDriverProvider (menggantikan adb). */
function fakeProbe(devices: AndroidDevice[]) {
  return {
    devices: async (busy: Set<string>) =>
      devices.map((d) =>
        busy.has(d.id) && d.status === 'CONNECTED' ? { ...d, status: 'BUSY' as const } : d,
      ),
    uiautomator2: async () => true,
    appVersion: async () => '1.2.3',
    logcat: async () => 'I/ActivityManager: Start proc com.demo (password pw-secret-1)',
    startEmulator: () => {},
    waitForBoot: async () => true,
    installApk: async () => {},
    isLocked: async () => false,
  };
}
const EMULATOR: AndroidDevice = {
  id: 'emulator-5554',
  name: 'Pixel_8_API_35',
  type: 'emulator',
  androidVersion: 'Android 15',
  apiLevel: '35',
  connection: 'Emulator',
  status: 'CONNECTED',
  automationReady: true,
  detail: 'Ready',
};

describe('Android selectors, page source, SDK & data', () => {
  it('maps every Android selector type to an Appium strategy', () => {
    assert.deepEqual(toLocator('~add_land'), { using: 'accessibility id', value: 'add_land' });
    assert.deepEqual(toLocator('id=com.demo:id/name'), { using: 'id', value: 'com.demo:id/name' });
    assert.equal(toLocator('//android.widget.Button[@text="OK"]').using, 'xpath');
    assert.deepEqual(toLocator('text=Simpan'), {
      using: '-android uiautomator',
      value: 'new UiSelector().text("Simpan")',
    });
    assert.equal(toLocator('uiautomator=new UiSelector().index(1)').using, '-android uiautomator');
    assert.deepEqual(toLocator('class=android.widget.EditText'), {
      using: 'class name',
      value: 'android.widget.EditText',
    });
    assert.deepEqual(describeSelector('~add_land'), {
      selectorType: 'accessibilityId',
      selector: 'add_land',
    });
    assert.deepEqual(describeSelector('id=com.demo:id/name'), {
      selectorType: 'resourceId',
      selector: 'com.demo:id/name',
    });
    assert.equal(describeSelector('//x').selectorType, 'xpath');
  });

  it('recommends Accessibility ID / Resource ID first and XPath last, with all Android attributes', () => {
    const elements = parsePageSource(
      `<hierarchy><android.widget.FrameLayout bounds="[0,0][1080,2340]">
        <android.widget.Button class="android.widget.Button" package="com.demo" text="Tambah Lahan" resource-id="com.demo:id/add" content-desc="add_land" clickable="true" enabled="true" focusable="true" bounds="[10,20][110,70]"/>
        <android.widget.TextView class="android.widget.TextView" text="Lahan A" resource-id="com.demo:id/row" bounds="[0,100][1080,200]"/>
        <android.widget.TextView class="android.widget.TextView" text="Lahan B" resource-id="com.demo:id/row" bounds="[0,200][1080,300]"/>
        <android.widget.ImageView class="android.widget.ImageView" resource-id="com.demo:id/icon" bounds="[0,300][50,350]"/>
        <android.widget.ImageView class="android.widget.ImageView" resource-id="com.demo:id/icon" bounds="[0,350][50,400]"/>
        <android.widget.EditText class="android.widget.EditText" text="Nama lahan" password="false" resource-id="com.demo:id/name" clickable="true" bounds="[0,400][1080,500]"/>
        <android.widget.EditText class="android.widget.EditText" text="" password="true" resource-id="com.demo:id/pin" clickable="true" bounds="[0,500][1080,600]"/>
      </android.widget.FrameLayout></hierarchy>`,
    );
    const add = elements.find((e) => e.text === 'Tambah Lahan')!;
    assert.equal(add.selectors[0], '~add_land', 'Accessibility ID first');
    assert.equal(add.selectors[1], 'id=com.demo:id/add', 'then Resource ID');
    assert.ok(add.selectors.at(-1)!.startsWith('/hierarchy/'), 'absolute XPath is the last resort');
    assert.equal(add.attributes.package, 'com.demo');
    assert.equal(add.attributes.clickable, 'true');
    assert.equal(add.attributes.focusable, 'true');
    assert.equal(add.attributes.bounds, '[10,20][110,70]');
    const row = elements.find((e) => e.text === 'Lahan B')!;
    assert.equal(
      row.selectors[0],
      'text=Lahan B',
      'a shared resource-id is not unique, so the text (UiSelector) wins',
    );
    const icons = elements.filter((e) => e.resourceId === 'com.demo:id/icon');
    assert.equal(
      icons[1].selectors[0],
      'android=new UiSelector().resourceId("com.demo:id/icon").instance(1)',
    );
    const name = elements.find((e) => e.resourceId === 'com.demo:id/name')!;
    assert.ok(
      !name.selectors.some((s) => s.startsWith('text=')),
      'input text changes, so it is not a selector',
    );
    assert.equal(elements.find((e) => e.resourceId === 'com.demo:id/pin')!.secure, true);
    // Screenshot setengah ukuran → bounds diskalakan.
    const half = parsePageSource(
      `<hierarchy><android.widget.Button class="android.widget.Button" text="OK" bounds="[100,200][300,400]"/></hierarchy>`,
      'android',
      0.5,
    );
    assert.deepEqual(half[0].bounds, { x: 50, y: 100, width: 100, height: 100 });
  });

  it('builds Android W3C capabilities that always start the app fresh', () => {
    const caps = buildCapabilities(
      { ...APP, capabilities: '{"language": "id", "appium:noReset": true}' },
      '{"appium:newCommandTimeout": 600}',
      (t) => t,
      { udid: 'emulator-5554', name: 'Pixel 8', platformVersion: '15' },
    );
    assert.equal(caps.platformName, 'Android');
    assert.equal(caps['appium:automationName'], 'UiAutomator2');
    assert.equal(caps['appium:udid'], 'emulator-5554');
    assert.equal(caps['appium:appPackage'], 'com.demo');
    assert.equal(caps['appium:forceAppLaunch'], true);
    assert.equal(caps['appium:newCommandTimeout'], 600, 'Settings override the defaults');
    assert.equal(caps['appium:language'], 'id', 'keys without a prefix get "appium:"');
    assert.equal(caps['appium:noReset'], true, 'the test overrides Settings');
    assert.throws(() => buildCapabilities({ ...APP, appPackage: '' }, ''), /APK/);
    assert.ok(buildCapabilities({ ...APP, appPackage: '', app: '/apks/app.apk' }, ''));
  });

  it('keeps web-only steps out of Android tests and needs no start URL', () => {
    const test = normalizeUiTest(
      {
        name: 'M',
        target: 'mobile',
        mobile: { ...APP, platform: 'ios' },
        steps: [
          { type: 'assertAttribute', attribute: 'checked', value: 'true' },
          { type: 'drawPolygon', saveAs: 'poly' },
        ],
      },
      'p',
    );
    assert.equal(test.mobile!.platform, 'android', 'Android is the only mobile platform');
    assert.equal(test.steps[0].attribute, 'checked');
    assert.equal(test.steps[1].saveAs, 'poly');
    assert.throws(
      () =>
        normalizeUiTest({ name: 'M', target: 'mobile', mobile: APP, steps: [{ type: 'assertUrl' }] }, 'p'),
      /not available in mobile tests/,
    );
    assert.throws(
      () => normalizeUiTest({ name: 'W', steps: [{ type: 'pressKey' }], startUrl: 'https://x.test' }, 'p'),
      /web tests/,
    );
  });

  it('reads both sdkmanager formats and picks compatible versions without hardcoding', () => {
    const legacy = parseSdkList(
      'Loading...\rInstalled packages:\n  Path | Version | Description | Location\n  ------- | ------- | ------- | -------\n  platforms;android-34 | 3 | Android SDK Platform 34 | platforms/android-34\n',
    );
    assert.deepEqual(
      legacy.installed.map((p) => p.path),
      ['platforms;android-34'],
    );
    const cli = parseSdkList(
      [
        'WARNING: deprecated',
        'Installed packages:',
        '  platform-tools                                 37.0.1      Android SDK Platform-Tools',
        'Available packages:',
        '  platforms/android-35                           2.0.0       Android SDK Platform 35',
        '  platforms/android-36                           2.0.0       Android SDK Platform 36',
        '  platforms/android-37.0                         1.0.0       Android SDK Platform 37',
        '  platforms/android-37.2-beta1                   1.0.0       Beta',
        '  build-tools/35.0.1                             35.0.1      Build-Tools 35.0.1',
        '  build-tools/36.1.0                             36.1.0      Build-Tools 36.1',
        '  build-tools/36.1.0-rc1                         36.1.0-rc.1 rc',
        '  system-images/android-36/google_apis/arm64-v8a 7.0.0       image',
        '  system-images/android-36/google_apis/x86_64    7.0.0       image',
        '  system-images/android-37.0/google_apis/arm64-v8a 1.0.0     image',
        '  system-images/android-37.0/google_apis/x86_64 1.0.0       image',
      ].join('\n'),
    );
    assert.equal(cli.installed[0].path, 'platform-tools');
    assert.ok(
      cli.available.some((p) => p.path === 'system-images;android-36;google_apis;arm64-v8a'),
      '/ → ;',
    );
    const choice = chooseComponents(cli)!;
    assert.equal(
      choice.platform,
      'platforms;android-36',
      'one major below the newest (better UiAutomator2 support)',
    );
    assert.equal(choice.buildTools, 'build-tools;36.1.0', 'matching major, no rc');
    assert.match(choice.systemImage, /^system-images;android-36;google_apis;/);
  });

  it('parses adb devices, including unauthorized phones', () => {
    const devices = parseAdbDevices(
      'List of devices attached\nemulator-5554  device product:sdk model:sdk_gphone64_arm64 device:emu64a\nR58N12345  unauthorized usb:1-1 transport_id:3\n',
    );
    assert.deepEqual(
      devices.map((d) => [d.serial, d.state, d.usb]),
      [
        ['emulator-5554', 'device', false],
        ['R58N12345', 'unauthorized', true],
      ],
    );
  });

  it('generates dynamic Android test data that differs every run', () => {
    const lat = Number(dynamicGenerators.random_latitude());
    const lng = Number(dynamicGenerators.random_longitude());
    assert.ok(lat >= -8.5 && lat <= 5.5 && lng >= 95.5 && lng <= 140.5, 'inside Indonesia');
    const ring = JSON.parse(dynamicGenerators.random_polygon()) as number[][];
    assert.ok(ring.length >= 5, 'at least 4 corners + closing point');
    assert.deepEqual(ring[0], ring.at(-1), 'the ring is closed');
    assert.notEqual(dynamicGenerators.random_polygon(), dynamicGenerators.random_polygon());
    assert.match(dynamicGenerators.random_string(), /^[a-z0-9]{8}$/);
    const screen = randomPolygon({ x: 0, y: 0, width: 1000, height: 1000 }, 5);
    assert.equal(screen.length, 5);
    assert.ok(
      screen.every((p) => p.x > 0 && p.x < 1000 && p.y > 0 && p.y < 1000),
      'inside the element',
    );
  });

  it('masks secrets in logs', () => {
    assert.equal(maskSecrets('typed pw-secret-1 into field', ['pw-secret-1']), 'typed **** into field');
    assert.equal(maskSecrets('https://user:key123@hub.test/wd', []), 'https://user:****@hub.test/wd');
  });

  it('locks one device per session and serves the queue in order', async () => {
    const locks = new DeviceLockManager();
    const order: string[] = [];
    const a = await locks.acquire(['d1'], 'A');
    let queued = 0;
    const b = locks.acquire(['d1'], 'B', () => queued++).then((l) => (order.push('B'), l));
    const c = locks.acquire(['d1'], 'C', () => queued++).then((l) => (order.push('C'), l));
    assert.equal(queued, 2);
    assert.deepEqual([...locks.busyIds()], ['d1']);
    a.release();
    (await b).release();
    (await c).release();
    assert.deepEqual(order, ['B', 'C'], 'first come, first served');
    assert.equal(locks.busyIds().size, 0);
    const two = await Promise.all([locks.acquire(['d1', 'd2'], 'X'), locks.acquire(['d1', 'd2'], 'Y')]);
    assert.deepEqual(two.map((l) => l.udid).sort(), ['d1', 'd2'], 'a free device is used right away');
  });
});

describe('Android runs, Mock & Real mode, Mobile Inspector', () => {
  const appium = fakeAppium();
  let url = '';
  before(async () => {
    url = await appium.listen();
  });
  after(() => appium.server.close());

  const setup = (devices: AndroidDevice[] = [EMULATOR]) => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, undefined as never, null, fakeProbe(devices));
    // Appium "sungguhan" = server tiruan di localhost.
    ctx.appium.save({
      serverUrl: url,
      capabilities: '{"appium:newCommandTimeout": 120}',
      defaultMode: 'emulator',
    });
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    return { repos, ctx, projectId };
  };
  const loginSteps = () => [
    step({ type: 'fill', selectors: ['id=com.demo:id/email'], value: 'qa@demo.test' }),
    step({
      type: 'fill',
      selectors: ['~missing', 'id=com.demo:id/password'],
      value: 'pw-secret-1',
      sensitive: true,
    }),
    step({ type: 'hideKeyboard' }),
    step({ type: 'click', selectors: ['~login'] }),
  ];

  it('runs a test in Mock Mode with every Android step type and stores logs', async () => {
    const { repos, ctx, projectId } = setup();
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Login & orders',
          target: 'mobile',
          mobile: APP,
          steps: [
            step({ type: 'fill', selectors: ['id=com.demo:id/email'], value: 'wrong' }),
            step({ type: 'clearText', selectors: ['id=com.demo:id/email'] }),
            ...loginSteps(),
            step({ type: 'assertText', selectors: ['id=com.demo:id/welcome'], value: 'qa@demo.test' }),
            step({
              type: 'assertAttribute',
              selectors: ['~missing', 'id=com.demo:id/welcome'],
              attribute: 'enabled',
              value: 'true',
            }),
            step({ type: 'assertEach', selectors: ['id=com.demo:id/order'], value: 'Paid' }),
            step({ type: 'scrollTo', selectors: ['text=Order 30 - Paid'], value: 'down' }),
            step({ type: 'longPress', selectors: ['text*=Order 30'] }),
            step({ type: 'drawPolygon', selectors: ['id=com.demo:id/welcome'], value: '5', saveAs: 'poly' }),
            step({ type: 'swipe', value: 'down' }),
            step({ type: 'takeScreenshot' }),
            step({ type: 'pageSource' }),
            step({ type: 'pressKey', value: 'BACK' }),
            step({ type: 'assertVisible', selectors: ['//android.widget.Button[@content-desc="login"]'] }),
            step({ type: 'closeApp' }),
            step({ type: 'launchApp' }),
            step({ type: 'restartApp' }),
          ],
        },
        projectId,
      ),
    );
    const started = ctx.uiRuns.start(test.id, { mode: 'mock' });
    assert.equal(started.target, 'mobile');
    const run = (await ctx.uiRuns.wait(started.id))!;
    assert.equal(
      run.status,
      'passed',
      JSON.stringify(
        run.steps.filter((s) => s.status !== 'passed'),
        null,
        1,
      ),
    );
    assert.equal(run.mobile!.mode, 'mock');
    assert.match(run.browser, /Mock Android/);
    const detail = (type: string) => run.steps.find((s) => s.type === type)!.detail;
    assert.equal(run.steps[3].usedSelector, 'id=com.demo:id/password', 'falls back to the next selector');
    assert.match(detail('assertAttribute')!, /enabled = "true"/);
    assert.match(detail('assertEach')!, /All 10 rows contain "Paid"/);
    assert.equal(detail('scrollTo'), 'Found after 2 scrolls');
    assert.match(detail('drawPolygon')!, /Tapped 5 points/);
    assert.equal(detail('pressKey'), 'Pressed BACK');
    const source = run.steps.find((s) => s.type === 'pageSource')!;
    assert.ok(source.artifact && fs.existsSync(ctx.uiRuns.screenshotPath(run.id, source.artifact)!));
    assert.equal(detail('closeApp'), 'Closed com.demo');
    assert.equal(detail('launchApp'), 'Launched com.demo');
    assert.equal(run.steps[0].screenshot, 'step-1.png');
    const png = fs.readFileSync(ctx.uiRuns.screenshotPath(run.id, 'step-1.png')!);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', 'Mock Mode returns a real PNG');
  });

  it('runs on a "real" Android emulator through Appium and records device & versions', async () => {
    const { repos, ctx, projectId } = setup();
    const test = repos.uiTests.save(
      normalizeUiTest({ name: 'Login', target: 'mobile', mobile: APP, steps: loginSteps() }, projectId),
    );
    const run = (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, {}).id))!;
    assert.equal(run.status, 'passed', run.failureReason);
    assert.deepEqual(
      { ...run.mobile },
      {
        mode: 'emulator',
        device: 'Pixel_8_API_35',
        udid: 'emulator-5554',
        androidVersion: 'Android 15',
        appPackage: 'com.demo',
        appVersion: '1.2.3',
        appiumVersion: '2.11.0',
      },
    );
    const caps = appium.state.sessions.at(-1)!.caps;
    assert.equal(caps['appium:udid'], 'emulator-5554', 'the locked device is used');
    assert.equal(caps['appium:newCommandTimeout'], 120, 'Settings capabilities are applied');
    assert.ok(appium.state.sessions.at(-1)!.deleted, 'the session is closed and the device released');
  });

  it('marks runs that cannot start as ERROR with an actionable code', async () => {
    const make = (ctx: ReturnType<typeof setup>) =>
      ctx.repos.uiTests.save(
        normalizeUiTest({ name: 'X', target: 'mobile', mobile: APP, steps: loginSteps() }, ctx.projectId),
      );
    const none = setup([]);
    const noDevice = (await none.ctx.uiRuns.wait(
      none.ctx.uiRuns.start(make(none).id, { mode: 'device' }).id,
    ))!;
    assert.equal(noDevice.status, 'error');
    assert.equal(noDevice.errorCode, 'NO_DEVICE');
    assert.match(noDevice.failureReason!, /No physical Android device/);

    const phone: AndroidDevice = {
      ...EMULATOR,
      id: 'R58N1',
      type: 'device',
      connection: 'USB',
      status: 'UNAUTHORIZED',
      automationReady: false,
    };
    const locked = setup([phone]);
    const unauthorized = (await locked.ctx.uiRuns.wait(
      locked.ctx.uiRuns.start(make(locked).id, { mode: 'device' }).id,
    ))!;
    assert.equal(unauthorized.errorCode, 'ADB_UNAUTHORIZED');

    const broken = setup();
    appium.state.failCreate = 'Could not find a connected Android device';
    try {
      const failed = (await broken.ctx.uiRuns.wait(broken.ctx.uiRuns.start(make(broken).id, {}).id))!;
      assert.equal(failed.status, 'error');
      assert.equal(failed.errorCode, 'APPIUM_SESSION_FAILED');
      const request = failed.artifacts!.find((a) => a.file === 'session-request.txt')!;
      const text = fs.readFileSync(broken.ctx.uiRuns.screenshotPath(failed.id, request.file)!, 'utf8');
      assert.match(text, /emulator-5554/, 'device is shown');
      assert.match(text, /"appium:automationName": "UiAutomator2"/, 'capabilities are shown');
    } finally {
      appium.state.failCreate = '';
    }
  });

  it('reports a failed step with page source and a masked device log', async () => {
    const { repos, ctx, projectId } = setup();
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Wrong text',
          target: 'mobile',
          mobile: APP,
          steps: [
            ...loginSteps().slice(0, 2),
            step({ type: 'assertText', selectors: ['text=Demo Shop'], value: 'Other Shop', timeoutMs: 600 }),
            step({ type: 'back' }),
          ],
        },
        projectId,
      ),
    );
    const run = (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, {}).id))!;
    assert.equal(run.status, 'failed');
    assert.match(run.steps[2].error!, /Expected text "Other Shop", but the element shows "Demo Shop"/);
    assert.equal(run.steps[3].status, 'skipped');
    const files = run.artifacts!.map((a) => a.file);
    assert.ok(files.includes('failure-page-source.xml') && files.includes('logcat.txt'));
    const logcat = fs.readFileSync(ctx.uiRuns.screenshotPath(run.id, 'logcat.txt')!, 'utf8');
    assert.ok(!logcat.includes('pw-secret-1') && logcat.includes('****'), 'the password is masked in logs');
  });

  it('queues a second run while the only device is busy (ONE DEVICE = ONE SESSION)', async () => {
    const { repos, ctx, projectId } = setup();
    const make = (name: string) =>
      repos.uiTests.save(
        normalizeUiTest(
          { name, target: 'mobile', mobile: APP, steps: [step({ type: 'wait', value: '400' })] },
          projectId,
        ),
      );
    const a = ctx.uiRuns.start(make('A').id, {});
    const b = ctx.uiRuns.start(make('B').id, {});
    await until(() => repos.uiRuns.get(b.id)!.status === 'queued');
    const [ra, rb] = await Promise.all([ctx.uiRuns.wait(a.id), ctx.uiRuns.wait(b.id)]);
    assert.equal(ra!.status, 'passed');
    assert.equal(rb!.status, 'passed');
    assert.ok(rb!.steps[0].startedAt! >= ra!.steps[0].finishedAt!, 'B waited for A to release the device');
  });

  it('inspects, tests selectors, records and saves in Mock Mode; continues on the emulator', async () => {
    const { ctx, projectId } = setup();
    try {
      const started = ctx.inspector.start(projectId, { name: 'Recorded login', mobile: APP, mode: 'mock' });
      await until(() => ctx.inspector.present(ctx.inspector.get(started.id)).status === 'ready');
      const screen = await ctx.inspector.screen(started.id);
      assert.equal(screen.width, 540, 'screenshot pixels (mock renders at half size)');
      const email = screen.elements.find((e) => e.resourceId === 'com.demo:id/email')!;
      assert.equal(email.bounds.width, (1020 - 60) / 2, 'bounds are scaled to the screenshot');
      assert.equal(email.attributes.package, 'com.demo');
      const selector = await ctx.inspector.testSelector(started.id, 'id=com.demo:id/email');
      assert.equal(selector.matches, 1);
      assert.equal(selector.selectorType, 'resourceId');
      const password = screen.elements.find((e) => e.secure)!;
      const login = screen.elements.find((e) => e.accessibilityId === 'login')!;
      assert.ok(
        (
          await ctx.inspector.action(started.id, {
            type: 'fill',
            selectors: email.selectors,
            value: 'qa@demo.test',
          })
        ).ok,
      );
      await ctx.inspector.action(started.id, {
        type: 'fill',
        selectors: password.selectors,
        value: 'pw',
        sensitive: true,
      });
      const bad = await ctx.inspector.action(started.id, { type: 'click', selectors: ['~nope'] });
      assert.equal(bad.ok, false, 'a failed action is reported and not recorded');
      const tap = await ctx.inspector.action(started.id, {
        type: 'click',
        selectors: login.selectors,
        description: 'Tap Button "login"',
      });
      assert.equal(tap.session.steps.length, 3);
      assert.equal(tap.session.steps[1].value, SECRET_MASK, 'secrets are masked in the session');
      const saved = await ctx.inspector.save(started.id, {});
      assert.equal(saved.target, 'mobile');
      assert.deepEqual(
        saved.steps.map((s) => s.type),
        ['fill', 'fill', 'click'],
      );

      // Merekam lanjutan di "emulator": step lama diputar ulang dulu.
      const more = ctx.inspector.start(projectId, { testCaseId: saved.id, mode: 'emulator' });
      await until(() =>
        ['ready', 'failed'].includes(ctx.inspector.present(ctx.inspector.get(more.id)).status),
      );
      assert.equal(ctx.inspector.get(more.id).status, 'ready', ctx.inspector.get(more.id).error);
      assert.match(ctx.inspector.get(more.id).device, /Pixel_8_API_35/);
      await ctx.inspector.action(more.id, { type: 'pressKey', selectors: [], value: 'BACK' });
      const extended = await ctx.inspector.save(more.id, {});
      assert.deepEqual(
        extended.steps.map((s) => s.type),
        ['fill', 'fill', 'click', 'pressKey'],
      );
    } finally {
      await ctx.inspector.closeAll();
    }
  });

  it('keeps Appium settings (masked credentials, default execution mode)', async () => {
    const { ctx } = setup();
    const ok = await ctx.appium.test();
    assert.equal(ok.ok, true);
    const down = await ctx.appium.test({
      serverUrl: 'http://127.0.0.1:9',
      capabilities: '',
      defaultMode: 'mock',
    });
    assert.equal(down.ok, false);
    const cloud = ctx.appium.save({
      serverUrl: 'https://qa-user:key123@hub.example.test/wd/hub',
      capabilities: '',
      defaultMode: 'device',
    });
    assert.equal(cloud.serverUrl, `https://qa-user:${SECRET_MASK}@hub.example.test/wd/hub`);
    assert.equal(cloud.defaultMode, 'device');
    ctx.appium.save({ serverUrl: cloud.serverUrl, capabilities: '' });
    assert.equal(
      ctx.appium.current().serverUrl,
      'https://qa-user:key123@hub.example.test/wd/hub',
      'the mask keeps the key',
    );
    assert.equal(ctx.appium.current().defaultMode, 'device', 'the mode is kept when not sent');
    assert.throws(() => ctx.appium.save({ serverUrl: url, capabilities: 'nope' }), /not valid JSON/);
  });
});

describe('Mobile Inspector foreground app', async () => {
  const { foregroundPackageOf } = await import('../src/services/mobile-inspector-service');
  it('reads the package of the app in front', () => {
    const xml =
      '<hierarchy><android.widget.FrameLayout package="com.google.android.permissioncontroller" bounds="[0,0][10,10]"><android.widget.Button package="com.google.android.permissioncontroller" text="Allow"/></android.widget.FrameLayout></hierarchy>';
    assert.equal(foregroundPackageOf(xml), 'com.google.android.permissioncontroller');
    assert.equal(foregroundPackageOf('<hierarchy/>'), '');
  });
});
