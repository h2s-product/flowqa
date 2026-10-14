import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { MobileElement, MobileInspectorAction, MobileScreen, UiStep, UiStepType } from '@flowqa/shared';
import { SECRET_MASK } from '@flowqa/shared';
import { useFolders, useInspector, useInspectorActions, useInspectorScreen } from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { FolderSelect } from '@/components/folders/FolderSelect';
import { indexFolders } from '@/components/folders/folderIndex';
import { Icon, type IconName } from '@/components/Icon';
import { EmptyState, ErrorBox, Field, IconButton, Loading, SearchInput, Toggle } from '@/components/ui';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { MobileErrorHelp } from './mobileMode';
import { StepTypeIcon, stepTypeLabel, stepValue } from './uiSteps';

const STATUS_TEXT = {
  queued: 'Waiting — the device is busy with another test. The session starts as soon as it is free.',
  starting: 'Starting the app on the device… (the first start can take a minute)',
  ready: 'Ready — click an element on the screen, then choose what to do with it.',
  busy: 'Working on the device…',
  stopped: 'The device session is closed. Review the steps and save the test.',
  failed: 'The app could not be started.',
};
/** Kelas warna status (memakai gaya status rekaman web). */
const STATUS_CLASS = {
  queued: 'starting',
  starting: 'starting',
  ready: 'recording',
  busy: 'replaying',
  stopped: 'stopped',
  failed: 'failed',
};

/** Elemen terkecil yang memuat titik (x, y) dalam piksel screenshot. */
function elementAt(elements: MobileElement[], x: number, y: number): MobileElement | undefined {
  return elements
    .filter(
      (e) =>
        x >= e.bounds.x &&
        x <= e.bounds.x + e.bounds.width &&
        y >= e.bounds.y &&
        y <= e.bounds.y + e.bounds.height,
    )
    .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
}

const quoted = (text: string, max = 40) => `"${text.length > max ? `${text.slice(0, max)}…` : text}"`;

/** Aksi di layar tanpa elemen (Back, Swipe, …). */
const GLOBAL_ACTIONS: { type: UiStepType; value?: string; icon: IconName; label: string }[] = [
  { type: 'back', icon: 'back', label: 'Back' },
  { type: 'swipe', value: 'up', icon: 'up', label: 'Swipe up' },
  { type: 'swipe', value: 'down', icon: 'down', label: 'Swipe down' },
  { type: 'swipe', value: 'left', icon: 'left', label: 'Swipe left' },
  { type: 'swipe', value: 'right', icon: 'right', label: 'Swipe right' },
  { type: 'hideKeyboard', icon: 'keyboard', label: 'Hide keyboard' },
  { type: 'launchApp', icon: 'play', label: 'Launch app' },
  { type: 'closeApp', icon: 'stop', label: 'Close app' },
  { type: 'restartApp', icon: 'refresh', label: 'Restart app' },
  { type: 'takeScreenshot', icon: 'image', label: 'Screenshot (step)' },
  { type: 'pageSource', icon: 'code', label: 'Save page source (step)' },
];

const KEYS = [
  'ENTER',
  'BACK',
  'HOME',
  'SEARCH',
  'TAB',
  'DEL',
  'ESCAPE',
  'APP_SWITCH',
  'VOLUME_UP',
  'VOLUME_DOWN',
];

/** Jenis selector untuk ekspor rekaman (sama dengan server). */
function selectorParts(selector: string): { selectorType: string; selector: string } {
  const s = selector.trim();
  if (s.startsWith('~')) return { selectorType: 'accessibilityId', selector: s.slice(1) };
  if (s.startsWith('//') || s.startsWith('(//')) return { selectorType: 'xpath', selector: s };
  const [prefix, ...rest] = s.split('=');
  const value = rest.join('=');
  const types: Record<string, string> = {
    id: 'resourceId',
    xpath: 'xpath',
    android: 'uiautomator',
    uiautomator: 'uiautomator',
    class: 'className',
    text: 'text',
    'text*': 'text',
  };
  return types[prefix]
    ? { selectorType: types[prefix], selector: value }
    : { selectorType: 'accessibilityId', selector: s };
}

const EXPORT_ACTION: Partial<Record<UiStepType, string>> = {
  click: 'tap',
  fill: 'input',
  longPress: 'longPress',
  clearText: 'clearText',
  swipe: 'swipe',
  scrollTo: 'scroll',
  back: 'back',
  pressKey: 'pressKey',
  wait: 'wait',
  takeScreenshot: 'screenshot',
  assertText: 'assertText',
  assertVisible: 'assertElement',
  assertAttribute: 'assertAttribute',
};

/**
 * Ekspor rekaman sebagai JSON: { action, selectorType, selector, value }.
 * Nilai rahasia sudah disamarkan oleh server.
 */
function exportSteps(name: string, steps: UiStep[]) {
  const data = steps.map((step) => ({
    action: EXPORT_ACTION[step.type] ?? step.type,
    ...(step.selectors[0] ? selectorParts(step.selectors[0]) : {}),
    ...(step.value ? { value: step.value } : {}),
    ...(step.attribute ? { attribute: step.attribute } : {}),
    description: step.description,
  }));
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^\w-]+/g, '_') || 'recording'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Rekam test mobile: layar aplikasi live, pilih elemen, jalankan aksi → step. */
export function MobileInspectorPage() {
  const { sessionId = '' } = useParams();
  const { projectId = '' } = useWorkspace();
  const { data: session, isLoading, error } = useInspector(sessionId);
  const ready = session?.status === 'ready' || session?.status === 'busy';
  const actions = useInspectorActions(sessionId, projectId);
  const [live, setLive] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Live: layar diperbarui tiap 3 detik, berhenti saat elemen dipilih atau aksi berjalan.
  const paused = !!selectedPath || actions.act.isPending || session?.status === 'busy';
  const screenQuery = useInspectorScreen(sessionId, ready, live && !paused ? 3_000 : false);
  const { data: folders = [] } = useFolders('ui', projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const [selector, setSelector] = useState('');
  const [hover, setHover] = useState<MobileElement | null>(null);
  const [typed, setTyped] = useState('');
  const [expected, setExpected] = useState('');
  const [secret, setSecret] = useState(false);
  const [recordActions, setRecordActions] = useState(true);
  const [lastResult, setLastResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState('');
  const [waitMs, setWaitMs] = useState('1000');
  const [key, setKey] = useState('ENTER');
  const [attribute, setAttribute] = useState('checked');
  const [attrValue, setAttrValue] = useState('true');
  const [points, setPoints] = useState('4');
  const [probe, setProbe] = useState('');
  const listEnd = useRef<HTMLDivElement>(null);
  const stepCount = session?.steps.length ?? 0;

  const screen: MobileScreen | undefined = screenQuery.data;
  const elements = screen?.elements ?? [];
  const selected = elements.find((e) => e.path === selectedPath) ?? null;

  useEffect(() => {
    if (session) {
      setName((n) => n || session.name);
      setFolderId((f) => f ?? session.folderId);
    }
  }, [session]);
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [stepCount]);
  // Elemen baru dipilih → isi awal selector & teks.
  useEffect(() => {
    if (!selected) return;
    setSelector(selected.selectors[0] ?? '');
    setProbe(selected.selectors[0] ?? '');
    setExpected(selected.text || selected.label);
    setSecret(selected.secure);
    const attr = selected.attributes.checkable === 'true' ? 'checked' : 'enabled';
    setAttribute(attr);
    setAttrValue(selected.attributes[attr] ?? 'true');
    actions.testSelector.reset();
  }, [selectedPath, screen?.takenAt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const named = elements.filter((e) => e.text || e.accessibilityId || e.resourceId || e.label);
    return q
      ? named.filter((e) => `${e.description} ${e.resourceId} ${e.accessibilityId}`.toLowerCase().includes(q))
      : named;
  }, [elements, search]);

  if (isLoading) return <Loading />;
  if (error || !session)
    return (
      <div className="panel">
        <EmptyState
          title="This inspector session is no longer available"
          action={
            <Link className="btn" to="/ui/tests">
              Back to UI tests
            </Link>
          }
        >
          It was saved, discarded, closed after 20 minutes without activity, or the server restarted.
        </EmptyState>
      </div>
    );

  const isNew = !session.testCaseId;
  const working = actions.act.isPending || session.status === 'busy';
  const otherApp =
    !!screen?.foregroundPackage && !!screen.appPackage && screen.foregroundPackage !== screen.appPackage;
  const selectorsFor = (el: MobileElement) =>
    [selector, ...el.selectors.filter((s) => s !== selector)].filter(Boolean);

  const act = (action: MobileInspectorAction, done?: () => void) =>
    actions.act.mutate(
      { ...action, record: recordActions },
      {
        onSuccess: (result) => {
          setLastResult(
            result.ok
              ? {
                  ok: true,
                  text: `${action.description ?? stepTypeLabel(action.type, 'mobile')}${result.detail ? ` — ${result.detail}` : ''}${recordActions ? '' : ' (not recorded)'}`,
                }
              : { ok: false, text: result.error ?? 'The action failed.' },
          );
          // Elemen lama mungkin sudah hilang dari layar.
          if (result.ok) {
            setSelectedPath(null);
            done?.();
          }
        },
      },
    );

  const elementAction = (type: UiStepType, extra: Partial<MobileInspectorAction> = {}) => {
    if (!selected) return;
    const label = stepTypeLabel(type, 'mobile');
    const description =
      type === 'fill'
        ? `Type ${secret ? SECRET_MASK : quoted(typed)} into ${selected.description}`
        : type === 'assertText'
          ? `Check ${selected.description} shows ${quoted(expected)}`
          : type === 'assertEach'
            ? `Check every ${selected.type} contains ${quoted(expected)}`
            : `${label} ${selected.description}`;
    act(
      { type, selectors: type === 'assertEach' ? [selector] : selectorsFor(selected), description, ...extra },
      type === 'fill' ? () => setTyped('') : undefined,
    );
  };

  const onScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!screen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * screen.width;
    const y = ((e.clientY - rect.top) / rect.height) * screen.height;
    setSelectedPath(elementAt(elements, x, y)?.path ?? null);
    setLastResult(null);
  };
  const onScreenMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!screen) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * screen.width;
    const y = ((e.clientY - rect.top) / rect.height) * screen.height;
    setHover(elementAt(elements, x, y) ?? null);
  };
  const box = (el: MobileElement) =>
    screen && {
      left: `${(el.bounds.x / screen.width) * 100}%`,
      top: `${(el.bounds.y / screen.height) * 100}%`,
      width: `${(el.bounds.width / screen.width) * 100}%`,
      height: `${(el.bounds.height / screen.height) * 100}%`,
    };

  const save = () =>
    actions.save.mutate(
      { name: name.trim() || session.name, ...(isNew ? { folderId } : {}) },
      {
        onSuccess: (test) => {
          toast(isNew ? 'Mobile test saved' : `${session.steps.length} steps added to the test`);
          navigate(`/ui/tests/${test.id}`);
        },
      },
    );
  const discard = async () =>
    (await confirm({
      title: 'Discard this recording?',
      message: 'The app session closes and the recorded steps are lost.',
      confirmLabel: 'Discard',
    })) && actions.cancel.mutate(undefined, { onSuccess: () => navigate('/ui/tests') });

  return (
    <div className="recorder">
      <div className={`rec-status ${STATUS_CLASS[session.status]}`}>
        <span className="rec-dot" aria-hidden="true" />
        <div className="grow">
          <b>{working && session.status === 'ready' ? STATUS_TEXT.busy : STATUS_TEXT[session.status]}</b>
          <div className="small">
            {isNew ? 'New mobile test' : `Continuing “${session.name}”`} · {session.device} · started{' '}
            <DateTime value={session.startedAt} />
          </div>
        </div>
      </div>

      {session.error && (
        <div className="mb-12">
          {session.errorCode ? (
            <MobileErrorHelp code={session.errorCode} detail={session.error} />
          ) : (
            <ErrorBox error={session.error} />
          )}
        </div>
      )}

      <div className="inspector">
        {/* ------------------------------ layar ------------------------------ */}
        <section className="panel inspector-screen">
          <div className="panel-h">
            <h3>Screen</h3>
            <div className="grow" />
            <Toggle checked={live} onChange={setLive}>
              <span
                className="small"
                title="Refresh the screen every 3 seconds (paused while an element is selected)"
              >
                Live
              </span>
            </Toggle>
            <IconButton
              icon="refresh"
              label="Refresh the screen"
              disabled={!ready || screenQuery.isFetching}
              onClick={() => screenQuery.refetch()}
            />
          </div>
          <div className="panel-b">
            {!ready ? (
              <div className="inspector-device placeholder muted small">
                {session.status === 'starting' ? <Loading /> : 'No screen'}
              </div>
            ) : screenQuery.error ? (
              <ErrorBox error={screenQuery.error} />
            ) : !screen ? (
              <div className="inspector-device placeholder">
                <Loading />
              </div>
            ) : (
              <div
                className={`inspector-device ${screenQuery.isFetching || working ? 'dim' : ''}`}
                style={{ aspectRatio: `${screen.width} / ${screen.height}` }}
                onClick={onScreenClick}
                onMouseMove={onScreenMove}
                onMouseLeave={() => setHover(null)}
              >
                <img
                  src={`data:image/png;base64,${screen.screenshot}`}
                  alt="Current app screen"
                  draggable={false}
                />
                {hover && hover.path !== selectedPath && (
                  <span className="inspector-box hover" style={box(hover)!} />
                )}
                {selected && <span className="inspector-box selected" style={box(selected)!} />}
                {actions.testSelector.data?.bounds.map((b, i) => (
                  <span
                    key={i}
                    className="inspector-box match"
                    style={box({ bounds: b } as MobileElement)!}
                  />
                ))}
              </div>
            )}
            <div className="inspector-global">
              {GLOBAL_ACTIONS.map((a) => (
                <IconButton
                  key={`${a.type}-${a.value ?? ''}`}
                  icon={a.icon}
                  label={a.label}
                  disabled={!ready || working}
                  onClick={() => act({ type: a.type, selectors: [], value: a.value, description: a.label })}
                />
              ))}
            </div>
            {screen && (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                {elements.length} elements · taken <DateTime value={screen.takenAt} timeOnly />
                {live && paused && !working && ' · live paused (element selected)'}
              </p>
            )}
            {screen && otherApp && (
              <div className="banner warn mt-8" role="status">
                <Icon name="eye" size={14} />
                <span>
                  Another app is in front: <code>{screen.foregroundPackage}</code> (expected{' '}
                  <code>{screen.appPackage}</code>). Close the dialog or press Back, or check the app package
                  / activity in the test settings.
                </span>
              </div>
            )}
            {screen && !otherApp && !elements.length && (
              <div className="banner warn mt-8" role="status">
                <Icon name="eye" size={14} />
                <span>
                  Android reports no elements on this screen. The app may still be loading (wait for the next
                  refresh), or it draws its own UI (games, Flutter without semantics, a canvas) or shows a
                  WebView. Only native views and Compose/Flutter semantics show up here.
                </span>
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------ elemen ------------------------------ */}
        <section className="panel inspector-element">
          <div className="panel-h">
            <h3>{selected ? selected.description : 'Element'}</h3>
          </div>
          <div className="panel-b grid">
            {lastResult && (
              <div className={`banner ${lastResult.ok ? '' : 'warn'}`} role="status">
                <Icon name={lastResult.ok ? 'check' : 'x'} size={14} /> <span>{lastResult.text}</span>
              </div>
            )}
            {!selected ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>
                  Click an element on the screen, or pick one from the list.
                </p>
                <SearchInput value={search} onChange={setSearch} placeholder="Find by text or id" />
                <ul className="inspector-list">
                  {filtered.slice(0, 200).map((e) => (
                    <li key={e.path}>
                      <button
                        type="button"
                        onClick={() => setSelectedPath(e.path)}
                        onMouseEnter={() => setHover(e)}
                        onMouseLeave={() => setHover(null)}
                      >
                        <b>{e.description}</b>
                        <span className="small muted code ellipsis">{e.selectors[0]}</span>
                      </button>
                    </li>
                  ))}
                  {!filtered.length && <li className="small muted">No elements with text or an id.</li>}
                </ul>
              </>
            ) : (
              <>
                <dl className="inspector-attrs small">
                  {Object.entries(selected.attributes).map(([k, v]) => (
                    <div key={k}>
                      <dt className="muted">{k}</dt>
                      <dd className={`code ${v === 'true' ? 'text-pass' : ''}`}>{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
                <Field
                  label="Find it by"
                  hint="The first choice is the most stable. The others are tried when it is not found."
                >
                  <select className="in code" value={selector} onChange={(e) => setSelector(e.target.value)}>
                    {selected.selectors.map((s) => (
                      <option key={s} value={s}>
                        {selectorParts(s).selectorType} · {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Test selector"
                  hint={
                    actions.testSelector.data
                      ? actions.testSelector.data.error
                        ? actions.testSelector.data.error
                        : `${actions.testSelector.data.matches} match${actions.testSelector.data.matches === 1 ? '' : 'es'} (${actions.testSelector.data.selectorType}) — highlighted on the screen.`
                      : 'Any selector: ~id, id=…, android=new UiSelector()…, //xpath, class=…, text=…'
                  }
                >
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="in code grow"
                      value={probe}
                      onChange={(e) => setProbe(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={!probe.trim() || actions.testSelector.isPending}
                      onClick={() => actions.testSelector.mutate(probe.trim())}
                    >
                      Test
                    </button>
                  </div>
                </Field>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn primary" disabled={working} onClick={() => elementAction('click')}>
                    <Icon name="cursor" size={13} /> Tap
                  </button>
                  <button className="btn" disabled={working} onClick={() => elementAction('longPress')}>
                    <Icon name="hand" size={13} /> Long press
                  </button>
                  <button className="btn" disabled={working} onClick={() => elementAction('assertVisible')}>
                    <Icon name="eye" size={13} /> Check visible
                  </button>
                  <button
                    className="btn"
                    disabled={working}
                    onClick={() => elementAction('scrollTo', { value: 'down' })}
                  >
                    <Icon name="down" size={13} /> Scroll to it
                  </button>
                  <button className="btn" disabled={working} onClick={() => elementAction('clearText')}>
                    <Icon name="x" size={13} /> Clear text
                  </button>
                </div>
                <Field label="Type text">
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="in grow"
                      type={secret ? 'password' : 'text'}
                      autoComplete="off"
                      value={typed}
                      placeholder="Text or {{VARIABLE}}"
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === 'Enter' &&
                        !working &&
                        elementAction('fill', { value: typed, sensitive: secret })
                      }
                    />
                    <button
                      className="btn"
                      disabled={working}
                      onClick={() => elementAction('fill', { value: typed, sensitive: secret })}
                    >
                      <Icon name="edit" size={13} /> Type
                    </button>
                  </div>
                </Field>
                <Toggle checked={secret} onChange={setSecret} label="Secret value (hidden in results)" />
                <Field label="Check text">
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="in grow"
                      value={expected}
                      placeholder="Expected text"
                      onChange={(e) => setExpected(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={working || !expected.trim()}
                      onClick={() => elementAction('assertText', { value: expected })}
                    >
                      <Icon name="eye" size={13} /> Check shows
                    </button>
                    <button
                      className="btn"
                      disabled={working || !expected.trim()}
                      title="Every element found with this selector (e.g. each row of a list) must contain the text"
                      onClick={() => elementAction('assertEach', { value: expected })}
                    >
                      Every row
                    </button>
                  </div>
                </Field>
                <Field label="Check attribute">
                  <div className="row" style={{ gap: 8 }}>
                    <select
                      className="in"
                      style={{ maxWidth: 160 }}
                      value={attribute}
                      onChange={(e) => setAttribute(e.target.value)}
                    >
                      {Object.keys(selected.attributes).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <input
                      className="in grow"
                      value={attrValue}
                      onChange={(e) => setAttrValue(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={working}
                      onClick={() =>
                        elementAction('assertAttribute', {
                          attribute,
                          value: attrValue,
                          description: `Check ${selected.description} ${attribute} = "${attrValue}"`,
                        })
                      }
                    >
                      Check
                    </button>
                  </div>
                </Field>
                <Field
                  label="Draw polygon"
                  hint="Taps random points inside this element (e.g. a map), a different shape on every run."
                >
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="in"
                      type="number"
                      min={3}
                      max={12}
                      style={{ width: 90 }}
                      value={points}
                      onChange={(e) => setPoints(e.target.value)}
                    />
                    <button
                      className="btn"
                      disabled={working}
                      onClick={() =>
                        elementAction('drawPolygon', {
                          value: points,
                          description: `Draw a ${points}-point polygon on ${selected.description}`,
                        })
                      }
                    >
                      <Icon name="map" size={13} /> Draw
                    </button>
                  </div>
                </Field>
                <button className="link-btn small" type="button" onClick={() => setSelectedPath(null)}>
                  ← Back to the element list
                </button>
              </>
            )}
            <details className="rec-login-advanced">
              <summary className="small">More steps: press key, wait, open a deep link</summary>
              <div className="grid mt-12">
                <div className="row" style={{ gap: 8 }}>
                  <select
                    className="in"
                    style={{ width: 160 }}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    aria-label="Android key"
                  >
                    {KEYS.map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                  <button
                    className="btn"
                    disabled={!ready || working}
                    onClick={() =>
                      act({ type: 'pressKey', selectors: [], value: key, description: `Press ${key}` })
                    }
                  >
                    <Icon name="keyboard" size={13} /> Press key
                  </button>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="in"
                    style={{ width: 120 }}
                    type="number"
                    min={0}
                    value={waitMs}
                    onChange={(e) => setWaitMs(e.target.value)}
                    aria-label="Milliseconds"
                  />
                  <button
                    className="btn"
                    disabled={!ready || working}
                    onClick={() =>
                      act({ type: 'wait', selectors: [], value: waitMs, description: `Wait ${waitMs} ms` })
                    }
                  >
                    <Icon name="clock" size={13} /> Add wait
                  </button>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <input
                    className="in code grow"
                    value={deepLink}
                    placeholder="myapp://orders/42"
                    onChange={(e) => setDeepLink(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={!ready || working || !deepLink.trim()}
                    onClick={() =>
                      act({
                        type: 'navigate',
                        selectors: [],
                        value: deepLink.trim(),
                        description: `Open ${deepLink.trim()}`,
                      })
                    }
                  >
                    <Icon name="globe" size={13} /> Open link
                  </button>
                </div>
              </div>
            </details>
            <Toggle checked={recordActions} onChange={setRecordActions}>
              <span>
                <b>Record actions</b>
                <span className="small muted"> — turn off to set up the screen without adding steps.</span>
              </span>
            </Toggle>
          </div>
        </section>

        {/* ------------------------------ step ------------------------------ */}
        <section className="panel inspector-steps">
          <div className="panel-h">
            <h3>Recorded steps</h3>
            <span className="small muted">{session.steps.length}</span>
            <div className="grow" />
            <IconButton
              icon="download"
              label="Export the recording as JSON"
              disabled={!session.steps.length}
              onClick={() => exportSteps(session.name, session.steps)}
            />
          </div>
          {session.steps.length ? (
            <ol className="ui-step-list">
              {session.steps.map((step, i) => (
                <li key={step.id}>
                  <span className="num muted">{i + 1}</span>
                  <StepTypeIcon type={step.type} target="mobile" />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{step.description}</b>
                    <div className="small muted ellipsis">
                      {stepTypeLabel(step.type, 'mobile')}
                      {stepValue(step) && (
                        <>
                          {' '}
                          · <span className="code">{stepValue(step)}</span>
                        </>
                      )}
                      {step.selectors[0] && (
                        <>
                          {' '}
                          · {selectorParts(step.selectors[0]).selectorType}{' '}
                          <span className="code">{selectorParts(step.selectors[0]).selector}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <IconButton
                    icon="trash"
                    label="Remove this step"
                    onClick={async () =>
                      (await confirm({
                        title: `Remove step ${i + 1} “${step.description}”?`,
                        confirmLabel: 'Remove',
                      })) && actions.removeStep.mutate(step.id)
                    }
                  />
                </li>
              ))}
              <div ref={listEnd} />
            </ol>
          ) : (
            <div className="panel-b muted small">
              No steps yet. Tap, type or check something on the screen.
            </div>
          )}
          <div className="panel-b grid inspector-save">
            {isNew && (
              <>
                <Field label="Test name">
                  <input className="in" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Folder">
                  <FolderSelect index={indexFolders(folders, [])} value={folderId} onChange={setFolderId} />
                </Field>
              </>
            )}
            <button
              className="btn primary"
              onClick={save}
              disabled={!session.steps.length || actions.save.isPending}
            >
              <Icon name="check" size={14} /> {isNew ? 'Save test' : 'Add to test'}
            </button>
            <button className="btn ghost" onClick={discard}>
              Discard
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
