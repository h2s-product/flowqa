/**
 * Aplikasi per project (ProjectApp): Android (package, Firebase, jenis perangkat
 * phone/tablet, mode & serial bawaan) atau Web (variabel URL, ukuran layar).
 * Test case dihubungkan ke satu app. Urutan yang berlaku saat run Android:
 * pilihan saat Run → serial di test case → bawaan app → bawaan Settings → Appium.
 */
import type {
  FirebaseSettings,
  FormFactor,
  MobileAppConfig,
  MobileExecutionMode,
  ProjectApp,
  UiTestCase,
} from '@flowqa/shared';
import { serialKind } from '@flowqa/shared';
import { normalizeApp } from '../domain/normalizers';
import { HttpError, notFound } from '../lib/http';
import { log } from '../lib/log';
import type { Repositories } from '../repositories';
import type { AppiumSettingsService } from './appium-settings-service';
import { firebaseKey, firebaseStateKey, type FirebaseDistributionService } from './firebase-service';

const MIGRATED = 'apps-migrated';

export class AppService {
  constructor(
    private readonly repos: Repositories,
    private readonly appium?: AppiumSettingsService,
    private readonly firebase?: FirebaseDistributionService,
  ) {}

  list(projectId: string): ProjectApp[] {
    return this.repos.apps
      .list({ project_id: projectId })
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name));
  }

  get(projectId: string, appId: string): ProjectApp {
    const app = this.repos.apps.get(appId);
    if (!app || app.projectId !== projectId) throw notFound('App');
    return app;
  }

  save(projectId: string, input: Record<string, unknown>, existing?: ProjectApp): ProjectApp {
    const app = normalizeApp(input, projectId, existing);
    const clash = this.list(projectId).find(
      (a) => a.id !== app.id && a.name.toLowerCase() === app.name.toLowerCase(),
    );
    if (clash) throw new HttpError(400, `This project already has an app named "${clash.name}"`);
    return this.repos.apps.save(app);
  }

  /** Hapus app: test case-nya tetap ada (dilepas dari app), koneksi Firebase-nya dibuang. */
  delete(projectId: string, appId: string): void {
    const app = this.get(projectId, appId);
    for (const test of this.repos.uiTests.list({ project_id: projectId }))
      if (test.appId === app.id) {
        const { appId: _drop, ...rest } = test;
        this.repos.uiTests.save(rest as UiTestCase);
      }
    this.firebase?.forget(app.id);
    this.repos.apps.delete(app.id);
  }

  /** Project dihapus (app ikut terhapus lewat cascade): buang koneksi Firebase app-nya. */
  forgetProject(appIds: string[]) {
    for (const id of appIds) this.firebase?.forget(id);
  }

  /** App test case harus milik project yang sama dan platformnya cocok (Android ↔ mobile). */
  assertForTest(test: UiTestCase): void {
    if (!test.appId) return;
    const app = this.repos.apps.get(test.appId);
    if (!app || app.projectId !== test.projectId)
      throw new HttpError(400, 'The chosen app does not exist in this project');
    const mobile = test.target === 'mobile';
    if ((app.platform === 'android') !== mobile)
      throw new HttpError(400, `"${app.name}" is a ${app.platform === 'android' ? 'Android' : 'web'} app`);
  }

  appOf(test: Pick<UiTestCase, 'appId' | 'projectId'>): ProjectApp | undefined {
    const app = test.appId ? this.repos.apps.get(test.appId) : undefined;
    return app && app.projectId === test.projectId ? app : undefined;
  }

  /** Mode yang dipakai: pilihan saat Run → bawaan app → bawaan Settings → Appium. */
  mode(test: Pick<UiTestCase, 'appId' | 'projectId'>, chosen?: MobileExecutionMode): MobileExecutionMode {
    return (
      chosen || this.appOf(test)?.android?.defaultMode || this.appium?.current().defaultMode || 'emulator'
    );
  }

  /** Phone / tablet yang dibutuhkan app test ini (kosong = bebas). */
  formFactor(test: Pick<UiTestCase, 'appId' | 'projectId'>): FormFactor | '' {
    return this.appOf(test)?.android?.formFactor ?? '';
  }

  /**
   * Konfigurasi aplikasi dengan serial yang berlaku: serial di test case bila
   * sejenis dengan mode, lalu serial bawaan app bila sejenis; selain itu kosong
   * (provider memakai perangkat pertama yang siap dari jenis & phone/tablet itu).
   */
  config(
    test: Pick<UiTestCase, 'appId' | 'projectId'>,
    mobile: MobileAppConfig,
    mode: MobileExecutionMode,
  ): MobileAppConfig {
    if (mode === 'mock') return mobile;
    if (mobile.udid.trim() && serialKind(mobile.udid) === mode) return mobile;
    const udid = this.appOf(test)?.android?.udid ?? '';
    return udid && serialKind(udid) === mode ? { ...mobile, udid } : { ...mobile, udid: '' };
  }

  /* ------------------------------ migrasi ------------------------------ */

  /**
   * Sekali saja: buat app dari test case yang sudah ada (per package Android dan
   * per variabel/URL web, dinamai dari folder), hubungkan test case-nya, dan
   * pindahkan koneksi Firebase & perangkat bawaan lama (global / per project) ke app Android.
   */
  migrate(): void {
    const { settings, projects, uiTests, uiFolders, environments, uiSchedules } = this.repos;
    if (settings.get(MIGRATED)) return;
    const all = projects.list();
    // Koneksi Firebase global lama → project (pemilik jadwalnya, bernama ALSINTAN, atau satu-satunya).
    const legacy = settings.get<Partial<FirebaseSettings>>('firebase');
    if (legacy) {
      const target =
        (legacy.scheduleId && uiSchedules.get(legacy.scheduleId)?.projectId) ||
        all.find((p) => /alsintan/i.test(p.name))?.id ||
        (all.length === 1 ? all[0].id : undefined);
      if (target && !settings.get(`firebase:${target}`)) {
        settings.set(`firebase:${target}`, legacy);
        const state = settings.get('firebase-state');
        if (state) settings.set(`firebase-state:${target}`, state);
      }
      settings.delete('firebase');
      settings.delete('firebase-state');
    }
    const folders = new Map(uiFolders.list().map((f) => [f.id, f]));
    const pathOf = (id: string | null) => {
      const out: string[] = [];
      for (let f = id ? folders.get(id) : undefined; f; f = f.parentId ? folders.get(f.parentId) : undefined)
        out.unshift(f.name);
      return out;
    };
    for (const project of all) {
      const tests = uiTests.list({ project_id: project.id }).filter((t) => !t.appId);
      const urlVars = environments
        .list({ project_id: project.id })
        .flatMap((e) => e.variables.filter((v) => /^https?:\/\//i.test(v.value)));
      const originOf = (url: string) => {
        try {
          return new URL(url).origin;
        } catch {
          return url;
        }
      };
      const identity = (t: UiTestCase) => {
        if (t.target === 'mobile') return `android:${t.mobile?.appPackage || t.mobile?.app || 'app'}`;
        const v = /^\{\{\s*([A-Za-z_]\w*)\s*\}\}/.exec(t.startUrl)?.[1];
        if (v) return `web:${v}`;
        const known = urlVars.find((u) => originOf(u.value) === originOf(t.startUrl));
        return known ? `web:${known.key}` : `web-url:${originOf(t.startUrl)}`;
      };
      const groups = new Map<string, UiTestCase[]>();
      for (const t of tests) groups.set(identity(t), [...(groups.get(identity(t)) ?? []), t]);
      const most = <T>(xs: T[]) => {
        const counts = new Map<string, { v: T; n: number }>();
        for (const x of xs) {
          const k = JSON.stringify(x);
          counts.set(k, { v: x, n: (counts.get(k)?.n ?? 0) + 1 });
        }
        return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.v;
      };
      const created: ProjectApp[] = [];
      for (const [key, members] of groups) {
        const paths = members.map((t) => pathOf(t.folderId));
        const root = most(paths.map((p) => p[0]).filter(Boolean));
        // Folder teratas dipakai sebagai nama bila hanya berisi app ini; selain itu subfolder-nya.
        const rootShared = [...groups.entries()].some(
          ([k, ts]) => k !== key && ts.some((t) => pathOf(t.folderId)[0] === root),
        );
        const fallback = key.split(':').slice(1).join(':');
        let name = (rootShared ? most(paths.map((p) => p[1]).filter(Boolean)) : root) || root || fallback;
        if (created.some((a) => a.name.toLowerCase() === name.toLowerCase())) name = `${name} (${fallback})`;
        const sample = members[0];
        const app = this.repos.apps.save(
          sample.target === 'mobile'
            ? normalizeApp(
                {
                  name,
                  platform: 'android',
                  android: {
                    appPackage: sample.mobile?.appPackage ?? '',
                    appActivity: sample.mobile?.appActivity ?? '',
                    app: most(members.map((t) => t.mobile?.app ?? '')) ?? '',
                    ...(settings.get<{ defaultMode?: string; udid?: string }>(
                      `android-project:${project.id}`,
                    ) ?? {}),
                  },
                },
                project.id,
              )
            : normalizeApp(
                {
                  name,
                  platform: 'web',
                  urlVariable: key.startsWith('web:') ? key.slice(4) : '',
                  viewport: most(members.map((t) => t.viewport)),
                },
                project.id,
              ),
        );
        created.push(app);
        for (const t of members) uiTests.save({ ...t, appId: app.id });
      }
      // Koneksi Firebase project → app Android project itu (dibuat bila belum ada).
      const fb = settings.get(`firebase:${project.id}`);
      if (fb) {
        let android = created.filter((a) => a.platform === 'android');
        if (!android.length)
          android = [
            this.repos.apps.save(
              normalizeApp(
                { name: 'Android app', platform: 'android', android: { app: 'firebase:latest' } },
                project.id,
              ),
            ),
          ];
        settings.set(firebaseKey(android[0].id), fb);
        const state = settings.get(`firebase-state:${project.id}`);
        if (state) settings.set(firebaseStateKey(android[0].id), state);
        log.info(`[apps] Firebase connection of "${project.name}" moved to app "${android[0].name}".`);
      }
      settings.delete(`firebase:${project.id}`);
      settings.delete(`firebase-state:${project.id}`);
      settings.delete(`android-project:${project.id}`);
      if (created.length)
        log.info(`[apps] "${project.name}": created ${created.map((a) => `"${a.name}"`).join(', ')}.`);
    }
    settings.set(MIGRATED, { at: new Date().toISOString() });
  }
}
