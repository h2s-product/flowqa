/**
 * AndroidEnvironmentManager: preflight semua dependency Android automation di
 * Mac user. Setiap status READY berasal dari perintah yang benar-benar
 * berhasil dijalankan (mis. `adb version`), bukan dari folder yang ditemukan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AndroidDependency, AndroidEnvironmentReport, DependencyStatus } from '@flowqa/shared';
import { nowIso } from '../../lib/time';
import { appiumInstallInfo } from './appium-server';
import { avdConfig, listAvds } from './devices';
import { listPackages } from './sdk';
import { run, toolchain } from './toolchain';

type Dep = Omit<AndroidDependency, 'fixable'> & { fixable?: boolean };

const firstLine = (text: string) => text.trim().split('\n')[0]?.trim() ?? '';

/** Periksa satu perintah versi; READY hanya bila exit code 0. */
async function versionCheck(
  base: Pick<Dep, 'id' | 'label' | 'group'>,
  cmd: string,
  args: string[],
  parse: (out: string) => string = firstLine,
  missing: DependencyStatus = 'NOT_INSTALLED',
  extra: Partial<Dep> = {},
): Promise<Dep> {
  const command = `${cmd || base.id} ${args.join(' ')}`;
  if (!cmd) return { ...base, status: missing, detail: 'Not found on this computer.', command, ...extra };
  const result = await run(cmd, args, { timeoutMs: 30_000 });
  if (!result.ok)
    return {
      ...base,
      status: result.error === 'not found' ? missing : 'ERROR',
      path: cmd,
      detail: `The command failed: ${result.error}`,
      command,
      ...extra,
    };
  return {
    ...base,
    status: 'READY',
    version: parse(`${result.stdout}\n${result.stderr}`),
    path: cmd,
    detail: 'Working',
    command,
    ...extra,
  };
}

export class AndroidEnvironmentManager {
  constructor(private readonly appiumUrl: () => string) {}

  async check(): Promise<AndroidEnvironmentReport> {
    const tc = toolchain();
    const deps: Dep[] = [];
    const which = async (name: string) =>
      (await run('/usr/bin/which', [name], { timeoutMs: 5_000 })).stdout.trim();

    // ----- system
    deps.push(
      process.platform === 'darwin'
        ? await versionCheck(
            { id: 'macos', label: 'macOS', group: 'system' },
            '/usr/bin/sw_vers',
            ['-productVersion'],
            (o) => `${firstLine(o)} (${os.arch()})`,
          )
        : {
            id: 'macos',
            label: 'macOS',
            group: 'system',
            status: 'NOT_FOUND',
            detail: `This server runs on ${process.platform}; the setup assistant supports macOS.`,
          },
    );
    deps.push(
      await versionCheck({ id: 'node', label: 'Node.js', group: 'system' }, process.execPath, ['--version']),
    );
    deps.push(
      await versionCheck({ id: 'npm', label: 'npm', group: 'system' }, (await which('npm')) || '', [
        '--version',
      ]),
    );
    deps.push(
      await versionCheck(
        { id: 'python', label: 'Python 3', group: 'system' },
        (await which('python3')) || '',
        ['--version'],
      ),
    );
    deps.push(
      await versionCheck(
        { id: 'pip', label: 'pip', group: 'system' },
        (await which('pip3')) || '',
        ['--version'],
        (o) => firstLine(o).split(' from ')[0],
      ),
    );

    // ----- java: /usr/bin/java di macOS hanyalah stub, jadi JAVA_HOME/bin/java yang dicek.
    deps.push(
      await versionCheck(
        { id: 'java', label: 'Java (JDK 17+)', group: 'java' },
        tc.javaHome ? `${tc.javaHome}/bin/java` : '',
        ['-version'],
        (o) => firstLine(o),
        'NOT_INSTALLED',
        { fixable: true, detail: '' },
      ).then((d) =>
        d.status === 'READY'
          ? { ...d, detail: `JAVA_HOME=${tc.javaHome}` }
          : { ...d, detail: d.detail || 'No JDK found (the /usr/bin/java stub on macOS is not a JDK).' },
      ),
    );

    // ----- Android SDK
    const sdkReady = !!tc.sdkRoot;
    deps.push({
      id: 'androidSdk',
      label: 'Android SDK',
      group: 'sdk',
      status: sdkReady ? 'READY' : 'NOT_FOUND',
      path: tc.sdkRoot || tc.sdkTarget,
      detail: sdkReady ? `Found at ${tc.sdkRoot} (${tc.sdkSource})` : `No Android SDK at ${tc.sdkTarget}.`,
      fixable: true,
    });
    const envVar = (id: 'androidHome' | 'androidSdkRoot', name: 'ANDROID_HOME' | 'ANDROID_SDK_ROOT'): Dep => {
      const value = process.env[name];
      return {
        id,
        label: name,
        group: 'sdk',
        status: !value ? 'NOT_CONFIGURED' : value === tc.sdkRoot ? 'READY' : 'ERROR',
        path: value,
        detail: !value
          ? `Not set in the shell that started Testora. Testora sets it for its own tools (${tc.sdkTarget}); add it to your shell profile to use adb/emulator in Terminal.`
          : value === tc.sdkRoot
            ? 'Set'
            : `Points to ${value}, which is not a usable Android SDK.`,
        fixable: true,
      };
    };
    deps.push(envVar('androidHome', 'ANDROID_HOME'), envVar('androidSdkRoot', 'ANDROID_SDK_ROOT'));
    deps.push(
      await versionCheck(
        { id: 'sdkmanager', label: 'SDK command-line tools (sdkmanager)', group: 'sdk' },
        tc.javaHome ? tc.sdkmanager : '',
        [`--sdk_root=${tc.sdkTarget}`, '--version'],
        firstLine,
        'NOT_INSTALLED',
        {
          fixable: true,
          ...(tc.sdkmanager && !tc.javaHome
            ? { status: 'NOT_CONFIGURED' as const, detail: 'Needs Java (JDK).' }
            : {}),
        },
      ),
    );
    // avdmanager harus dari cmdline-tools di dalam SDK (yang dari Homebrew tidak melihat system image SDK).
    if (tc.sdkmanager && !tc.avdmanager.startsWith(tc.sdkTarget)) {
      const sdkm = deps.find((d) => d.id === 'sdkmanager');
      if (sdkm?.status === 'READY')
        Object.assign(sdkm, {
          status: 'NOT_CONFIGURED',
          detail:
            'cmdline-tools;latest is not installed inside the Android SDK (needed to create emulators).',
        });
    }
    deps.push(
      await versionCheck(
        { id: 'adb', label: 'adb (platform-tools)', group: 'sdk' },
        tc.adb,
        ['version'],
        (o) => /version ([\d.]+)/.exec(o)?.[1] ?? firstLine(o),
        'NOT_INSTALLED',
        { fixable: true },
      ),
    );
    deps.push(
      await versionCheck(
        { id: 'emulator', label: 'Android Emulator', group: 'sdk' },
        tc.emulator,
        ['-version'],
        (o) => /version ([\d.]+)/.exec(o)?.[1] ?? firstLine(o),
        'NOT_INSTALLED',
        { fixable: true },
      ),
    );

    // Komponen SDK (sdkmanager --list_installed).
    const packages =
      tc.sdkmanager && tc.javaHome ? await listPackages() : { error: 'sdkmanager is not available' };
    const component = (id: 'platform' | 'buildTools' | 'systemImage', label: string, prefix: string): Dep => {
      if ('error' in packages)
        return {
          id,
          label,
          group: 'sdk',
          status: 'NOT_FOUND',
          detail: `Cannot check: ${packages.error}.`,
          fixable: true,
        };
      const found = packages.installed.filter((p) => p.path.startsWith(prefix)).map((p) => p.path);
      return {
        id,
        label,
        group: 'sdk',
        status: found.length ? 'READY' : 'NOT_INSTALLED',
        version: found.map((f) => f.split(';').slice(1).join(';')).join(', ') || undefined,
        detail: found.length ? 'Installed' : 'Not installed.',
        command: `sdkmanager --list_installed`,
        fixable: true,
      };
    };
    deps.push(
      component('platform', 'Android platform', 'platforms;'),
      component('buildTools', 'Android build tools', 'build-tools;'),
      component('systemImage', 'Emulator system image', 'system-images;'),
    );

    // ----- Appium
    const appium = await appiumInstallInfo();
    deps.push({
      id: 'appium',
      label: 'Appium server',
      group: 'appium',
      status: appium.version ? 'READY' : appium.appium ? 'ERROR' : 'NOT_INSTALLED',
      version: appium.version,
      path: appium.appium || undefined,
      detail: appium.version
        ? 'Installed'
        : appium.error === 'not found' || !appium.appium
          ? 'Not installed.'
          : `appium --version failed: ${appium.error}`,
      command: 'appium --version',
      fixable: true,
    });
    deps.push({
      id: 'uiautomator2',
      label: 'Appium UiAutomator2 driver',
      group: 'appium',
      status: !appium.version
        ? 'NOT_INSTALLED'
        : appium.uiautomator2
          ? 'READY'
          : appium.driverError
            ? 'ERROR'
            : 'NOT_INSTALLED',
      version: appium.uiautomator2,
      detail: appium.uiautomator2 ? 'Installed' : (appium.driverError ?? 'Not installed.'),
      command: 'appium driver list --installed',
      fixable: true,
    });
    const status = await fetch(`${this.appiumUrl().replace(/\/$/, '')}/status`, {
      signal: AbortSignal.timeout(3_000),
    })
      .then(async (r) => (r.ok ? ((await r.json()) as { value?: { build?: { version?: string } } }) : null))
      .catch(() => null);
    deps.push({
      id: 'appiumServer',
      label: 'Appium server running',
      group: 'appium',
      status: status ? 'READY' : 'NOT_FOUND',
      version: status?.value?.build?.version,
      detail: status
        ? `Answering at ${this.appiumUrl()}`
        : `Nothing answers at ${this.appiumUrl()}. Start it with the Start Appium button.`,
      command: `GET ${this.appiumUrl()}/status`,
    });

    // ----- devices
    const avds = tc.emulator ? await listAvds() : [];
    // AVD yang system image-nya tidak ada tidak bisa dinyalakan → tidak dihitung.
    const usable = avds.filter((a) => {
      const image = avdConfig(a)['image.sysdir.1'];
      return !image || fs.existsSync(path.join(tc.sdkTarget, image));
    });
    const broken = avds.filter((a) => !usable.includes(a));
    deps.push({
      id: 'avd',
      label: 'Android Virtual Device (AVD)',
      group: 'devices',
      status: usable.length ? 'READY' : avds.length ? 'ERROR' : tc.emulator ? 'NOT_FOUND' : 'NOT_INSTALLED',
      version: usable.join(', ') || undefined,
      detail: usable.length
        ? `${usable.length} usable emulator(s)${broken.length ? `; ${broken.length} cannot start (system image missing): ${broken.join(', ')}` : ''}`
        : avds.length
          ? `No usable emulator: ${broken.join(', ')} point to a system image that is not installed. Create a new one.`
          : 'No Android Virtual Device found.',
      command: 'emulator -list-avds',
    });

    const dependencies: AndroidDependency[] = deps.map((d) => ({ fixable: false, ...d }));
    const need: AndroidDependency['id'][] = [
      'java',
      'androidSdk',
      'adb',
      'platform',
      'appium',
      'uiautomator2',
    ];
    return {
      checkedAt: nowIso(),
      dependencies,
      sdkRoot: tc.sdkTarget,
      javaHome: tc.javaHome,
      ready: need.every((id) => dependencies.find((d) => d.id === id)?.status === 'READY'),
    };
  }
}
