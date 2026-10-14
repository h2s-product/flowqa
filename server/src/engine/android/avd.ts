/**
 * Membuat Android Virtual Device (AVD) dari wizard "Create Android Emulator".
 * Tidak pernah dijalankan diam-diam: hanya saat user mengirim form wizard.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AvdOptions, CreateAvdInput } from '@flowqa/shared';
import { androidVersionOfApi, chooseComponents, imageAbi, listPackages } from './sdk';
import { listAvds } from './devices';
import { run, stream, toolchain } from './toolchain';

const AVD_NAME = /^[A-Za-z0-9._-]{1,60}$/;
/** Profil perangkat yang umum dipakai (dipakai bila tersedia di avdmanager). */
const PREFERRED_DEVICES = ['pixel_8', 'pixel_7', 'pixel_6', 'pixel_5', 'pixel_4', 'pixel'];

export async function avdOptions(): Promise<AvdOptions> {
  const tc = toolchain();
  const devices: AvdOptions['devices'] = [];
  if (tc.avdmanager && tc.javaHome) {
    const out = await run(tc.avdmanager, ['list', 'device'], { timeoutMs: 60_000, env: tc.env });
    // Blok: id: 17 or "pixel_8"\n    Name: Pixel 8
    for (const m of out.stdout.matchAll(/id:\s*\d+\s+or\s+"([^"]+)"\s*\n\s*Name:\s*([^\n]+)/g))
      devices.push({ id: m[1], name: m[2].trim() });
  }
  const packages = await listPackages(true);
  const abi = imageAbi();
  const images =
    'error' in packages
      ? []
      : [
          ...new Map(
            // Yang terpasang ditulis terakhir supaya tidak tertimpa entri "available".
            [
              ...packages.available.map((p) => ({ ...p, installed: false })),
              ...packages.installed.map((p) => ({ ...p, installed: true })),
            ]
              .filter((p) =>
                new RegExp(`^system-images;android-(\\d+(\\.\\d+)?);google_apis;${abi}$`).test(p.path),
              )
              .map((p) => [p.path, p] as const),
          ).values(),
        ]
          .map((p) => {
            const api = /android-([\d.]+)/.exec(p.path)![1];
            return {
              id: p.path,
              apiLevel: api,
              androidVersion: androidVersionOfApi(api),
              installed: p.installed,
            };
          })
          .sort(
            (a, b) =>
              Number(b.installed) - Number(a.installed) || parseFloat(b.apiLevel) - parseFloat(a.apiLevel),
          );
  const choice = 'error' in packages ? null : chooseComponents(packages);
  const image = images.find((i) => i.installed)?.id ?? choice?.systemImage ?? images[0]?.id ?? '';
  const device = PREFERRED_DEVICES.find((d) => devices.some((x) => x.id === d)) ?? devices[0]?.id ?? 'pixel';
  const api = /android-([\d.]+)/.exec(image)?.[1] ?? '';
  const existing = new Set(await listAvds());
  let name = `${(devices.find((d) => d.id === device)?.name ?? 'Pixel').replace(/\W+/g, '_')}_API_${api.split('.')[0]}`;
  for (let i = 2; existing.has(name); i++) name = name.replace(/(_\d+)?$/, `_${i}`);
  // RAM: 2 GB (Mac dengan RAM ≤ 8 GB) atau 4 GB.
  const ramMb = os.totalmem() <= 8 * 1024 ** 3 ? 2048 : 4096;
  return { devices, images, defaults: { name, device, image, ramMb, storageMb: 6144 } };
}

/** Buat AVD; system image dipasang dulu bila belum ada. */
export async function createAvd(input: CreateAvdInput, onLine: (line: string) => void): Promise<void> {
  const tc = toolchain();
  if (!AVD_NAME.test(input.name))
    throw new Error('Use only letters, numbers, dot, dash and underscore in the emulator name.');
  if (!/^system-images;android-[\d.]+;[\w]+;(arm64-v8a|x86_64)$/.test(input.image))
    throw new Error('Choose an Android system image.');
  if (!/^[\w.-]+$/.test(input.device)) throw new Error('Choose a device profile.');
  if (!tc.avdmanager || !tc.sdkmanager)
    throw new Error('The Android command-line tools are not installed. Run Setup Android Environment first.');
  if ((await listAvds()).includes(input.name))
    throw new Error(`An emulator named "${input.name}" already exists.`);
  const ramMb = Math.min(Math.max(Math.round(input.ramMb), 1024), 8192);
  const storageMb = Math.min(Math.max(Math.round(input.storageMb), 2048), 65536);

  // avdmanager dari Homebrew mencari system image di folder Homebrew, bukan di SDK;
  // cmdline-tools di dalam SDK selalu memakai SDK yang benar.
  let avdmanager = tc.avdmanager;
  if (!avdmanager.startsWith(tc.sdkTarget)) {
    onLine('Installing cmdline-tools;latest into the Android SDK (needed by avdmanager)…');
    const tools = stream(tc.sdkmanager, [`--sdk_root=${tc.sdkTarget}`, 'cmdline-tools;latest'], onLine, {
      env: tc.env,
    });
    if ((await tools.done) !== 0) throw new Error('Could not install cmdline-tools;latest.');
    avdmanager = toolchain().avdmanager;
  }
  const installed = await listPackages();
  if (!('error' in installed) && !installed.installed.some((p) => p.path === input.image)) {
    onLine(`Downloading ${input.image} (≈ 1.5–2 GB)…`);
    const install = stream(tc.sdkmanager, [`--sdk_root=${tc.sdkTarget}`, input.image], onLine, {
      env: tc.env,
    });
    if ((await install.done) !== 0) throw new Error(`Could not install ${input.image}. See the log above.`);
  }
  onLine(`avdmanager create avd -n ${input.name} -k "${input.image}" -d ${input.device}`);
  const create = stream(
    avdmanager,
    ['create', 'avd', '-n', input.name, '-k', input.image, '-d', input.device, '--force'],
    onLine,
    // "Do you wish to create a custom hardware profile?" → no.
    { env: tc.env, answer: 'no' },
  );
  if ((await create.done) !== 0)
    throw new Error('avdmanager could not create the emulator. See the log above.');
  // RAM & penyimpanan di config.ini AVD.
  const config = path.join(os.homedir(), '.android', 'avd', `${input.name}.avd`, 'config.ini');
  if (fs.existsSync(config)) {
    const lines = fs
      .readFileSync(config, 'utf8')
      .split('\n')
      .filter((l) => !/^(hw\.ramSize|disk\.dataPartition\.size|hw\.keyboard)\s*=/.test(l));
    lines.push(`hw.ramSize=${ramMb}`, `disk.dataPartition.size=${storageMb}M`, 'hw.keyboard=yes');
    fs.writeFileSync(config, `${lines.filter(Boolean).join('\n')}\n`);
    onLine(`Set RAM ${ramMb} MB and storage ${storageMb} MB.`);
  }
  onLine(`Emulator "${input.name}" created.`);
}
