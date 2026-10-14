import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  AndroidDependency,
  AndroidDevice,
  AndroidDeviceStatus,
  AndroidSetupJob,
  AppiumSettings,
  DependencyStatus,
  MobileExecutionMode,
} from '@flowqa/shared';
import {
  useAndroidDevices,
  useAndroidEnvironment,
  useAndroidSetupJob,
  useAndroidSetupPlan,
  useAppiumHealth,
  useAppiumLog,
  useAppiumServer,
  useAppiumSettings,
  useAvdJob,
  useAvdOptions,
  useCreateAvd,
  useDeviceActions,
  useResetAppiumSettings,
  useSaveAppiumSettings,
  useStartAndroidSetup,
  useTestAndroidConnection,
  useTestAppium,
} from '@/api/queries';
import { useInvalidate } from '@/api/queries/shared';
import { keys } from '@/api/queries/keys';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { EmptyState, ErrorBox, Field, IconButton, Loading, Segmented, Tabs } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { MobileErrorHelp, MODE_OPTIONS } from '@/features/ui/mobileMode';
import { FirebaseTab } from './FirebaseTab';

type TabId = 'environment' | 'appium' | 'devices' | 'connection' | 'firebase';
const TABS: { id: TabId; label: string }[] = [
  { id: 'environment', label: 'Environment' },
  { id: 'appium', label: 'Appium' },
  { id: 'devices', label: 'Devices' },
  { id: 'connection', label: 'Test connection' },
  { id: 'firebase', label: 'Firebase' },
];

const DEP_CLASS: Record<DependencyStatus, string> = {
  READY: 'st-passed',
  NOT_INSTALLED: 'st-skipped',
  NOT_FOUND: 'st-skipped',
  NOT_CONFIGURED: 'st-error',
  ERROR: 'st-failed',
};
const DEVICE_CLASS: Record<AndroidDeviceStatus, string> = {
  CONNECTED: 'st-passed',
  BUSY: 'st-running',
  BOOTING: 'st-running',
  DISCONNECTED: 'st-skipped',
  UNAUTHORIZED: 'st-error',
  ERROR: 'st-failed',
};
const GROUP_LABEL: Record<AndroidDependency['group'], string> = {
  system: 'System',
  java: 'Java',
  sdk: 'Android SDK',
  appium: 'Appium',
  devices: 'Emulators',
};

/** Settings → Mobile (Android): environment, Appium, Device Manager, uji koneksi (khusus admin). */
export function AndroidSettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'environment') as TabId;
  if (user?.role !== 'admin')
    return (
      <div className="panel">
        <EmptyState title="Only administrators can change settings">
          Ask an administrator to set up Android automation.
        </EmptyState>
      </div>
    );
  return (
    <div className="settings-page">
      <div className="panel android-tabs">
        <Tabs tabs={TABS} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} />
      </div>
      {tab === 'environment' && <EnvironmentTab />}
      {tab === 'appium' && <AppiumTab />}
      {tab === 'devices' && <DevicesTab />}
      {tab === 'connection' && <ConnectionTab />}
      {tab === 'firebase' && <FirebaseTab />}
    </div>
  );
}

/* ------------------------------- Environment ------------------------------- */

function EnvironmentTab() {
  const env = useAndroidEnvironment();
  const job = useAndroidSetupJob();
  const invalidate = useInvalidate();
  const [setup, setSetup] = useState(false);
  const running = job.data?.status === 'running';
  // Setelah setup selesai, preflight diperbarui.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running)
      invalidate(keys.androidEnvironment, keys.androidDevices, keys.androidAppium);
    wasRunning.current = running;
  }, [running]);

  const report = env.data;
  const missing = report?.dependencies.filter((d) => d.status !== 'READY' && d.fixable) ?? [];
  return (
    <>
      <div className={`banner ${report && !report.ready ? 'warn' : ''}`} role="status">
        <Icon name="android" size={16} />
        <span>
          {env.isFetching && !report
            ? 'Checking this computer (every command is really run)…'
            : report?.ready
              ? 'Android automation is ready: Java, Android SDK, adb, Appium and UiAutomator2 all work.'
              : `${missing.length} item${missing.length === 1 ? '' : 's'} missing or not configured. Setup Android Environment installs only what is missing — no admin password needed.`}
        </span>
      </div>
      <section className="panel">
        <div className="panel-h">
          <h3>Android environment</h3>
          {report && (
            <span className="small muted">
              Checked <DateTime value={report.checkedAt} relative />
            </span>
          )}
          <div className="grow" />
          <IconButton
            icon="refresh"
            label="Check again"
            disabled={env.isFetching}
            onClick={() => env.refetch()}
          />
          <button className="btn primary sm" disabled={running || !report} onClick={() => setSetup(true)}>
            <Icon name="download" size={12} /> {running ? 'Setup running…' : 'Setup Android Environment'}
          </button>
        </div>
        {env.error ? (
          <div className="panel-b">
            <ErrorBox error={env.error} />
          </div>
        ) : !report ? (
          <div className="panel-b">
            <Loading />
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>Dependency</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {report.dependencies.map((d, i) => (
                  <tr
                    key={d.id}
                    className={i && report.dependencies[i - 1].group !== d.group ? 'group-start' : ''}
                  >
                    <td>
                      <b>{d.label}</b>
                      <div className="small muted">{GROUP_LABEL[d.group]}</div>
                    </td>
                    <td>
                      <span className={`status ${DEP_CLASS[d.status]}`}>{d.status}</span>
                    </td>
                    <td className="code small">{d.version ?? '-'}</td>
                    <td className="small" style={{ maxWidth: 420 }}>
                      {d.detail}
                      {d.command && <div className="muted code">$ {d.command}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report && (
          <div className="panel-b small muted" style={{ borderTop: '1px solid var(--line)' }}>
            Android SDK: <span className="code">{report.sdkRoot}</span>
            {report.javaHome && (
              <>
                {' '}
                · JAVA_HOME: <span className="code">{report.javaHome}</span>
              </>
            )}
          </div>
        )}
      </section>
      {job.data && <SetupProgress job={job.data} title="Last setup" />}
      {setup && <SetupModal onClose={() => setSetup(false)} />}
    </>
  );
}

function SetupModal({ onClose }: { onClose: () => void }) {
  const plan = useAndroidSetupPlan();
  const start = useStartAndroidSetup();
  const [acceptLicenses, setAccept] = useState(false);
  const [configureShell, setShell] = useState(false);
  useEffect(() => {
    plan.mutate({ acceptLicenses: false, configureShell: false });
  }, []);
  const steps = plan.data?.steps ?? [];
  const needsLicense = steps.some((s) => s.license);
  const shellMissing = plan.data?.report.dependencies.some(
    (d) => (d.id === 'androidHome' || d.id === 'androidSdkRoot') && d.status !== 'READY',
  );
  const count = steps.length + (configureShell && shellMissing ? 1 : 0);
  const canRun = !!plan.data && count > 0 && (!needsLicense || acceptLicenses) && !start.isPending;
  return (
    <Modal
      title="Setup Android Environment"
      subtitle="Only the missing items are installed, one after another, then everything is checked again. Nothing needs your Mac password; Testora never asks for or stores it."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!canRun}
            onClick={() => start.mutate({ acceptLicenses, configureShell }, { onSuccess: onClose })}
          >
            <Icon name="download" size={13} />{' '}
            {start.isPending ? 'Starting…' : `Install ${count} item${count === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {plan.isPending ? (
        <Loading />
      ) : plan.error ? (
        <ErrorBox error={plan.error} />
      ) : (
        <div className="grid">
          {plan.data?.blocked.map((b) => (
            <div key={b} className="banner warn">
              <Icon name="lock" size={14} /> <span className="small">{b}</span>
            </div>
          ))}
          {!steps.length && !plan.data?.blocked.length && (
            <p className="muted" style={{ margin: 0 }}>
              Everything that Setup can install is already installed.
            </p>
          )}
          {steps.length > 0 && (
            <ol className="setup-steps">
              {steps.map((s) => (
                <li key={s.id}>
                  <b>{s.label}</b>{' '}
                  {s.download && <span className="small muted">({s.download} download)</span>}
                  <div className="code small muted">$ {s.command}</div>
                </li>
              ))}
            </ol>
          )}
          {needsLicense && (
            <label className="row small" style={{ alignItems: 'flex-start', gap: 8 }}>
              <input type="checkbox" checked={acceptLicenses} onChange={(e) => setAccept(e.target.checked)} />
              <span>
                I have read and accept the{' '}
                <a href="https://developer.android.com/studio/terms" target="_blank" rel="noreferrer">
                  Android SDK licenses
                </a>
                . Testora answers “y” to <span className="code">sdkmanager --licenses</span> for you only when
                this is ticked.
              </span>
            </label>
          )}
          {shellMissing && (
            <label className="row small" style={{ alignItems: 'flex-start', gap: 8 }}>
              <input type="checkbox" checked={configureShell} onChange={(e) => setShell(e.target.checked)} />
              <span>
                Also add <span className="code">ANDROID_HOME</span>,{' '}
                <span className="code">ANDROID_SDK_ROOT</span> and PATH to{' '}
                <span className="code">~/.zprofile</span> so adb, emulator and appium work in Terminal. A
                marked block is appended; existing settings are never changed.
              </span>
            </label>
          )}
        </div>
      )}
    </Modal>
  );
}

function SetupProgress({ job, title }: { job: AndroidSetupJob; title: string }) {
  const log = useRef<HTMLPreElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [job.log.length]);
  return (
    <section className="panel">
      <div className="panel-h">
        <h3>{title}</h3>
        <span
          className={`status ${job.status === 'running' ? 'st-running' : job.status === 'done' ? 'st-passed' : 'st-failed'}`}
        >
          {job.status === 'running' ? 'Running' : job.status === 'done' ? 'Done' : 'Failed'}
        </span>
        <div className="grow" />
        <span className="small muted">
          <DateTime value={job.startedAt} />
        </span>
      </div>
      <div className="panel-b grid">
        <ul className="setup-steps done">
          {job.steps.map((s) => (
            <li key={s.id}>
              <span
                className={`ri ${s.status === 'done' ? 'passed' : s.status === 'failed' ? 'failed' : s.status === 'running' ? 'running' : 'skipped'}`}
              >
                <Icon
                  name={
                    s.status === 'done'
                      ? 'check'
                      : s.status === 'failed'
                        ? 'x'
                        : s.status === 'running'
                          ? 'spin'
                          : 'minus'
                  }
                  size={11}
                  strokeWidth={3}
                />
              </span>{' '}
              <b>{s.label}</b>
              {s.error && <div className="small text-fail">{s.error}</div>}
            </li>
          ))}
        </ul>
        <pre ref={log} className="setup-log code">
          {job.log.join('\n')}
        </pre>
      </div>
    </section>
  );
}

/* --------------------------------- Appium --------------------------------- */

function AppiumTab() {
  const health = useAppiumHealth();
  const server = useAppiumServer();
  const settings = useAppiumSettings();
  const save = useSaveAppiumSettings();
  const reset = useResetAppiumSettings();
  const check = useTestAppium();
  const toast = useToast();
  const confirm = useConfirm();
  const [showLog, setShowLog] = useState(false);
  const log = useAppiumLog(showLog);
  const [form, setForm] = useState<AppiumSettings>({
    serverUrl: '',
    capabilities: '',
    defaultMode: 'emulator',
  });
  useEffect(() => {
    if (settings.data)
      setForm({
        serverUrl: settings.data.serverUrl,
        capabilities: settings.data.capabilities,
        defaultMode: settings.data.defaultMode,
      });
  }, [settings.data]);
  const h = health.data;
  const capsError = (() => {
    if (!form.capabilities.trim()) return '';
    try {
      const v = JSON.parse(form.capabilities);
      return v && typeof v === 'object' && !Array.isArray(v) ? '' : 'Must be a JSON object { … }';
    } catch (e) {
      return (e as Error).message;
    }
  })();
  const valid = /^https?:\/\/.+/i.test(form.serverUrl.trim()) && !capsError;
  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <h3>Appium health</h3>
          <div className="grow" />
          <IconButton
            icon="refresh"
            label="Check again"
            disabled={health.isFetching}
            onClick={() => health.refetch()}
          />
          {h?.serverRunning && h.managed ? (
            <button
              className="btn sm danger"
              disabled={server.stop.isPending}
              onClick={() => server.stop.mutate()}
            >
              <Icon name="stop" size={12} /> Stop Appium
            </button>
          ) : (
            <button
              className="btn sm primary"
              disabled={!h?.installed || h.serverRunning || server.start.isPending}
              onClick={() => server.start.mutate(undefined, { onSuccess: (r) => toast(r.message) })}
            >
              <Icon name="play" size={12} /> {server.start.isPending ? 'Starting…' : 'Start Appium'}
            </button>
          )}
        </div>
        {!h ? (
          <div className="panel-b">
            <Loading />
          </div>
        ) : (
          <div className="panel-b grid">
            <div className="health-grid">
              <HealthItem label="Appium installed" ok={h.installed} value={h.version ?? 'Not installed'} />
              <HealthItem
                label="UiAutomator2 driver"
                ok={h.uiautomator2Installed}
                value={h.uiautomator2Version ?? 'Not installed'}
              />
              <HealthItem
                label="Appium server"
                ok={h.serverRunning}
                value={
                  h.serverRunning
                    ? `Running ${h.serverVersion ?? ''}${h.managed ? ' · started by Testora' : ''}`
                    : 'Not running'
                }
              />
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {h.message} {h.path && <span className="code">{h.path}</span>}
            </p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-h">
          <h3>Server & defaults</h3>
        </div>
        <div className="panel-b grid">
          <Field
            label="Appium server URL"
            hint="Appium on this computer: http://127.0.0.1:4723 (Testora starts it automatically when a test needs it)."
          >
            <input
              className="in code"
              autoComplete="off"
              value={form.serverUrl}
              placeholder="http://127.0.0.1:4723"
              onChange={(e) => setForm({ ...form, serverUrl: e.target.value })}
            />
          </Field>
          <Field
            group
            label="Default execution mode"
            hint="Used by bulk runs and schedules. Manual runs choose it on the Run button."
          >
            <Segmented
              options={MODE_OPTIONS}
              value={form.defaultMode}
              onChange={(defaultMode: MobileExecutionMode) => setForm({ ...form, defaultMode })}
            />
          </Field>
          <Field
            label="Default capabilities (JSON, optional)"
            hint={
              capsError ? (
                <span className="text-fail">{capsError}</span>
              ) : (
                'Added to every Android test, e.g. {"appium:newCommandTimeout": 600}. A test can override them.'
              )
            }
          >
            <textarea
              className="in code"
              rows={5}
              spellCheck={false}
              value={form.capabilities}
              placeholder='{ "appium:autoGrantPermissions": true }'
              onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
            />
          </Field>
        </div>
        <div className="panel-b row settings-actions">
          <button
            className="btn"
            disabled={!valid || check.isPending}
            onClick={() => check.mutate(form, { onSuccess: (r) => toast(r.message) })}
          >
            <Icon name="pulse" size={13} /> {check.isPending ? 'Checking…' : 'Check URL'}
          </button>
          <div className="grow" />
          {settings.data?.source === 'app' && (
            <button
              className="btn ghost"
              onClick={async () =>
                (await confirm({
                  title: 'Remove the saved Appium settings?',
                  message: 'Testora then uses http://127.0.0.1:4723 and the Android Emulator mode.',
                  confirmLabel: 'Remove',
                })) && reset.mutate(undefined, { onSuccess: () => toast('Appium settings removed') })
              }
            >
              Remove saved settings
            </button>
          )}
          <button
            className="btn primary"
            disabled={!valid || save.isPending}
            onClick={() => save.mutate(form, { onSuccess: () => toast('Appium settings saved') })}
          >
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-h">
          <h3>Appium log</h3>
          <span className="small muted">
            Only for an Appium server started by Testora. Secrets are masked.
          </span>
          <div className="grow" />
          <button className="btn sm" onClick={() => setShowLog((v) => !v)}>
            <Icon name="terminal" size={12} /> {showLog ? 'Hide' : 'Show'}
          </button>
        </div>
        {showLog && (
          <div className="panel-b">
            <pre className="setup-log code">{log.data?.lines.join('\n') || 'No log yet.'}</pre>
          </div>
        )}
      </section>
    </>
  );
}

function HealthItem({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className={`health-item ${ok ? 'ok' : ''}`}>
      <span className={`ri ${ok ? 'passed' : 'skipped'}`}>
        <Icon name={ok ? 'check' : 'minus'} size={11} strokeWidth={3} />
      </span>
      <div>
        <div className="small muted">{label}</div>
        <b>{value}</b>
      </div>
    </div>
  );
}

/* --------------------------------- Devices --------------------------------- */

function DevicesTab() {
  const devices = useAndroidDevices(true, true);
  const actions = useDeviceActions();
  const toast = useToast();
  const confirm = useConfirm();
  const [wizard, setWizard] = useState(false);
  const stopEmulator = async (d: AndroidDevice) => {
    const busy = d.status === 'BUSY';
    if (
      busy &&
      !(await confirm({
        title: `Force stop ${d.name}?`,
        message: `${d.detail} That test is stopped first (its results so far are kept), then the emulator is shut down — killed if it does not respond. Tests waiting for this emulator will fail to start until you start it again.`,
        confirmLabel: 'Force stop',
      }))
    )
      return;
    actions.stopEmulator.mutate(
      { serial: d.id, force: busy },
      { onSuccess: (r) => toast(r.message), onError: (e) => toast((e as Error).message) },
    );
  };
  const avdJob = useAvdJob(true);
  const list = devices.data ?? [];
  const avds = list.filter((d) => d.type === 'emulator');
  const phones = list.filter((d) => d.type === 'device');
  const noAvd = !avds.some((d) => d.avd);

  const row = (d: AndroidDevice) => (
    <tr key={d.id}>
      <td>
        <b>{d.name}</b>
        {d.status === 'UNAUTHORIZED' ? <div className="small text-fail">ADB Unauthorized</div> : null}
      </td>
      <td className="code small">{d.id.startsWith('avd:') ? '-' : d.id}</td>
      <td>{d.type === 'emulator' ? 'Emulator' : `Device · ${d.connection}`}</td>
      <td>
        {d.androidVersion || '-'}
        {d.apiLevel && <span className="small muted"> (API {d.apiLevel})</span>}
      </td>
      <td>
        <span className={`status ${DEVICE_CLASS[d.status]}`}>{d.status}</span>
      </td>
      <td className="small" style={{ maxWidth: 320 }}>
        {d.automationReady ? <b className="text-pass">Ready</b> : d.detail}
      </td>
      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        {d.id.startsWith('avd:') && d.status === 'DISCONNECTED' && (
          <button
            className="btn sm"
            disabled={actions.startEmulator.isPending}
            onClick={() =>
              actions.startEmulator.mutate(d.avd!, {
                onSuccess: () => toast(`Starting ${d.avd}… it appears as BOOTING, then CONNECTED.`),
              })
            }
          >
            <Icon name="play" size={11} /> Start
          </button>
        )}
        {d.type === 'emulator' && !d.id.startsWith('avd:') && (
          <button
            className={`btn sm ${d.status === 'BUSY' ? 'danger' : 'ghost'}`}
            title={
              d.status === 'BUSY'
                ? 'Stops the test using this emulator, then shuts the emulator down'
                : 'Shut the emulator down'
            }
            disabled={actions.stopEmulator.isPending}
            onClick={() => void stopEmulator(d)}
          >
            <Icon name={actions.stopEmulator.isPending ? 'spin' : 'stop'} size={11} />{' '}
            {d.status === 'BUSY' ? 'Force stop' : 'Stop'}
          </button>
        )}
      </td>
    </tr>
  );
  const head = (
    <thead>
      <tr>
        <th>Device name</th>
        <th>Device ID</th>
        <th>Type</th>
        <th>Android version</th>
        <th>Status</th>
        <th>Automation status</th>
        <th />
      </tr>
    </thead>
  );

  return (
    <>
      <section className="panel">
        <div className="panel-h">
          <h3>Android emulators</h3>
          <div className="grow" />
          <IconButton
            icon="refresh"
            label="Look again"
            disabled={devices.isFetching}
            onClick={() => devices.refetch()}
          />
          <button
            className="btn sm primary"
            onClick={() => setWizard(true)}
            disabled={avdJob.data?.status === 'running'}
          >
            <Icon name="plus" size={12} /> Create Android Emulator
          </button>
        </div>
        {devices.isLoading ? (
          <div className="panel-b">
            <Loading />
          </div>
        ) : noAvd ? (
          <EmptyState title="No Android Virtual Device found">
            Create one to run tests without a phone.
          </EmptyState>
        ) : (
          <div className="tbl-wrap">
            <table className="t">
              {head}
              <tbody>{avds.map(row)}</tbody>
            </table>
          </div>
        )}
      </section>
      {avdJob.data && <SetupProgress job={avdJob.data} title="Create Android Emulator" />}

      <section className="panel">
        <div className="panel-h">
          <h3>Physical Android devices</h3>
          <span className="small muted">Connected with a USB cable (USB debugging)</span>
        </div>
        {phones.length ? (
          <div className="tbl-wrap">
            <table className="t">
              {head}
              <tbody>{phones.map(row)}</tbody>
            </table>
          </div>
        ) : (
          <div className="panel-b small">
            <p style={{ marginTop: 0 }}>No phone is connected. To use one:</p>
            <ol className="setup-steps">
              <li>
                On the phone: Settings → About phone → tap <b>Build number</b> 7 times to enable Developer
                options.
              </li>
              <li>
                Settings → System → Developer options → turn on <b>USB debugging</b>.
              </li>
              <li>
                Connect it with a USB cable, unlock it and accept <b>Allow USB debugging?</b> (tick “Always
                allow”).
              </li>
              <li>It appears here as CONNECTED within a few seconds.</li>
            </ol>
          </div>
        )}
      </section>
      {wizard && <CreateEmulatorModal onClose={() => setWizard(false)} />}
    </>
  );
}

function CreateEmulatorModal({ onClose }: { onClose: () => void }) {
  const options = useAvdOptions(true);
  const create = useCreateAvd();
  const [form, setForm] = useState({ name: '', device: '', image: '', ramMb: 2048, storageMb: 6144 });
  useEffect(() => {
    if (options.data) setForm(options.data.defaults);
  }, [options.data]);
  const image = options.data?.images.find((i) => i.id === form.image);
  const valid = /^[A-Za-z0-9._-]{1,60}$/.test(form.name) && !!form.device && !!form.image;
  return (
    <Modal
      title="Create Android Emulator"
      subtitle="A new Android Virtual Device is created only when you click Create. Defaults suit this computer; change them if you like."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate(form, { onSuccess: onClose })}
          >
            {create.isPending ? 'Starting…' : 'Create emulator'}
          </button>
        </>
      }
    >
      {options.isLoading ? (
        <Loading />
      ) : options.error ? (
        <ErrorBox error={options.error} />
      ) : (
        <div className="grid">
          <Field label="Name" hint="Letters, numbers, dot, dash and underscore.">
            <input
              className="in code"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Device">
            <select
              className="in"
              value={form.device}
              onChange={(e) => setForm({ ...form, device: e.target.value })}
            >
              {options.data?.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Android version"
            hint={
              image && !image.installed
                ? 'This system image is downloaded first (≈ 1.5–2 GB).'
                : 'Installed images are listed first.'
            }
          >
            <select
              className="in"
              value={form.image}
              onChange={(e) => setForm({ ...form, image: e.target.value })}
            >
              {options.data?.images.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.androidVersion ? `Android ${i.androidVersion}` : 'Android'} (API {i.apiLevel})
                  {i.installed ? ' · installed' : ''}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid two">
            <Field label="RAM (MB)">
              <input
                className="in"
                type="number"
                min={1024}
                max={8192}
                step={512}
                value={form.ramMb}
                onChange={(e) => setForm({ ...form, ramMb: Number(e.target.value) })}
              />
            </Field>
            <Field label="Storage (MB)">
              <input
                className="in"
                type="number"
                min={2048}
                max={65536}
                step={1024}
                value={form.storageMb}
                onChange={(e) => setForm({ ...form, storageMb: Number(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------- Connection ------------------------------- */

function ConnectionTab() {
  const test = useTestAndroidConnection();
  const devices = useAndroidDevices();
  const [mode, setMode] = useState<'emulator' | 'device'>('emulator');
  const [udid, setUdid] = useState('');
  const result = test.data;
  const ready = (devices.data ?? []).filter((d) => d.automationReady && d.type === mode);
  return (
    <section className="panel">
      <div className="panel-h">
        <h3>Test Android Connection</h3>
      </div>
      <div className="panel-b grid">
        <p className="small muted" style={{ margin: 0 }}>
          Checks Appium, UiAutomator2 and adb, finds a device, creates a real Appium session, opens the
          Android Settings app, takes a screenshot and closes the session. Nothing is installed or changed on
          the device.
        </p>
        <div className="row wrap" style={{ gap: 12 }}>
          <Segmented
            options={[
              { id: 'emulator', label: 'Android Emulator' },
              { id: 'device', label: 'Android Device' },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setUdid('');
            }}
          />
          <select
            className="in"
            style={{ maxWidth: 320 }}
            value={udid}
            onChange={(e) => setUdid(e.target.value)}
          >
            <option value="">First ready {mode === 'device' ? 'device' : 'emulator'}</option>
            {ready.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.id}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            disabled={test.isPending}
            onClick={() => test.mutate({ mode, udid: udid || undefined })}
          >
            <Icon name="android" size={13} />{' '}
            {test.isPending ? 'Testing… (up to a minute)' : 'Test Android Connection'}
          </button>
        </div>
        {result && (
          <div className="connection-result">
            <div className="grid">
              <b className={result.ok ? 'text-pass' : 'text-fail'} style={{ fontSize: 16 }}>
                {result.message}
              </b>
              {result.errorCode && <MobileErrorHelp code={result.errorCode} />}
              <ul className="setup-steps done">
                {result.checks.map((c) => (
                  <li key={c.id + c.label}>
                    <span
                      className={`ri ${c.status === 'passed' ? 'passed' : c.status === 'failed' ? 'failed' : 'skipped'}`}
                    >
                      <Icon
                        name={c.status === 'passed' ? 'check' : c.status === 'failed' ? 'x' : 'minus'}
                        size={11}
                        strokeWidth={3}
                      />
                    </span>{' '}
                    <b>{c.label}</b> <span className="small muted">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
            {result.screenshot && (
              <img
                className="connection-shot"
                src={`data:image/png;base64,${result.screenshot}`}
                alt="Screenshot from the device"
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
