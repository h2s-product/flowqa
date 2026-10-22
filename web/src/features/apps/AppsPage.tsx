import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AppPlatform, FormFactor, MobileExecutionMode, ProjectApp } from '@flowqa/shared';
import { FIREBASE_LATEST_APP, MOBILE_EXECUTION_MODE_LABEL } from '@flowqa/shared';
import { useAndroidDevices, useApps, useDeleteApp, useSaveApp, useUiTests } from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, Field, Loading, Segmented } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { FirebasePanel } from './FirebasePanel';

const VIEWPORTS = [
  { id: '1280x800', label: 'Desktop 1280×800' },
  { id: '1440x900', label: 'Laptop 1440×900' },
  { id: '1920x1080', label: 'Full HD 1920×1080' },
  { id: '768x1024', label: 'Tablet 768×1024' },
  { id: '390x844', label: 'Phone 390×844' },
];
const FORM_FACTOR_LABEL: Record<FormFactor | '', string> = {
  '': 'Any device',
  phone: 'Phone',
  tablet: 'Tablet',
};
export const appIcon = (app: Pick<ProjectApp, 'platform'>) =>
  app.platform === 'android' ? 'android' : 'globe';

/** Ringkasan app: "Android · Tablet · com.x" / "Web · {{FARM_URL}}". */
export function appSummary(app: ProjectApp): string {
  if (app.platform === 'web')
    return ['Web', app.urlVariable ? `{{${app.urlVariable}}}` : 'no URL variable'].join(' · ');
  const a = app.android;
  return ['Android', a?.formFactor ? FORM_FACTOR_LABEL[a.formFactor] : '', a?.appPackage]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Apps: aplikasi di project (Android / Web). Setiap app Android punya koneksi
 * Firebase, jenis perangkat (phone / tablet) dan perangkat bawaan sendiri; app
 * web punya variabel URL per environment. Test case dihubungkan ke satu app.
 */
export function AppsPage() {
  const { projectId = '', project, environments } = useWorkspace();
  const { user } = useAuth();
  const admin = user?.role === 'admin';
  const { data: apps = [], isLoading } = useApps(projectId);
  const { data: tests = [] } = useUiTests(projectId);
  const save = useSaveApp(projectId);
  const remove = useDeleteApp(projectId);
  const devices = useAndroidDevices(admin);
  const toast = useToast();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const selected = apps.find((a) => a.id === selectedId) ?? apps[0];
  const [draft, setDraft] = useState<ProjectApp | undefined>(selected);
  useEffect(() => setDraft(selected), [selected]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tests) if (t.appId) m.set(t.appId, (m.get(t.appId) ?? 0) + 1);
    return m;
  }, [tests]);
  // Nama variabel berisi URL di environment project (untuk dipilih app web).
  const urlVariables = useMemo(
    () =>
      [
        ...new Set(
          environments.flatMap((e) =>
            e.variables.filter((v) => /^https?:\/\//i.test(v.value)).map((v) => v.key),
          ),
        ),
      ].sort(),
    [environments],
  );

  if (isLoading) return <Loading />;
  if (!projectId) return <EmptyState title="Create a project first" />;

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(selected);
  const set = (patch: Partial<ProjectApp>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setAndroid = (patch: Partial<NonNullable<ProjectApp['android']>>) =>
    setDraft((d) => (d?.android ? { ...d, android: { ...d.android, ...patch } } : d));
  const submit = () => draft && save.mutate(draft, { onSuccess: (a) => toast(`${a.name} saved`) });
  const deleteSelected = async () => {
    if (
      !selected ||
      !(await confirm({
        title: `Delete “${selected.name}”?`,
        message: `Its ${counts.get(selected.id) ?? 0} test case(s) stay, without an app.${selected.platform === 'android' ? ' Its Firebase connection and service account key are deleted.' : ''}`,
      }))
    )
      return;
    remove.mutate(selected.id, { onSuccess: () => setSelectedId(undefined) });
  };

  const android = draft?.android;
  const mode = android?.defaultMode ?? '';
  const ready = (devices.data ?? []).filter(
    (d) =>
      !d.id.startsWith('avd:') &&
      d.type === mode &&
      (!android?.formFactor || !d.formFactor || d.formFactor === android.formFactor),
  );

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        The apps of <b>{project?.name}</b>, e.g. an Android app per role and the web platforms. Each Android
        app has its own Firebase connection, device type (phone / tablet) and default device; each web app its
        own URL variable. Link test cases to an app in the test editor.
      </p>
      <div className="env-layout">
        <div className="panel" style={{ padding: 8 }}>
          {!apps.length && (
            <p className="small muted" style={{ padding: 8 }}>
              No apps yet.
            </p>
          )}
          {apps.map((app) => (
            <div
              key={app.id}
              className={`env-item ${app.id === selected?.id ? 'on' : ''}`}
              onClick={() => setSelectedId(app.id)}
            >
              <Icon name={appIcon(app)} size={16} />
              <div className="grow" style={{ minWidth: 0 }}>
                <b>{app.name}</b>
                <div
                  className="small muted"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {appSummary(app)}
                </div>
                <div className="small muted">{counts.get(app.id) ?? 0} test case(s)</div>
              </div>
            </div>
          ))}
          {admin && (
            <button className="add-inline" style={{ marginTop: 6 }} onClick={() => setCreating(true)}>
              <Icon name="plus" size={14} /> Add app
            </button>
          )}
        </div>

        {draft ? (
          <div className="grid" style={{ alignContent: 'start' }}>
            <div className="panel">
              <div className="panel-h">
                <Icon name={appIcon(draft)} size={16} />
                <h3>{draft.name}</h3>
                <span className="small muted">
                  Updated <DateTime value={draft.updatedAt} />
                </span>
                <div className="grow" />
                <Link className="btn sm" to={`/ui/tests?app=${draft.id}`}>
                  {counts.get(draft.id) ?? 0} test case(s)
                </Link>
                {admin && (
                  <>
                    <button className="btn sm ghost danger" onClick={deleteSelected}>
                      <Icon name="trash" size={14} /> Delete
                    </button>
                    <button className="btn sm primary" onClick={submit} disabled={!dirty || save.isPending}>
                      {dirty ? 'Save changes' : 'Saved'}
                    </button>
                  </>
                )}
              </div>
              <fieldset className="cfg-section" disabled={!admin} style={{ border: 0, margin: 0 }}>
                <div className="grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
                  <Field label="Name">
                    <input
                      className="in"
                      value={draft.name}
                      onChange={(e) => set({ name: e.target.value })}
                    />
                  </Field>
                  <Field label="Description">
                    <input
                      className="in"
                      value={draft.description}
                      placeholder={
                        draft.platform === 'android'
                          ? 'e.g. for the drone pilots'
                          : 'e.g. back office for admins'
                      }
                      onChange={(e) => set({ description: e.target.value })}
                    />
                  </Field>
                </div>
              </fieldset>

              {draft.platform === 'web' ? (
                <fieldset className="cfg-section" disabled={!admin} style={{ border: 0, margin: 0 }}>
                  <h4>Web</h4>
                  <div className="grid two">
                    <Field
                      label="URL variable"
                      hint={
                        <>
                          New tests of this app start at{' '}
                          <span className="code">{`{{${draft.urlVariable || 'NAME'}}}`}</span>. Set its value
                          in each environment.
                        </>
                      }
                    >
                      <input
                        className="in code"
                        list="app-url-vars"
                        value={draft.urlVariable ?? ''}
                        placeholder="FARM_URL"
                        onChange={(e) => set({ urlVariable: e.target.value.replace(/[{}\s]/g, '') })}
                      />
                      <datalist id="app-url-vars">
                        {urlVariables.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    </Field>
                    <Field label="Screen size of new tests">
                      <select
                        className="in"
                        value={`${draft.viewport?.width ?? 1280}x${draft.viewport?.height ?? 800}`}
                        onChange={(e) => {
                          const [width, height] = e.target.value.split('x').map(Number);
                          set({ viewport: { width, height } });
                        }}
                      >
                        {VIEWPORTS.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                        {!VIEWPORTS.some(
                          (v) => v.id === `${draft.viewport?.width}x${draft.viewport?.height}`,
                        ) && (
                          <option value={`${draft.viewport?.width}x${draft.viewport?.height}`}>
                            {draft.viewport?.width}×{draft.viewport?.height}
                          </option>
                        )}
                      </select>
                    </Field>
                  </div>
                  {draft.urlVariable && (
                    <div className="small muted">
                      {environments.map((e) => {
                        const value = e.variables.find((v) => v.key === draft.urlVariable)?.value;
                        return (
                          <div key={e.id}>
                            {e.name}:{' '}
                            {value ? (
                              <span className="code">{value}</span>
                            ) : (
                              <span className="text-fail">not set</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </fieldset>
              ) : (
                android && (
                  <fieldset className="cfg-section" disabled={!admin} style={{ border: 0, margin: 0 }}>
                    <h4>Android app</h4>
                    <div className="grid two">
                      <Field label="App package">
                        <input
                          className="in code"
                          value={android.appPackage}
                          placeholder="com.example.agro"
                          onChange={(e) => setAndroid({ appPackage: e.target.value.trim() })}
                        />
                      </Field>
                      <Field label="App activity (optional)">
                        <input
                          className="in code"
                          value={android.appActivity}
                          placeholder=".MainActivity"
                          onChange={(e) => setAndroid({ appActivity: e.target.value.trim() })}
                        />
                      </Field>
                    </div>
                    <Field
                      group
                      label="App of new tests"
                      hint="“Latest Firebase release” installs the newest build from this app's Firebase connection (below) before each test."
                    >
                      <Segmented
                        options={[
                          { id: FIREBASE_LATEST_APP, label: 'Latest Firebase release' },
                          { id: '', label: 'Installed app' },
                        ]}
                        value={android.app === FIREBASE_LATEST_APP ? FIREBASE_LATEST_APP : ''}
                        onChange={(app) => setAndroid({ app })}
                      />
                    </Field>
                    <h4 className="mt-12">Device</h4>
                    <Field
                      group
                      label="Device type"
                      hint="Tests of this app only use this kind of device (detected from the screen size)."
                    >
                      <Segmented<FormFactor | ''>
                        options={[
                          { id: '', label: FORM_FACTOR_LABEL[''] },
                          { id: 'phone', label: FORM_FACTOR_LABEL.phone },
                          { id: 'tablet', label: FORM_FACTOR_LABEL.tablet },
                        ]}
                        value={android.formFactor}
                        onChange={(formFactor) => setAndroid({ formFactor, udid: '' })}
                      />
                    </Field>
                    <Field
                      group
                      label="Run on"
                      hint="Used by schedules, Firebase auto-install and bulk runs, and chosen first when you click Run. A choice made at Run, or a device set in a test case, still wins."
                    >
                      <Segmented<MobileExecutionMode | 'default'>
                        options={[
                          { id: 'default', label: 'Settings default' },
                          { id: 'emulator', label: MOBILE_EXECUTION_MODE_LABEL.emulator },
                          { id: 'device', label: MOBILE_EXECUTION_MODE_LABEL.device },
                          { id: 'mock', label: MOBILE_EXECUTION_MODE_LABEL.mock },
                        ]}
                        value={mode || 'default'}
                        onChange={(m) => setAndroid({ defaultMode: m === 'default' ? '' : m, udid: '' })}
                      />
                    </Field>
                    {(mode === 'emulator' || mode === 'device') && (
                      <Field label="Device">
                        <select
                          className="in"
                          value={android.udid}
                          onChange={(e) => setAndroid({ udid: e.target.value })}
                        >
                          <option value="">
                            First ready {android.formFactor || (mode === 'device' ? 'phone' : '')}{' '}
                            {mode === 'emulator' ? 'emulator' : ''}
                          </option>
                          {ready.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} · {d.id}
                              {d.formFactor ? ` · ${d.formFactor}` : ''}
                            </option>
                          ))}
                          {android.udid && !ready.some((d) => d.id === android.udid) && (
                            <option value={android.udid}>{android.udid} (not connected)</option>
                          )}
                        </select>
                      </Field>
                    )}
                  </fieldset>
                )
              )}
            </div>
            {draft.platform === 'android' && admin && selected && <FirebasePanel app={selected} />}
          </div>
        ) : (
          <div className="panel">
            <EmptyState
              title="No apps yet"
              action={
                admin && (
                  <button className="btn primary" onClick={() => setCreating(true)}>
                    <Icon name="plus" size={14} /> Add app
                  </button>
                )
              }
            >
              Add the Android apps (one per role, e.g. FO Apps, Agro Apps) and the web platforms of this
              project.
            </EmptyState>
          </div>
        )}
      </div>
      {creating && (
        <NewAppModal
          pending={save.isPending}
          onClose={() => setCreating(false)}
          onCreate={(name, platform) =>
            save.mutate(
              platform === 'android'
                ? {
                    name,
                    platform,
                    android: {
                      appPackage: '',
                      appActivity: '',
                      app: FIREBASE_LATEST_APP,
                      formFactor: '',
                      defaultMode: '',
                      udid: '',
                    },
                  }
                : { name, platform, urlVariable: '', viewport: { width: 1280, height: 800 } },
              {
                onSuccess: (a) => {
                  setCreating(false);
                  setSelectedId(a.id);
                },
              },
            )
          }
        />
      )}
    </>
  );
}

function NewAppModal({
  pending,
  onClose,
  onCreate,
}: {
  pending: boolean;
  onClose: () => void;
  onCreate: (name: string, platform: AppPlatform) => void;
}) {
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<AppPlatform>('android');
  return (
    <Modal
      title="Add app"
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!name.trim() || pending}
            onClick={() => onCreate(name.trim(), platform)}
          >
            Add app
          </button>
        </>
      }
    >
      <div className="grid">
        <Field group label="Platform" hint="Cannot be changed later.">
          <Segmented<AppPlatform>
            options={[
              { id: 'android', label: 'Android app' },
              { id: 'web', label: 'Web platform' },
            ]}
            value={platform}
            onChange={setPlatform}
          />
        </Field>
        <Field label="Name">
          <input
            className="in"
            autoFocus
            value={name}
            maxLength={80}
            placeholder={platform === 'android' ? 'Agro Apps' : 'FARM ERP'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && onCreate(name.trim(), platform)}
          />
        </Field>
      </div>
    </Modal>
  );
}
