import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MobileErrorCode, MobileExecutionMode } from '@flowqa/shared';
import { MOBILE_EXECUTION_MODE_LABEL } from '@flowqa/shared';
import { Icon } from '@/components/Icon';
import { Segmented } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';

const MODE_KEY = 'testora.mobileMode';
export const MODE_OPTIONS = (['mock', 'emulator', 'device'] as const).map((id) => ({
  id,
  label: MOBILE_EXECUTION_MODE_LABEL[id],
}));

/**
 * Mode eksekusi test mobile. Pilihan awal: mode bawaan app test itu (Apps), lalu
 * pilihan terakhir di browser ini untuk project yang aktif, lalu Android Emulator.
 */
export function useExecutionMode(
  appDefault?: MobileExecutionMode | '',
): [MobileExecutionMode, (mode: MobileExecutionMode) => void] {
  const { projectId = '' } = useWorkspace();
  const key = `${MODE_KEY}.${projectId}`;
  const [chosen, setChosen] = useState<{ projectId: string; mode: MobileExecutionMode } | null>(null);
  const remembered = (): MobileExecutionMode | undefined => {
    try {
      const saved = localStorage.getItem(key) ?? localStorage.getItem(MODE_KEY);
      return saved === 'mock' || saved === 'device' || saved === 'emulator' ? saved : undefined;
    } catch {
      return undefined;
    }
  };
  const mode =
    (chosen?.projectId === projectId ? chosen.mode : undefined) || appDefault || remembered() || 'emulator';
  const set = (next: MobileExecutionMode) => {
    setChosen({ projectId, mode: next });
    try {
      localStorage.setItem(key, next);
    } catch {
      // Penyimpanan browser tidak tersedia: pilihan hanya berlaku di halaman ini.
    }
  };
  return [mode, set];
}

/** Pilihan "Execution Mode": Mock / Android Emulator / Android Device. */
export function ExecutionModePicker({
  value,
  onChange,
}: {
  value: MobileExecutionMode;
  onChange: (mode: MobileExecutionMode) => void;
}) {
  return (
    <span
      className="row"
      style={{ gap: 6 }}
      title="Where the mobile test runs. Mock = built-in demo app, no device needed."
    >
      <span className="small muted">Run on</span>
      <Segmented options={MODE_OPTIONS} value={value} onChange={onChange} />
    </span>
  );
}

const SETTINGS = '/settings/android';

const HELP: Record<
  MobileErrorCode,
  { message: string; action?: string; tab?: string; instructions?: string }
> = {
  APPIUM_NOT_INSTALLED: { message: 'Appium is not installed.', action: 'Setup Appium', tab: 'environment' },
  UIAUTOMATOR2_NOT_INSTALLED: {
    message: 'The Appium UiAutomator2 driver is not installed.',
    action: 'Setup Appium',
    tab: 'environment',
  },
  APPIUM_NOT_RUNNING: { message: 'The Appium server is not running.', action: 'Start Appium', tab: 'appium' },
  ANDROID_SDK_NOT_FOUND: {
    message: 'Android SDK was not detected.',
    action: 'Setup Android SDK',
    tab: 'environment',
  },
  NO_DEVICE: {
    message: 'No Android emulator or physical device is available.',
    action: 'Device Manager',
    tab: 'devices',
  },
  ADB_UNAUTHORIZED: {
    message: 'Android device is connected but USB debugging authorization is pending.',
    instructions:
      'Unlock your device and accept the “Allow USB debugging?” prompt (tick “Always allow from this computer”). If no prompt appears: unplug and plug the cable in again, or open Developer options → Revoke USB debugging authorizations, then reconnect.',
  },
  DEVICE_LOCKED: {
    message: 'The phone is connected, but its screen is locked.',
    instructions:
      'Unlock the phone and keep it unlocked while testing. On a dedicated test phone: Developer options → Stay awake (screen stays on while charging), and Settings → Lock screen → Screen lock type: None or Swipe. Testora never unlocks a device or asks for its PIN.',
  },
  DEVICE_BUSY: { message: 'The device is busy with another test.', action: 'Device Manager', tab: 'devices' },
  APPIUM_SESSION_FAILED: {
    message: 'Could not create Appium session. See the Appium log, device and capabilities below.',
    action: 'Test Android Connection',
    tab: 'connection',
  },
  APP_NOT_CONFIGURED: {
    message: 'The app of this test is not set. Choose an APK or the app package in the test.',
  },
  APP_LAUNCH_FAILED: {
    message:
      'The Appium session started, but the app did not open. Check the package/activity, or whether the app crashes on start (see the ADB log).',
    action: 'Device Manager',
    tab: 'devices',
  },
  SESSION_LOST: { message: 'The Appium session ended (the app crashed or the device disconnected).' },
};

/** Penjelasan error mobile + tombol tindak lanjut. */
export function MobileErrorHelp({ code, detail }: { code: MobileErrorCode; detail?: string }) {
  const help = HELP[code];
  const [open, setOpen] = useState(false);
  return (
    <div className="mobile-error" role="alert">
      <b className="mobile-error-msg">{help.message}</b>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="chip plain code">{code}</span>
        <span className="grow" />
        {help.action && help.tab && (
          <Link className="btn sm" to={`${SETTINGS}?tab=${help.tab}`}>
            {help.action}
          </Link>
        )}
        {help.instructions && (
          <button className="btn sm" type="button" onClick={() => setOpen((o) => !o)}>
            <Icon name="eye" size={12} /> View Instructions
          </button>
        )}
      </div>
      {detail && detail !== help.message && <div className="small mt-8">{detail}</div>}
      {open && help.instructions && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {help.instructions}
        </p>
      )}
    </div>
  );
}
