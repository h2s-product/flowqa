import { useEffect, useRef, useState } from 'react';
import type { FirebaseSettings, ProjectApp } from '@flowqa/shared';
import {
  useAndroidDevices,
  useFirebaseActions,
  useFirebaseEvents,
  useFirebaseReleases,
  useFirebaseSettings,
  useResetFirebaseSettings,
  useSaveFirebaseSettings,
  useTestFirebase,
  useUiSchedules,
} from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, Field, IconButton, Loading, Segmented, Toggle } from '@/components/ui';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';

type Form = Omit<FirebaseSettings, 'serviceAccount'>;
const EMPTY: Form = {
  projectNumber: '',
  appId: '',
  autoInstall: false,
  intervalMinutes: 15,
  installMode: 'emulator',
  udid: '',
  runSchedule: false,
  scheduleId: '',
};
const INTERVALS = [5, 15, 30, 60, 180, 720, 1440];
const intervalLabel = (m: number) =>
  m < 60 ? `${m} minutes` : m === 60 ? '1 hour' : m < 1440 ? `${m / 60} hours` : '1 day';

/**
 * Apps → app Android → Firebase: App Distribution → unduh & pasang APK baru.
 * Setiap app punya koneksi sendiri (project number, App ID, service account key).
 */
export function FirebasePanel({ app }: { app: ProjectApp }) {
  const ref = { projectId: app.projectId, appId: app.id };
  const settings = useFirebaseSettings(ref);
  const save = useSaveFirebaseSettings(ref);
  const reset = useResetFirebaseSettings(ref);
  const test = useTestFirebase(ref);
  const actions = useFirebaseActions(ref);
  const devices = useAndroidDevices();
  const schedules = useUiSchedules(app.projectId);
  const toast = useToast();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [key, setKey] = useState<{ json: string; email: string } | null>(null);
  const [keyError, setKeyError] = useState('');
  const view = settings.data;
  const configured = !!view?.configured;
  const releases = useFirebaseReleases(ref, configured);
  const events = useFirebaseEvents(ref, configured);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  // Ganti app: form & key yang belum disimpan dibuang.
  useEffect(() => {
    setKey(null);
    setKeyError('');
    test.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);

  useEffect(() => {
    if (view) {
      const {
        serviceAccountEmail: _e,
        serviceAccountProject: _p,
        keySet: _k,
        configured: _c,
        lastCheck: _l,
        lastSeenRelease: _s,
        ...rest
      } = view;
      setForm(rest);
    }
  }, [view]);

  if (settings.isLoading) return <Loading />;
  if (settings.error || !view) return <ErrorBox error={settings.error} />;

  // File key dibaca di browser lalu dikirim sekali ke server; tidak pernah ditampilkan.
  const onKeyFile = async (f?: File) => {
    setKeyError('');
    if (!f) return;
    const json = await f.text();
    try {
      const parsed = JSON.parse(json) as { type?: string; client_email?: string; private_key?: string };
      if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key)
        throw new Error('This is not a service account key file.');
      setKey({ json, email: parsed.client_email });
    } catch (e) {
      setKey(null);
      setKeyError(
        (e as Error).message.startsWith('This') ? (e as Error).message : 'The file is not valid JSON.',
      );
    }
    if (file.current) file.current.value = '';
  };
  const payload = () => ({ ...form, ...(key ? { serviceAccount: key.json } : {}) });
  const ready =
    (view.keySet || !!key) &&
    /^\d{4,}$/.test(form.projectNumber) &&
    /^1:\d+:android:[0-9a-f]+$/i.test(form.appId);
  const formFactor = app.android?.formFactor;
  const connected = (devices.data ?? []).filter(
    (d) =>
      !d.id.startsWith('avd:') &&
      d.type === form.installMode &&
      (!formFactor || !d.formFactor || d.formFactor === formFactor),
  );
  const scheduleList = schedules.data ?? [];

  return (
    <>
      <div className={`banner ${configured ? '' : 'warn'}`} role="status">
        <Icon name="download" size={16} />
        <span>
          {configured ? (
            <>
              <b>{app.name}</b> is connected to Firebase App Distribution as <b>{view.serviceAccountEmail}</b>
              {form.autoInstall
                ? ` — checking for new releases every ${intervalLabel(form.intervalMinutes)}.`
                : '.'}
            </>
          ) : (
            <>
              <b>{app.name}</b> is not connected yet. Connect its own Firebase App Distribution app (with its
              own service account key) to download and install every new APK release on your emulator or
              device.
            </>
          )}
        </span>
      </div>

      <section className="panel">
        <div className="panel-h">
          <h3>Firebase connection</h3>
        </div>
        <div className="panel-b grid">
          <details className="rec-login-advanced">
            <summary className="small">How to get a service account key</summary>
            <ol className="setup-steps mt-12 small">
              <li>
                Google Cloud Console (the same project as Firebase) → IAM & Admin → <b>Service Accounts</b> →
                Create service account.
              </li>
              <li>
                Give it the role <b>Firebase App Distribution Admin</b>.
              </li>
              <li>
                Open the account → Keys → Add key → <b>JSON</b>. Upload that file here. It is stored on the
                Testora server only; the private key is never shown again.
              </li>
              <li>
                Project number and App ID: Firebase console → Project settings → General (App ID of the
                Android app, e.g. 1:123456789012:android:abc123).
              </li>
            </ol>
          </details>
          <Field
            group
            label="Service account key (JSON)"
            hint={
              keyError ? (
                <span className="text-fail">{keyError}</span>
              ) : key ? (
                <>
                  New key for <b>{key.email}</b> — saved when you click Save.
                </>
              ) : view.keySet ? (
                <>
                  Saved key: <b>{view.serviceAccountEmail}</b>
                  {view.serviceAccountProject && <> (project {view.serviceAccountProject})</>}. Upload a new
                  file to replace it.
                </>
              ) : (
                'Not set.'
              )
            }
          >
            <div className="row" style={{ gap: 8 }}>
              <input
                ref={file}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => void onKeyFile(e.target.files?.[0])}
              />
              <button className="btn" type="button" onClick={() => file.current?.click()}>
                <Icon name="upload" size={13} /> {view.keySet || key ? 'Replace key file' : 'Upload key file'}
              </button>
              {(view.keySet || key) && <span className="chip plain">private key: ••••••••</span>}
            </div>
          </Field>
          <div className="grid two">
            <Field label="Project number">
              <input
                className="in code"
                value={form.projectNumber}
                placeholder="123456789012"
                onChange={(e) => set({ projectNumber: e.target.value.trim() })}
              />
            </Field>
            <Field label="Android App ID">
              <input
                className="in code"
                value={form.appId}
                placeholder="1:123456789012:android:abc123def456"
                onChange={(e) => set({ appId: e.target.value.trim() })}
              />
            </Field>
          </div>
          {test.data && (
            <div className={`banner ${test.data.ok ? '' : 'warn'}`}>
              <Icon name={test.data.ok ? 'check' : 'x'} size={14} /> <span>{test.data.message}</span>
            </div>
          )}
        </div>

        <div className="panel-b grid" style={{ borderTop: '1px solid var(--line)' }}>
          <Toggle checked={form.autoInstall} onChange={(autoInstall) => set({ autoInstall })}>
            <span>
              <b>Download & install new releases automatically</b>
              <span className="small muted">
                {' '}
                — Testora checks Firebase regularly and installs each new APK once.
              </span>
            </span>
          </Toggle>
          {form.autoInstall && (
            <div className="grid" style={{ paddingLeft: 12 }}>
              <div className="row wrap" style={{ gap: 12 }}>
                <Field label="Check every">
                  <select
                    className="in"
                    value={form.intervalMinutes}
                    onChange={(e) => set({ intervalMinutes: Number(e.target.value) })}
                  >
                    {INTERVALS.map((m) => (
                      <option key={m} value={m}>
                        {intervalLabel(m)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field group label="Install on">
                  <Segmented
                    options={[
                      { id: 'emulator', label: 'Android Emulator' },
                      { id: 'device', label: 'Android Device' },
                    ]}
                    value={form.installMode}
                    onChange={(installMode) => set({ installMode, udid: '' })}
                  />
                </Field>
                <Field label="Device">
                  <select className="in" value={form.udid} onChange={(e) => set({ udid: e.target.value })}>
                    <option value="">
                      First ready{' '}
                      {form.installMode === 'device'
                        ? formFactor || 'phone'
                        : `${formFactor ? `${formFactor} ` : ''}emulator`}
                    </option>
                    {connected.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} · {d.id}
                      </option>
                    ))}
                    {form.udid && !connected.some((d) => d.id === form.udid) && (
                      <option value={form.udid}>{form.udid} (not connected)</option>
                    )}
                  </select>
                </Field>
              </div>
              <Toggle checked={form.runSchedule} onChange={(runSchedule) => set({ runSchedule })}>
                <span>
                  <b>Then run a test schedule</b>
                  <span className="small muted">
                    {' '}
                    — e.g. “Smoke Test”, on the same kind of device the APK was installed on.
                  </span>
                </span>
              </Toggle>
              {form.runSchedule && (
                <Field
                  label="Schedule"
                  hint={
                    scheduleList.length
                      ? `Schedules of this project. Tip: link those tests to ${app.name} and use “Latest Firebase release” — it then uses this app's Firebase connection.`
                      : 'This project has no schedules yet — create one in UI Tester → Test Scheduler.'
                  }
                >
                  <select
                    className="in"
                    value={form.scheduleId}
                    onChange={(e) => set({ scheduleId: e.target.value })}
                  >
                    <option value="">Choose a schedule…</option>
                    {scheduleList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.testIds.length} test{s.testIds.length === 1 ? '' : 's'})
                      </option>
                    ))}
                    {form.scheduleId && !scheduleList.some((s) => s.id === form.scheduleId) && (
                      <option value={form.scheduleId}>Deleted schedule — choose another</option>
                    )}
                  </select>
                </Field>
              )}
            </div>
          )}
        </div>

        <div className="panel-b row settings-actions">
          <button className="btn" disabled={!ready || test.isPending} onClick={() => test.mutate(payload())}>
            <Icon name="pulse" size={13} /> {test.isPending ? 'Connecting…' : 'Test connection'}
          </button>
          <div className="grow" />
          {view.keySet && (
            <button
              className="btn ghost"
              onClick={async () =>
                (await confirm({
                  title: `Disconnect Firebase from ${app.name}?`,
                  message:
                    'The saved service account key of this app is deleted from Testora. Other apps keep their connection. Downloaded APKs stay.',
                  confirmLabel: 'Disconnect',
                })) && reset.mutate(undefined, { onSuccess: () => toast('Firebase disconnected') })
              }
            >
              Disconnect
            </button>
          )}
          <button
            className="btn primary"
            disabled={!ready || save.isPending || (form.runSchedule && !form.scheduleId)}
            onClick={() =>
              save.mutate(payload(), {
                onSuccess: () => {
                  setKey(null);
                  toast('Firebase settings saved');
                },
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      {configured && (
        <section className="panel">
          <div className="panel-h">
            <h3>Releases</h3>
            <span className="small muted">
              Newest first. Download links from Firebase are short-lived, so APKs are downloaded when needed.
            </span>
            <div className="grow" />
            <IconButton
              icon="refresh"
              label="Refresh"
              disabled={releases.isFetching}
              onClick={() => releases.refetch()}
            />
            <button
              className="btn sm primary"
              disabled={actions.check.isPending}
              title="Same as the automatic check: a new release is downloaded, installed and (if turned on) the schedule runs"
              onClick={() => actions.check.mutate(undefined, { onSuccess: (e) => toast(e.message) })}
            >
              <Icon name="refresh" size={12} /> {actions.check.isPending ? 'Checking…' : 'Check now'}
            </button>
          </div>
          {releases.isLoading ? (
            <div className="panel-b">
              <Loading />
            </div>
          ) : releases.error ? (
            <div className="panel-b">
              <ErrorBox error={releases.error} />
            </div>
          ) : !releases.data?.length ? (
            <EmptyState title="No releases yet">
              Distribute an APK build in Firebase App Distribution and it appears here.
            </EmptyState>
          ) : (
            <div className="tbl-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Released</th>
                    <th>Notes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {releases.data.map((r, i) => (
                    <tr key={r.name}>
                      <td>
                        <b>{r.displayVersion || '-'}</b>{' '}
                        <span className="small muted">({r.buildVersion})</span>
                        {i === 0 && (
                          <span className="chip plain" style={{ marginLeft: 6 }}>
                            latest
                          </span>
                        )}
                        {view.lastSeenRelease === r.name && (
                          <div className="small text-pass">Installed automatically</div>
                        )}
                      </td>
                      <td className="small">
                        <DateTime value={r.createTime} />
                      </td>
                      <td className="small muted" style={{ maxWidth: 320 }}>
                        {r.releaseNotes || '-'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button
                          className="btn sm"
                          disabled={r.downloaded || actions.download.isPending}
                          onClick={() =>
                            actions.download.mutate(r.id, {
                              onSuccess: (a) => toast(`Downloaded ${a.release}`),
                            })
                          }
                        >
                          <Icon name="download" size={11} /> {r.downloaded ? 'Downloaded' : 'Download'}
                        </button>{' '}
                        <button
                          className="btn sm primary"
                          disabled={actions.install.isPending}
                          onClick={() =>
                            actions.install.mutate(
                              { id: r.id, mode: form.installMode, udid: form.udid || undefined },
                              { onSuccess: (x) => toast(`Installed ${x.release} on ${x.device}`) },
                            )
                          }
                        >
                          <Icon name="android" size={11} />{' '}
                          {actions.install.isPending && actions.install.variables?.id === r.id
                            ? 'Installing…'
                            : 'Install'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {configured && !!events.data?.length && (
        <section className="panel">
          <div className="panel-h">
            <h3>Activity</h3>
          </div>
          <ul className="firebase-events">
            {events.data.map((e, i) => (
              <li key={i}>
                <span className={`ri ${e.ok ? 'passed' : 'failed'}`}>
                  <Icon name={e.ok ? 'check' : 'x'} size={11} strokeWidth={3} />
                </span>
                <span className="small muted">
                  <DateTime value={e.at} />
                </span>
                <span className="chip plain">{e.kind}</span>
                <span className="small">{e.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
