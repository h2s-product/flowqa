import { useState } from 'react';
import type { EnvVariable, Environment, RecordingLogin } from '@flowqa/shared';
import { RECORDING_VARIABLES } from '@flowqa/shared';
import { useNavigate } from 'react-router-dom';
import { useStartRecording } from '@/api/queries';
import { FolderSelect } from '@/components/folders/FolderSelect';
import type { FolderIndex } from '@/components/folders/folderIndex';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Field, Toggle } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';

const EMPTY_LOGIN: RecordingLogin = {
  username: '',
  password: '',
  usernameSelector: '',
  passwordSelector: '',
  submitSelector: '',
};
const usesVariable = (value = '') => value.includes('{{');
const ref = (key: string) => `{{${key}}}`;

type RememberPart = keyof typeof RECORDING_VARIABLES;

/** URL & login yang sudah diingat di environment (dari rekaman sebelumnya). */
function savedInputs(environment?: Environment | null) {
  const find = (key: string) => environment?.variables.find((v) => v.key === key && v.value);
  return {
    url: find(RECORDING_VARIABLES.url),
    user: find(RECORDING_VARIABLES.user),
    password: find(RECORDING_VARIABLES.password),
  };
}

const REMEMBER_LABEL: Record<RememberPart, string> = {
  url: 'Start URL',
  user: 'Username',
  password: 'Password',
};

/**
 * Mulai merekam test UI baru: nama, URL awal, folder, dan (opsional) login
 * otomatis supaya user tidak perlu login manual di jendela Chrome.
 */
export function NewRecordingModal({
  folderIndex,
  defaultFolderId = null,
  onClose,
}: {
  folderIndex: FolderIndex;
  defaultFolderId?: string | null;
  onClose: () => void;
}) {
  const { projectId = '', environment } = useWorkspace();
  const start = useStartRecording(projectId);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  // Rekaman sebelumnya sudah menyimpan URL & login → langsung terisi dengan variabelnya.
  const saved = savedInputs(environment);
  const savedLogin = !!(saved.user && saved.password);
  const [startUrl, setStartUrl] = useState(saved.url ? ref(RECORDING_VARIABLES.url) : 'https://');
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId);
  const [useEnv, setUseEnv] = useState(false);
  const [signIn, setSignIn] = useState(savedLogin);
  const [login, setLogin] = useState<RecordingLogin>(
    savedLogin
      ? {
          ...EMPTY_LOGIN,
          username: ref(RECORDING_VARIABLES.user),
          password: ref(RECORDING_VARIABLES.password),
        }
      : EMPTY_LOGIN,
  );
  const setLoginField = (patch: Partial<RecordingLogin>) => setLogin((l) => ({ ...l, ...patch }));
  const useSavedLogin = () =>
    setLoginField({ username: ref(RECORDING_VARIABLES.user), password: ref(RECORDING_VARIABLES.password) });

  // Nilai yang diketik langsung (bukan {{VARIABEL}}) bisa diingat untuk rekaman berikutnya.
  const rememberable = (
    [
      ['url', startUrl.trim(), saved.url],
      ['user', signIn ? login.username.trim() : '', saved.user],
      ['password', signIn ? login.password : '', saved.password],
    ] as [RememberPart, string, EnvVariable | undefined][]
  )
    .filter(([, value]) => value && !usesVariable(value) && value !== 'https://')
    // Secret tidak pernah dikirim ke browser, jadi password tersimpan selalu dianggap "diganti".
    .map(([part, value, existing]) => ({
      part,
      replaces: !!existing && (existing.secret || existing.value !== value),
    }));
  const replacesSaved = rememberable.some((r) => r.replaces);
  const [rememberChoice, setRemember] = useState<boolean | null>(null);
  // Bawaan: ingat, kecuali akan menimpa nilai yang sudah tersimpan (harus dicentang sendiri).
  const remember = !!environment && rememberable.length > 0 && (rememberChoice ?? !replacesSaved);

  const validUrl = /^(https?:\/\/.+|\{\{.+\}\})/i.test(startUrl.trim());
  const loginReady = !signIn || !!login.password;
  const canStart = !!name.trim() && validUrl && loginReady && !start.isPending;
  // {{VARIABEL}} hanya bisa diterjemahkan bila environment ikut dikirim.
  const needsEnv =
    useEnv ||
    remember ||
    usesVariable(startUrl) ||
    (signIn && (usesVariable(login.username) || usesVariable(login.password)));
  const variableKeys = environment?.variables.map((v) => `{{${v.key}}}`) ?? [];

  const submit = () =>
    start.mutate(
      {
        name: name.trim(),
        startUrl: startUrl.trim(),
        folderId,
        environmentId: needsEnv ? environment?.id : undefined,
        login: signIn ? login : undefined,
        remember: remember ? Object.fromEntries(rememberable.map((r) => [r.part, true])) : undefined,
      },
      {
        onSuccess: (session) => {
          onClose();
          navigate(`/ui/record/${session.id}`);
        },
      },
    );

  return (
    <Modal
      title="New recording"
      subtitle="A Chrome window opens on the computer running this server. Use your web app normally — every click and input becomes a test step."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!canStart}>
            <Icon name="record" size={14} />{' '}
            {start.isPending
              ? signIn
                ? 'Opening browser & signing in…'
                : 'Opening browser…'
              : 'Start recording'}
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
          label="Start URL"
          hint={
            saved.url && startUrl !== ref(RECORDING_VARIABLES.url) ? (
              <>
                Saved from an earlier recording: <span className="code">{saved.url.value}</span> ·{' '}
                <button
                  className="link-btn"
                  type="button"
                  onClick={() => setStartUrl(ref(RECORDING_VARIABLES.url))}
                >
                  Use {ref(RECORDING_VARIABLES.url)}
                </button>
              </>
            ) : saved.url ? (
              <>
                <span className="code">{ref(RECORDING_VARIABLES.url)}</span> = {saved.url.value} (saved in “
                {environment?.name}”)
              </>
            ) : (
              'The page the recording opens first. You can use {{BASE_URL}} or other environment variables.'
            )
          }
        >
          <input
            className="in code"
            value={startUrl}
            placeholder="https://your-app.example.com/login"
            onChange={(e) => setStartUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canStart && submit()}
          />
        </Field>
        <div className="rec-login">
          <Toggle checked={signIn} onChange={setSignIn}>
            <span>
              <b>Sign in automatically</b>
              <span className="small muted">
                {' '}
                — the login form on the start page is filled in for you, and saved as the first steps of the
                test.
              </span>
            </span>
          </Toggle>
          {signIn && (
            <div className="grid mt-12">
              <div className="grid two">
                <Field label="Username or email">
                  <input
                    className="in code"
                    list="rec-login-vars"
                    autoComplete="off"
                    value={login.username}
                    placeholder="qa@example.com or {{API_USER}}"
                    onChange={(e) => setLoginField({ username: e.target.value })}
                  />
                </Field>
                <Field label="Password">
                  <input
                    className="in code"
                    type={usesVariable(login.password) ? 'text' : 'password'}
                    list="rec-login-vars"
                    autoComplete="new-password"
                    value={login.password}
                    placeholder="•••••• or {{API_PASSWORD}}"
                    onChange={(e) => setLoginField({ password: e.target.value })}
                  />
                </Field>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {savedLogin && login.username === ref(RECORDING_VARIABLES.user) ? (
                  <>
                    Using the login saved in “{environment?.name}”:{' '}
                    <span className="code">{saved.user?.value}</span> and its saved password.
                  </>
                ) : (
                  <>
                    Type the value, or pick a variable from the “{environment?.name ?? 'selected'}”
                    environment.
                    {savedLogin && (
                      <>
                        {' '}
                        <button className="link-btn" type="button" onClick={useSavedLogin}>
                          Use the saved login ({saved.user?.value})
                        </button>
                      </>
                    )}
                  </>
                )}
              </p>
              <datalist id="rec-login-vars">
                {variableKeys.map((key) => (
                  <option key={key} value={key} />
                ))}
              </datalist>
              <details className="rec-login-advanced">
                <summary className="small">Login form not found automatically? Set its selectors</summary>
                <div className="grid mt-12">
                  <Field label="Username field" hint="CSS or Playwright selector, e.g. #email">
                    <input
                      className="in code"
                      value={login.usernameSelector}
                      placeholder="Detected automatically"
                      onChange={(e) => setLoginField({ usernameSelector: e.target.value })}
                    />
                  </Field>
                  <Field label="Password field">
                    <input
                      className="in code"
                      value={login.passwordSelector}
                      placeholder="Detected automatically"
                      onChange={(e) => setLoginField({ passwordSelector: e.target.value })}
                    />
                  </Field>
                  <Field label="Sign-in button" hint="Leave empty to press Enter in the password field.">
                    <input
                      className="in code"
                      value={login.submitSelector}
                      placeholder="Detected automatically"
                      onChange={(e) => setLoginField({ submitSelector: e.target.value })}
                    />
                  </Field>
                </div>
              </details>
            </div>
          )}
        </div>
        <Field label="Folder">
          <FolderSelect index={folderIndex} value={folderId} onChange={setFolderId} />
        </Field>
        {environment && rememberable.length > 0 && (
          <div className="rec-remember">
            <Toggle checked={remember} onChange={setRemember}>
              <span>
                <b>Remember for next recordings</b>
                <span className="small muted">
                  {' '}
                  — saved in “{environment.name}”, so the next recording fills them in for you. The test uses
                  the variables, so a changed URL or password only needs updating in Environments.
                </span>
              </span>
            </Toggle>
            <ul className="small">
              {rememberable.map((r) => (
                <li key={r.part}>
                  {REMEMBER_LABEL[r.part]} → <span className="code">{ref(RECORDING_VARIABLES[r.part])}</span>
                  {r.part === 'password' && <span className="muted"> (secret)</span>}
                  {r.replaces && <b className="text-fail"> · replaces the saved value</b>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {environment && (
          <label className="row small">
            <input type="checkbox" checked={useEnv} onChange={(e) => setUseEnv(e.target.checked)} /> Use
            variables from the “{environment.name}” environment (passwords that match a secret are saved as{' '}
            {'{{VARIABLE}}'})
          </label>
        )}
      </div>
    </Modal>
  );
}
