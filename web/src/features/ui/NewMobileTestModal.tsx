import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MobileAppConfig, ProjectApp } from '@flowqa/shared';
import { useStartInspector } from '@/api/queries';
import { FolderSelect } from '@/components/folders/FolderSelect';
import type { FolderIndex } from '@/components/folders/folderIndex';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Field } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { EMPTY_MOBILE_APP, MobileAppFields, mobileAppReady } from './MobileAppFields';
import { ExecutionModePicker, useExecutionMode } from './mobileMode';
import { AppSelect } from '@/features/apps/AppSelect';

/** Test mobile baru: pilih aplikasi & perangkat, lalu rekam di Mobile Inspector. */
export function NewMobileTestModal({
  folderIndex,
  defaultFolderId = null,
  onClose,
}: {
  folderIndex: FolderIndex;
  defaultFolderId?: string | null;
  onClose: () => void;
}) {
  const { projectId = '', environment } = useWorkspace();
  const start = useStartInspector(projectId);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [mobile, setMobile] = useState<MobileAppConfig>(EMPTY_MOBILE_APP);
  const [chosenApp, setChosenApp] = useState<ProjectApp | null>(null);
  const [mode, setMode] = useExecutionMode(chosenApp?.android?.defaultMode);
  const pickApp = (app: ProjectApp | null) => {
    setChosenApp(app);
    // Package & sumber APK diambil dari app (masih bisa diubah di bawah).
    const android = app?.android;
    if (android)
      setMobile((m) => ({
        ...m,
        appPackage: android.appPackage,
        appActivity: android.appActivity,
        app: android.app,
      }));
  };
  // Mock Mode memakai aplikasi Demo Shop bawaan: cukup isi package-nya.
  const app = mode === 'mock' && !mobileAppReady(mobile) ? { ...mobile, appPackage: 'com.demo' } : mobile;
  const canStart = !!name.trim() && mobileAppReady(app) && !start.isPending;

  const submit = () =>
    start.mutate(
      {
        name: name.trim(),
        folderId,
        mobile: app,
        environmentId: environment?.id,
        mode,
        ...(chosenApp ? { appId: chosenApp.id } : {}),
      },
      {
        onSuccess: (session) => {
          onClose();
          navigate(`/ui/mobile/${session.id}`);
        },
      },
    );

  return (
    <Modal
      title="New Android test"
      subtitle="The app opens on the emulator or phone through Appium + UiAutomator2. In the Mobile Inspector, click an element on the screen and choose what to do — each action becomes a test step."
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canStart}>
            <Icon name="android" size={14} /> {start.isPending ? 'Connecting…' : 'Open Mobile Inspector'}
          </button>
        </>
      }
    >
      <div className="grid">
        <Field label="Test name">
          <input
            className="in"
            autoFocus
            value={name}
            placeholder="e.g. Login and create an order"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="App"
          hint={
            chosenApp?.android?.formFactor
              ? `${chosenApp.name} is recorded and run on a ${chosenApp.android.formFactor}.`
              : 'The app of the project this test belongs to (Apps). Its package, Firebase and device are used.'
          }
        >
          <AppSelect projectId={projectId} platform="android" value={chosenApp?.id} onChange={pickApp} />
        </Field>
        <div className="row wrap" style={{ gap: 8 }}>
          <ExecutionModePicker value={mode} onChange={setMode} />
          {mode === 'mock' && (
            <span className="small muted">
              Mock Mode opens the built-in Demo Shop app — no device needed.
            </span>
          )}
        </div>
        <MobileAppFields value={mobile} onChange={setMobile} />
        <Field label="Folder">
          <FolderSelect index={folderIndex} value={folderId} onChange={setFolderId} />
        </Field>
        {environment && (
          <p className="small muted" style={{ margin: 0 }}>
            {'{{VARIABLES}}'} in the app path and typed text come from the “{environment.name}” environment.
          </p>
        )}
      </div>
    </Modal>
  );
}
