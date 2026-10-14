/**
 * "Setup Android Environment": pasang hanya dependency yang belum READY,
 * berurutan, dengan log live, lalu verifikasi ulang. Semua langkah berjalan
 * tanpa sudo (Homebrew, npm --prefix di folder Testora, sdkmanager). Perintah
 * yang butuh administrator hanya ditampilkan, tidak dijalankan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AndroidEnvironmentReport, AndroidSetupJob, AndroidSetupStep } from '@flowqa/shared';
import { createId } from '@flowqa/shared';
import { nowIso } from '../../lib/time';
import { chooseComponents, listPackages } from './sdk';
import { maskSecrets, run, stream, TESTORA_APPIUM_DIR, toolchain } from './toolchain';

export const HOMEBREW_INSTALL =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
const PROFILE_MARK = '# >>> Testora Android environment >>>';
const MAX_LOG = 400;

export interface PlannedStep extends AndroidSetupStep {
  exec: (log: (line: string) => void) => Promise<void>;
}

const brew = () => ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find((b) => fs.existsSync(b)) ?? '';

async function exec(cmd: string, args: string[], log: (line: string) => void, answer?: string) {
  const tc = toolchain();
  log(`$ ${path.basename(cmd)} ${args.join(' ')}`);
  const { done } = stream(cmd, args, log, {
    env: { ...tc.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' },
    answer,
  });
  const code = await done;
  if (code !== 0) throw new Error(`${path.basename(cmd)} exited with code ${code}`);
}

export interface SetupOptions {
  /** User menyetujui lisensi Android SDK (langkah lisensi hanya dijalankan bila true). */
  acceptLicenses: boolean;
  /** Tambahkan ANDROID_HOME & PATH ke ~/.zprofile (hanya menambah blok bertanda, tidak menimpa). */
  configureShell: boolean;
}

/** Susun langkah dari hasil preflight: dependency yang sudah READY dilewati. */
export async function planSetup(
  report: AndroidEnvironmentReport,
  options: SetupOptions,
): Promise<{ steps: PlannedStep[]; blocked: string[] }> {
  const status = (id: string) => report.dependencies.find((d) => d.id === id)?.status;
  const missing = (id: string) => status(id) !== 'READY';
  const steps: PlannedStep[] = [];
  const blocked: string[] = [];
  const brewBin = brew();
  const step = (s: Omit<PlannedStep, 'status'>) => steps.push({ ...s, status: 'pending' });

  if (missing('java') || missing('sdkmanager')) {
    if (!brewBin)
      blocked.push(
        `Homebrew is needed to install Java and the Android command-line tools. Install it yourself in Terminal (it asks for your Mac password): ${HOMEBREW_INSTALL}`,
      );
    else {
      if (missing('java'))
        step({
          id: 'java',
          label: 'Install Java (OpenJDK 17)',
          command: 'brew install openjdk@17',
          download: '≈ 350 MB',
          exec: (log) => exec(brewBin, ['install', 'openjdk@17'], log),
        });
      if (!toolchain().sdkmanager)
        step({
          id: 'cmdline-tools',
          label: 'Install Android SDK command-line tools',
          command: 'brew install --cask android-commandlinetools',
          download: '≈ 150 MB',
          exec: (log) => exec(brewBin, ['install', '--cask', 'android-commandlinetools'], log),
        });
    }
  }

  const sdkMissing = [
    ...['adb', 'emulator', 'platform', 'buildTools', 'systemImage'].filter(missing),
    ...(status('sdkmanager') === 'NOT_CONFIGURED' && report.javaHome ? ['sdkmanager'] : []),
  ];
  if (sdkMissing.length) {
    const sdkRoot = toolchain().sdkTarget;
    step({
      id: 'licenses',
      label: 'Accept the Android SDK licenses',
      command: `yes | sdkmanager --sdk_root=${sdkRoot} --licenses`,
      license: true,
      exec: async (log) => {
        if (!options.acceptLicenses) throw new Error('The Android SDK licenses were not accepted.');
        const tc = toolchain();
        fs.mkdirSync(tc.sdkTarget, { recursive: true });
        await exec(tc.sdkmanager, [`--sdk_root=${tc.sdkTarget}`, '--licenses'], log, 'y');
      },
    });
    step({
      id: 'sdk-components',
      label: 'Install Android SDK components',
      command: `sdkmanager --sdk_root=${sdkRoot} platform-tools emulator <platform> <build-tools> <system image>`,
      download: '≈ 2–3 GB',
      exec: async (log) => {
        const tc = toolchain();
        const all = await listPackages(true);
        if ('error' in all) throw new Error(all.error);
        const choice = chooseComponents(all);
        const installed = new Set(all.installed.map((p) => p.path));
        // cmdline-tools di dalam SDK: avdmanager versi Homebrew tidak menemukan system image SDK.
        const wanted = [
          'platform-tools',
          'emulator',
          'cmdline-tools;latest',
          ...(choice ? [choice.platform, choice.buildTools, choice.systemImage] : []),
        ].filter(Boolean);
        const packages = wanted.filter((p) => !installed.has(p));
        // Jangan pasang platform/system image lain bila sudah ada yang terpasang.
        const skipKinds = [
          !missing('platform') && 'platforms;',
          !missing('buildTools') && 'build-tools;',
          !missing('systemImage') && 'system-images;',
        ].filter(Boolean) as string[];
        const todo = packages.filter((p) => !skipKinds.some((k) => p.startsWith(k)));
        if (!todo.length) return log('All required SDK components are already installed.');
        log(`Installing: ${todo.join(', ')}`);
        await exec(tc.sdkmanager, [`--sdk_root=${tc.sdkTarget}`, ...todo], log);
      },
    });
  }

  if (missing('appium'))
    step({
      id: 'appium',
      label: 'Install Appium (in ~/.testora, no sudo)',
      command: `npm install --prefix ${TESTORA_APPIUM_DIR} appium`,
      download: '≈ 100 MB',
      exec: async (log) => {
        fs.mkdirSync(TESTORA_APPIUM_DIR, { recursive: true });
        const npm = (await run('/usr/bin/which', ['npm'])).stdout.trim() || 'npm';
        await exec(
          npm,
          ['install', '--prefix', TESTORA_APPIUM_DIR, '--no-fund', '--no-audit', 'appium'],
          log,
        );
      },
    });
  if (missing('uiautomator2'))
    step({
      id: 'uiautomator2',
      label: 'Install the Appium UiAutomator2 driver',
      command: 'appium driver install uiautomator2',
      download: '≈ 30 MB',
      exec: async (log) => {
        const tc = toolchain();
        if (!tc.appium) throw new Error('Appium is not installed.');
        await exec(tc.appium, ['driver', 'install', 'uiautomator2'], log);
      },
    });

  if (options.configureShell && (missing('androidHome') || missing('androidSdkRoot')))
    step({
      id: 'shell',
      label: 'Add ANDROID_HOME to ~/.zprofile',
      command: `append a "${PROFILE_MARK}" block to ~/.zprofile`,
      exec: async (log) => {
        const tc = toolchain();
        const profile = path.join(os.homedir(), '.zprofile');
        const current = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : '';
        if (current.includes(PROFILE_MARK))
          return log('~/.zprofile already has the Testora block — left unchanged.');
        if (/^\s*export\s+ANDROID_(HOME|SDK_ROOT)=/m.test(current))
          return log('~/.zprofile already sets ANDROID_HOME / ANDROID_SDK_ROOT — left unchanged.');
        const block = [
          '',
          PROFILE_MARK,
          `export ANDROID_HOME="${tc.sdkTarget}"`,
          'export ANDROID_SDK_ROOT="$ANDROID_HOME"',
          ...(tc.javaHome ? [`export JAVA_HOME="${tc.javaHome}"`] : []),
          'export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"',
          `export PATH="${path.join(TESTORA_APPIUM_DIR, 'node_modules', '.bin')}:$PATH"`,
          '# <<< Testora Android environment <<<',
          '',
        ].join('\n');
        fs.appendFileSync(profile, block);
        log('Added to ~/.zprofile. Open a new Terminal window to use adb, emulator and appium there.');
      },
    });
  return { steps, blocked };
}

/** Satu pekerjaan setup yang berjalan di latar belakang, dipantau UI lewat polling. */
export class AndroidSetupRunner {
  private job: (AndroidSetupJob & { planned: PlannedStep[] }) | null = null;

  current(): AndroidSetupJob | null {
    if (!this.job) return null;
    const { planned: _planned, ...job } = this.job;
    return { ...job, steps: job.steps.map((s) => ({ ...s })) };
  }

  running() {
    return this.job?.status === 'running';
  }

  start(
    planned: PlannedStep[],
    verify: (() => Promise<AndroidEnvironmentReport>) | null,
    blocked: string[] = [],
  ): AndroidSetupJob {
    if (this.running()) throw new Error('Setup is already running.');
    const job: AndroidSetupJob & { planned: PlannedStep[] } = {
      id: createId('setup'),
      status: 'running',
      startedAt: nowIso(),
      finishedAt: null,
      steps: planned.map(({ exec: _exec, ...s }) => s),
      log: blocked.map((b) => `⚠ ${b}`),
      planned,
    };
    this.job = job;
    const log = (line: string) => {
      const clean = maskSecrets(line, []);
      // Baris progress (sdkmanager/npm) menimpa baris progress sebelumnya.
      const progress = /\[[= ]*\]\s*\d+%|^\s*\d+%/.test(clean);
      if (progress && job.log.length && /\[[= ]*\]\s*\d+%|^\s*\d+%/.test(job.log[job.log.length - 1]))
        job.log[job.log.length - 1] = clean;
      else job.log.push(clean);
      if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    };
    void (async () => {
      let failed = false;
      for (const [i, step] of planned.entries()) {
        const view = job.steps[i];
        if (failed && step.id !== 'shell') {
          view.status = 'skipped';
          view.error = 'Skipped because an earlier step failed.';
          continue;
        }
        view.status = 'running';
        log(`── ${step.label}`);
        try {
          await step.exec(log);
          view.status = 'done';
        } catch (error) {
          view.status = 'failed';
          view.error = (error as Error).message;
          log(`✖ ${view.error}`);
          failed = true;
        }
      }
      if (verify) log('── Verifying the environment…');
      const report = verify ? await verify().catch(() => null) : null;
      if (report)
        for (const d of report.dependencies.filter((x) => x.status !== 'READY' && x.fixable))
          log(`• ${d.label}: ${d.status} — ${d.detail}`);
      job.status = failed ? 'failed' : 'done';
      job.finishedAt = nowIso();
      log(failed ? 'Setup finished with errors.' : 'Setup finished.');
    })();
    return this.current()!;
  }
}
