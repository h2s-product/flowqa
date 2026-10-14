import { useRef } from 'react';
import type { MobileAppConfig } from '@flowqa/shared';
import { FIREBASE_LATEST_APP } from '@flowqa/shared';
import { useAndroidDevices, useApks, useUploadApk } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { Field, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';

export const EMPTY_MOBILE_APP: MobileAppConfig = {
  platform: 'android',
  app: '',
  appPackage: '',
  appActivity: '',
  deviceName: '',
  platformVersion: '',
  udid: '',
  noReset: true,
  capabilities: '',
};

/** Aplikasi siap dijalankan: file APK, atau package aplikasi yang terpasang. */
export const mobileAppReady = (m: MobileAppConfig) => !!(m.app.trim() || m.appPackage.trim());

export const platformLabel = () => 'Android';

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Isian aplikasi & perangkat untuk test Android (dipakai di form test baru & editor). */
export function MobileAppFields({
  value,
  onChange,
}: {
  value: MobileAppConfig;
  onChange: (value: MobileAppConfig) => void;
}) {
  const set = (patch: Partial<MobileAppConfig>) => onChange({ ...value, ...patch });
  const devices = useAndroidDevices();
  const apks = useApks();
  const upload = useUploadApk();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const connected = (devices.data ?? []).filter((d) => !d.id.startsWith('avd:'));

  const onFile = (f?: File) => {
    if (!f) return;
    upload.mutate(f, {
      onSuccess: (apk) => {
        set({ app: apk.path });
        toast(`${apk.name} uploaded (${formatSize(apk.size)})`);
      },
    });
  };

  return (
    <div className="grid">
      <Field
        group
        label="App (APK)"
        hint={
          value.app === FIREBASE_LATEST_APP
            ? 'Each run downloads (if needed) and installs the newest APK release from Firebase App Distribution.'
            : 'Upload an .apk, pick one uploaded before, use the latest Firebase release, or type a path on the Testora server. Leave empty to open an app that is already installed (package below).'
        }
      >
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            className="in code grow"
            list="testora-apks"
            value={value.app}
            placeholder="/path/to/app-debug.apk or {{APP_PATH}}"
            onChange={(e) => set({ app: e.target.value })}
          />
          <datalist id="testora-apks">
            {(apks.data ?? []).map((a) => (
              <option key={a.path} value={a.path}>
                {a.name} · {formatSize(a.size)}
              </option>
            ))}
          </datalist>
          <input
            ref={file}
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            className={`btn ${value.app === FIREBASE_LATEST_APP ? 'blue' : ''}`}
            type="button"
            title="Every run uses the newest APK release from Firebase App Distribution (Settings → Mobile (Android) → Firebase)"
            onClick={() => set({ app: FIREBASE_LATEST_APP })}
          >
            <Icon name="download" size={13} /> Latest Firebase release
          </button>
          <button
            className="btn"
            type="button"
            disabled={upload.isPending}
            onClick={() => file.current?.click()}
          >
            <Icon name="upload" size={13} /> {upload.isPending ? 'Uploading…' : 'Upload APK'}
          </button>
        </div>
      </Field>
      <div className="grid two">
        <Field label="App package" hint="e.g. com.company.app — used to launch, close and restart the app.">
          <input
            className="in code"
            value={value.appPackage}
            placeholder="com.company.app"
            onChange={(e) => set({ appPackage: e.target.value })}
          />
        </Field>
        <Field
          label="App activity (optional)"
          hint="The launch activity, e.g. .MainActivity. Found automatically when empty."
        >
          <input
            className="in code"
            value={value.appActivity}
            placeholder=".MainActivity"
            onChange={(e) => set({ appActivity: e.target.value })}
          />
        </Field>
      </div>
      <Field
        label="Device"
        hint={
          connected.length
            ? 'Any available device of the chosen execution mode is used, unless you pin one here.'
            : devices.isLoading
              ? 'Looking for devices…'
              : 'No Android device is connected right now. Start an emulator in Settings → Mobile (Android) → Devices, or connect a phone with USB debugging.'
        }
      >
        <select
          className="in"
          value={value.udid}
          onChange={(e) => {
            const d = connected.find((x) => x.id === e.target.value);
            set(
              d
                ? {
                    udid: d.id,
                    deviceName: d.name,
                    platformVersion: d.androidVersion.replace(/^Android /, ''),
                  }
                : { udid: '', deviceName: '', platformVersion: '' },
            );
          }}
        >
          <option value="">Any available device</option>
          {connected.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.id} · {d.androidVersion} ({d.status})
            </option>
          ))}
          {value.udid && !connected.some((d) => d.id === value.udid) && (
            <option value={value.udid}>{value.deviceName || value.udid} (not connected)</option>
          )}
        </select>
      </Field>
      <Toggle checked={!value.noReset} onChange={(reset) => set({ noReset: !reset })}>
        <span>
          <b>Start with a fresh app</b>
          <span className="small muted">
            {' '}
            — clears the app data before each run (you are logged out). Off keeps the data, which is faster.
            The app always starts from its launch screen.
          </span>
        </span>
      </Toggle>
      <details className="rec-login-advanced">
        <summary className="small">Extra capabilities</summary>
        <div className="grid mt-12">
          <Field
            label="Capabilities (JSON)"
            hint='Added to this test only, e.g. {"appium:language": "id", "appium:locale": "ID"}. Keys without a prefix get "appium:".'
          >
            <textarea
              className="in code"
              rows={4}
              spellCheck={false}
              value={value.capabilities}
              placeholder='{ "appium:autoGrantPermissions": true }'
              onChange={(e) => set({ capabilities: e.target.value })}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}
