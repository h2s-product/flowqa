import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { UiPickMode, UiPickOptions, UiStep, UiStepType, UiTestCase, UiTestTarget } from '@flowqa/shared';
import {
  createId,
  DEFAULT_UI_STEP_DELAY_MS,
  DYNAMIC_VARIABLES,
  MAX_UI_STEP_DELAY_MS,
  LIVE_UI_RUN_STATUSES,
  SECRET_MASK,
  SORT_ORDERS,
} from '@flowqa/shared';
import {
  useApps,
  useFolders,
  useRunUiTestAndOpen,
  useSaveUiTest,
  useStartInspector,
  useStartRecording,
  useUiRuns,
  useUiTest,
} from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { FolderSelect } from '@/components/folders/FolderSelect';
import { indexFolders } from '@/components/folders/folderIndex';
import { Icon } from '@/components/Icon';
import { BackLink, ErrorBox, Field, IconButton, Loading, StatusBadge, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { formatMs } from '@/lib/format';
import {
  DEFAULT_PICK,
  StepTypeIcon,
  isAssertion,
  optionListSelectors,
  stepTypeInfo,
  stepTypeLabel,
  stepTypesFor,
  stepValueLabel,
  testTarget,
} from './uiSteps';
import { EMPTY_MOBILE_APP, MobileAppFields, mobileAppReady } from './MobileAppFields';
import { AppSelect } from '@/features/apps/AppSelect';
import { ExecutionModePicker, useExecutionMode } from './mobileMode';
import { useEditableCopy } from '@/hooks/useEditableCopy';
import { ApiScenarioStepFields } from './ApiScenarioStepFields';
import { useConfirm } from '@/context/ConfirmContext';

/** Editor UI test case: detail test + daftar step yang bisa diedit, diurutkan, dimatikan. */
export function UiTestEditorPage() {
  const { testId = '' } = useParams();
  const { projectId = '', environment } = useWorkspace();
  const { data: test, isLoading, error } = useUiTest(testId);
  const { data: runs = [] } = useUiRuns(projectId, { testId, limit: 8 });
  const { data: folders = [] } = useFolders('ui', projectId);
  const save = useSaveUiTest(projectId);
  const run = useRunUiTestAndOpen(projectId);
  const record = useStartRecording(projectId);
  const inspect = useStartInspector(projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { draft, setDraft, dirty } = useEditableCopy(test);
  const [open, setOpen] = useState<string | null>(null);
  const folderIndex = useMemo(() => indexFolders(folders, []), [folders]);

  const { data: apps = [] } = useApps(projectId);
  const testApp = apps.find((a) => a.id === draft?.appId);
  const [mode, setMode] = useExecutionMode(testApp?.android?.defaultMode);

  if (isLoading || (test && !draft)) return <Loading />;
  if (error || !test || !draft) return <ErrorBox error={error} />;

  const target = testTarget(draft);
  const mobile = target === 'mobile';
  const set = (patch: Partial<UiTestCase>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setStep = (id: string, patch: Partial<UiStep>) =>
    set({ steps: draft.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const move = (index: number, delta: number) => {
    const steps = [...draft.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + delta, 0, step);
    set({ steps });
  };
  const addStep = (type: UiStepType) => {
    const step: UiStep = {
      id: createId('us'),
      type,
      description: stepTypeLabel(type, target),
      selectors: [],
      value:
        type === 'wait'
          ? '1000'
          : type === 'swipe'
            ? 'up'
            : type === 'scrollTo'
              ? 'down'
              : type === 'assertSorted'
                ? 'ascending'
                : '',
      timeoutMs: null,
      disabled: false,
      ...(type === 'pickOption' ? { pick: DEFAULT_PICK, selectors: ['role=option'] } : {}),
      ...(type === 'setVariable' ? { saveAs: 'my_value', value: '{{random_name}}' } : {}),
      ...(type === 'assertEach' && !mobile ? { selectors: ['table tbody tr'] } : {}),
      ...(type === 'apiScenario' ? { apiScenarioId: '' } : {}),
    };
    set({ steps: [...draft.steps, step] });
    setOpen(step.id);
  };

  const persist = (then?: () => void) =>
    save.mutate(draft, {
      onSuccess: () => (toast('UI test saved'), then?.()),
    });
  const start = (headless: boolean) => {
    const go = () => run.run({ id: draft.id, headless, environmentId: environment?.id, mode });
    if (dirty) persist(go);
    else go();
  };
  const recordMore = () => {
    const go = () =>
      mobile
        ? inspect.mutate(
            { testCaseId: draft.id, environmentId: environment?.id, mode },
            { onSuccess: (s) => navigate(`/ui/mobile/${s.id}`) },
          )
        : record.mutate(
            { testCaseId: draft.id, environmentId: environment?.id },
            { onSuccess: (s) => navigate(`/ui/record/${s.id}`) },
          );
    if (dirty) persist(go);
    else go();
  };

  return (
    <>
      <div className="row wrap detail-bar">
        <BackLink to="/ui/tests" label="UI tests" />
        <span className="small muted">
          Created <DateTime value={test.createdAt} /> · Updated <DateTime value={test.updatedAt} />
        </span>
        <div className="grow" />
        {test.steps.length > 0 && (
          <a
            className="btn"
            href={`/api/ui-tests/${test.id}/manual`}
            title="HTML manual book of every step with screenshots from the latest passed run (or the latest run with screenshots)"
          >
            <Icon name="download" size={14} /> Manual book
          </a>
        )}
        <button
          className="btn"
          onClick={recordMore}
          disabled={
            record.isPending ||
            inspect.isPending ||
            (mobile && !mobileAppReady(draft.mobile ?? EMPTY_MOBILE_APP))
          }
          title={
            mobile ? 'Opens the app in the Mobile Inspector after replaying the existing steps' : undefined
          }
        >
          <Icon name={mobile ? 'android' : 'record'} size={14} /> Record more steps
        </button>
        {mobile && <ExecutionModePicker value={mode} onChange={setMode} />}
        <button
          className="btn"
          title={
            mobile
              ? 'Replays the steps on the device at the speed they were recorded'
              : 'Opens Chrome on the server and replays the steps at the speed they were recorded'
          }
          onClick={() => start(false)}
          disabled={!draft.steps.length || run.isPending}
        >
          <Icon name="eye" size={14} /> {mobile ? 'Run at recorded speed' : 'Run with browser visible'}
        </button>
        <button
          className="btn blue"
          onClick={() => start(true)}
          disabled={!draft.steps.length || run.isPending}
        >
          <Icon name="play" size={13} /> Run
        </button>
        <button className="btn primary" onClick={() => persist()} disabled={!dirty || save.isPending}>
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <div className="dash-grid" style={{ marginTop: 0 }}>
        <section className="panel c-8">
          <div className="panel-b grid">
            <div className="grid" style={{ gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <Field
                label="Test name"
                hint={test?.code ? `Test Case ID: ${test.code} (unique, never changes)` : undefined}
              >
                <input className="in" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Folder">
                <FolderSelect
                  index={folderIndex}
                  value={draft.folderId}
                  onChange={(folderId) => set({ folderId })}
                />
              </Field>
            </div>
            <Field
              label="App"
              hint={
                testApp?.platform === 'android'
                  ? `Runs on ${testApp.android?.formFactor ? `a ${testApp.android.formFactor}` : 'a phone or tablet'}. “Latest Firebase release” uses the Firebase connection of ${testApp.name}.`
                  : testApp?.platform === 'web' && testApp.urlVariable
                    ? `Start URL of ${testApp.name}: {{${testApp.urlVariable}}}`
                    : 'Link the test to an app of the project (set up in Apps).'
              }
            >
              <AppSelect
                projectId={projectId}
                platform={mobile ? 'android' : 'web'}
                value={draft.appId}
                onChange={(app) => {
                  const patch: Partial<UiTestCase> = { appId: app?.id ?? null };
                  // Isian yang masih kosong diisi dari app.
                  if (app?.android && mobile && !draft.mobile?.appPackage && !draft.mobile?.app)
                    patch.mobile = {
                      ...(draft.mobile ?? EMPTY_MOBILE_APP),
                      appPackage: app.android.appPackage,
                      appActivity: app.android.appActivity,
                      app: app.android.app,
                    };
                  if (app?.platform === 'web' && app.urlVariable && !draft.startUrl.trim())
                    patch.startUrl = `{{${app.urlVariable}}}`;
                  set(patch);
                }}
              />
            </Field>
            <Field label="Description">
              <input
                className="in"
                value={draft.description}
                placeholder="What does this test prove?"
                onChange={(e) => set({ description: e.target.value })}
              />
            </Field>
            {mobile ? (
              <details className="mobile-app-config" open={!mobileAppReady(draft.mobile ?? EMPTY_MOBILE_APP)}>
                <summary>
                  <Icon name="android" size={13} /> <b>Android app</b>{' '}
                  <span className="small muted code">
                    {draft.mobile?.appPackage || draft.mobile?.app || 'not set'}
                    {draft.mobile?.deviceName && ` · ${draft.mobile.deviceName}`}
                  </span>
                </summary>
                <div className="mt-12">
                  <MobileAppFields
                    value={draft.mobile ?? EMPTY_MOBILE_APP}
                    onChange={(m) => set({ mobile: m })}
                  />
                </div>
              </details>
            ) : (
              <div className="grid" style={{ gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
                <Field label="Start URL">
                  <input
                    className="in code"
                    value={draft.startUrl}
                    onChange={(e) => set({ startUrl: e.target.value })}
                  />
                </Field>
                <Field label="Window width">
                  <input
                    className="in"
                    type="number"
                    value={draft.viewport.width}
                    onChange={(e) =>
                      set({ viewport: { ...draft.viewport, width: Number(e.target.value) || 1280 } })
                    }
                  />
                </Field>
                <Field label="Window height">
                  <input
                    className="in"
                    type="number"
                    value={draft.viewport.height}
                    onChange={(e) =>
                      set({ viewport: { ...draft.viewport, height: Number(e.target.value) || 800 } })
                    }
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="panel-h" style={{ borderTop: '1px solid var(--line)' }}>
            <h3>Steps</h3>
            <span className="small muted">{draft.steps.length} steps · click a step to edit it</span>
            <div className="grow" />
            <select
              className="in"
              style={{ width: 190 }}
              value=""
              onChange={(e) => e.target.value && addStep(e.target.value as UiStepType)}
              aria-label="Add a step"
            >
              <option value="">+ Add a step…</option>
              {stepTypesFor(target).map((t) => (
                <option key={t.id} value={t.id}>
                  {stepTypeLabel(t.id, target)}
                </option>
              ))}
            </select>
          </div>

          <ol className="ui-step-list editable">
            {draft.steps.map((step, i) => (
              <li key={step.id} className={`${step.disabled ? 'off' : ''} ${open === step.id ? 'open' : ''}`}>
                <div className="ui-step-row" onClick={() => setOpen(open === step.id ? null : step.id)}>
                  <span className="num muted">{i + 1}</span>
                  <StepTypeIcon type={step.type} target={target} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{step.description}</b>
                    <div className="small muted ellipsis">
                      {stepTypeLabel(step.type, target)}
                      {step.value && (
                        <>
                          {' '}
                          · <span className="code">{step.value}</span>
                        </>
                      )}
                      {step.selectors[0] && (
                        <>
                          {' '}
                          · <span className="code">{step.selectors[0]}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="up" label="Move up" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton
                      icon="down"
                      label="Move down"
                      disabled={i === draft.steps.length - 1}
                      onClick={() => move(i, 1)}
                    />
                    <Toggle
                      checked={!step.disabled}
                      onChange={(on) => setStep(step.id, { disabled: !on })}
                      label="Step enabled"
                    />
                    <IconButton
                      icon="trash"
                      label="Delete step"
                      onClick={async () =>
                        (await confirm({
                          title: `Delete step ${i + 1} “${step.description}”?`,
                          message: 'The step is removed when you save the test.',
                        })) && set({ steps: draft.steps.filter((s) => s.id !== step.id) })
                      }
                    />
                  </div>
                </div>
                {open === step.id && (
                  <StepEditor
                    step={step}
                    steps={draft.steps}
                    target={target}
                    onChange={(patch) => setStep(step.id, patch)}
                  />
                )}
              </li>
            ))}
          </ol>
          {!draft.steps.length && (
            <div className="panel-b muted">
              No steps yet. {mobile ? 'Record some in the Mobile Inspector' : 'Record some'}, or add them
              manually.
            </div>
          )}
        </section>

        <section className="panel c-4">
          <div className="panel-h">
            <h3>Recent runs</h3>
            <div className="grow" />
            <Link className="btn sm ghost" to="/ui/runs">
              All runs
            </Link>
          </div>
          {runs.length ? (
            <div className="run-list with-badge">
              {runs.map((r) => (
                <div className="r" key={r.id} onClick={() => navigate(`/ui/runs/${r.id}`)}>
                  <div className="small" style={{ minWidth: 0 }}>
                    <DateTime value={r.startedAt} relative />
                    <div className="muted">
                      {r.counts.passed}/{r.counts.total} steps ·{' '}
                      {LIVE_UI_RUN_STATUSES.includes(r.status) ? '…' : formatMs(r.durationMs)}
                      {r.target === 'mobile' ? ` · ${r.browser}` : r.headless ? '' : ' · visible'}
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          ) : (
            <div className="panel-b muted small">Not run yet.</div>
          )}
          <div className="panel-b small muted" style={{ borderTop: '1px solid var(--line)' }}>
            Runs use the <b>{environment?.name ?? 'selected'}</b> environment for {'{{variables}}'}. Change it
            at the top right.
          </div>
        </section>
      </div>
    </>
  );
}

/** Petunjuk selector per target. */
const SELECTOR_HINT: Record<UiTestTarget, string> = {
  web: 'One per line, most reliable first. The first one found on the page is used (CSS, text=…, role=button[name=…]).',
  mobile:
    'One per line, most reliable first: ~accessibility-id, id=com.app:id/name, android=new UiSelector()…, text=Exact text, text*=Part, class=android.widget.EditText, //xpath (last resort).',
};

function StepEditor({
  step,
  steps,
  target,
  onChange,
}: {
  step: UiStep;
  /** Semua step test (untuk "bila gagal, ulangi dari step X"). */
  steps: UiStep[];
  target: UiTestTarget;
  onChange: (patch: Partial<UiStep>) => void;
}) {
  const position = steps.findIndex((s) => s.id === step.id);
  const info = stepTypeInfo(step.type);
  const valueLabel = stepValueLabel(step.type, target);
  const isPick = step.type === 'pickOption';
  const pick = step.pick ?? DEFAULT_PICK;
  const setPick = (patch: Partial<UiPickOptions>) => onChange({ pick: { ...pick, ...patch } });
  const changeType = (type: UiStepType) =>
    onChange(
      type === 'pickOption'
        ? {
            type,
            pick: step.pick ?? DEFAULT_PICK,
            // Klik pada satu pilihan hasil rekaman → selector untuk semua pilihan di daftar.
            selectors: optionListSelectors(step.selectors).length
              ? optionListSelectors(step.selectors)
              : ['role=option'],
            description: 'Pick an option',
          }
        : type === 'setVariable' || type === 'saveText'
          ? { type, saveAs: step.saveAs || 'my_value' }
          : { type },
    );
  return (
    <div className="ui-step-edit grid">
      <div className="grid" style={{ gridTemplateColumns: '1fr 2fr', gap: 12 }}>
        <Field label="Action">
          <select className="in" value={step.type} onChange={(e) => changeType(e.target.value as UiStepType)}>
            {stepTypesFor(target).map((t) => (
              <option key={t.id} value={t.id}>
                {stepTypeLabel(t.id, target)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <input
            className="in"
            value={step.description}
            onChange={(e) => onChange({ description: e.target.value })}
          />
        </Field>
      </div>
      {step.type === 'apiScenario' && <ApiScenarioStepFields step={step} onChange={onChange} />}
      {step.type === 'assertAttribute' && (
        <Field
          label="Attribute"
          hint="An Android attribute: checked, enabled, selected, focused, clickable, content-desc, text, …"
        >
          <input
            className="in code"
            list="android-attributes"
            value={step.attribute ?? ''}
            placeholder="checked"
            onChange={(e) => onChange({ attribute: e.target.value.trim() })}
          />
          <datalist id="android-attributes">
            {[
              'checked',
              'enabled',
              'selected',
              'focused',
              'clickable',
              'displayed',
              'content-desc',
              'text',
              'resource-id',
              'class',
              'package',
            ].map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
      )}
      {step.type === 'drawPolygon' && (
        <Field
          label="Save the tapped points as (optional)"
          hint="Screen points as JSON, e.g. {{polygon_points}}. For map coordinates use {{random_polygon}}."
        >
          <input
            className="in code"
            value={step.saveAs ?? ''}
            placeholder="polygon_points"
            onChange={(e) => onChange({ saveAs: e.target.value.replace(/[^\w]/g, '') })}
          />
        </Field>
      )}
      {(step.type === 'setVariable' || step.type === 'saveText') && (
        <Field
          label="Variable name"
          hint={`Use it in later steps as {{${step.saveAs || 'my_value'}}} — in values and in selectors, e.g. text="{{${step.saveAs || 'my_value'}}}".`}
        >
          <input
            className="in code"
            value={step.saveAs ?? ''}
            placeholder="user_name"
            onChange={(e) => onChange({ saveAs: e.target.value.replace(/[^\w]/g, '') })}
          />
        </Field>
      )}
      {step.type === 'saveText' && (
        <Toggle
          checked={!!step.unique}
          onChange={(unique) => onChange({ unique })}
          label="Skip values saved by earlier runs of this test (e.g. a customer already tested)"
        />
      )}
      {valueLabel && (
        <Field
          label={valueLabel}
          hint={
            step.sensitive
              ? 'Hidden value (password). Type a new value to replace it, or use {{VARIABLE}} from the environment.'
              : step.type === 'setVariable'
                ? `Worked out once per run. Mix text and generators: ${DYNAMIC_VARIABLES.map((v) => `{{${v.key}}}`).join(', ')}.`
                : 'You can use {{variables}} from the environment, e.g. {{API_USER}} or {{random_email}}.'
          }
        >
          <input
            className="in code"
            type={step.sensitive ? 'password' : 'text'}
            list={
              step.type === 'pressKey'
                ? 'android-keys'
                : step.type === 'swipe' || step.type === 'scrollTo'
                  ? 'swipe-directions'
                  : step.type === 'assertSorted'
                    ? 'sort-orders'
                    : undefined
            }
            value={step.value}
            onFocus={(e) => step.sensitive && step.value === SECRET_MASK && e.target.select()}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        </Field>
      )}
      <datalist id="android-keys">
        {[
          'ENTER',
          'BACK',
          'HOME',
          'SEARCH',
          'TAB',
          'DEL',
          'ESCAPE',
          'APP_SWITCH',
          'MENU',
          'VOLUME_UP',
          'VOLUME_DOWN',
        ].map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <datalist id="sort-orders">
        {SORT_ORDERS.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <datalist id="swipe-directions">
        {['up', 'down', 'left', 'right'].map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      {(info.needsTarget || step.type === 'swipe') && (
        <Field
          label={
            isPick
              ? 'Options selector'
              : step.type === 'assertEach'
                ? 'Rows selector'
                : step.type === 'assertSorted'
                  ? 'Values selector'
                  : 'Element selectors'
          }
          hint={
            step.type === 'assertSorted'
              ? 'Must match the value in EVERY item, e.g. the due date or the amount of each card. Dates (5 Okt 2026, 05/10/2026) and numbers (Rp 195.000.000) are compared; other text is ignored.'
              : step.type === 'assertEach'
                ? target === 'mobile'
                  ? 'Must match EVERY item to check, e.g. id=com.app:id/order_title. The check waits until the list updates, and fails if nothing is shown.'
                  : 'Must match EVERY row to check, e.g. table tbody tr. The check waits until the rows update, and fails if no rows are shown.'
                : isPick
                  ? 'Must match EVERY option in the list, e.g. role=option or [role=listbox] button. For a normal dropdown, point to the <select> itself.'
                  : step.type === 'swipe'
                    ? 'Optional: swipe inside this element (e.g. a carousel). Empty = the whole screen.'
                    : SELECTOR_HINT[target]
          }
        >
          <textarea
            className="in code"
            rows={Math.min(5, Math.max(2, step.selectors.length))}
            value={step.selectors.join('\n')}
            onChange={(e) =>
              onChange({
                selectors: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      )}
      {isPick && (
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field
            label="Which option"
            hint={
              pick.mode === 'named'
                ? 'Matched exactly (not case-sensitive), so "Admin" never picks "Super Admin".'
                : 'Options that are already selected, ticked or disabled are always skipped.'
            }
          >
            <select
              className="in"
              value={pick.mode}
              onChange={(e) => setPick({ mode: e.target.value as UiPickMode })}
            >
              <option value="random">A random unused option</option>
              <option value="first">The first unused option</option>
              <option value="named">A specific option…</option>
            </select>
          </Field>
          {pick.mode === 'named' && (
            <Field label="Option text" hint="Exactly as shown in the list. You can use {{variables}}.">
              <input
                className="in"
                value={pick.text}
                placeholder="Admin"
                onChange={(e) => setPick({ text: e.target.value })}
              />
            </Field>
          )}
          <Field
            label="Save the chosen text as"
            hint="Use it in later steps, e.g. Check text is shown → {{city}}."
          >
            <input
              className="in code"
              value={pick.saveAs}
              placeholder="city"
              onChange={(e) => setPick({ saveAs: e.target.value.replace(/[^\w]/g, '') })}
            />
          </Field>
          <Field
            label="Also skip options matching (optional)"
            hint="CSS for options your app marks as used in its own way, e.g. .is-selected"
          >
            <input
              className="in code"
              value={pick.skip}
              placeholder="Detected automatically"
              onChange={(e) => setPick({ skip: e.target.value })}
            />
          </Field>
        </div>
      )}
      {/* Jeda & batas tunggu elemen tidak berlaku untuk step tanpa aksi di halaman. */}
      {step.type !== 'apiScenario' && step.type !== 'setVariable' && (
        <div className="row wrap small" style={{ gap: 12 }}>
          <label
            className="row"
            style={{ gap: 6 }}
            title="Pause before this step when the test runs with the browser visible (recorded speed). Filled in automatically while recording."
          >
            Pause
            <input
              className="in"
              type="number"
              min={0}
              max={MAX_UI_STEP_DELAY_MS}
              step={100}
              style={{ width: 90 }}
              placeholder={String(DEFAULT_UI_STEP_DELAY_MS)}
              value={step.delayMs ?? ''}
              onChange={(e) => onChange({ delayMs: e.target.value ? Number(e.target.value) : null })}
            />
            ms before
          </label>
          <label className="row" style={{ gap: 6 }}>
            Wait up to
            <input
              className="in"
              type="number"
              style={{ width: 90 }}
              placeholder="10000"
              value={step.timeoutMs ?? ''}
              onChange={(e) => onChange({ timeoutMs: e.target.value ? Number(e.target.value) : null })}
            />
            ms for the element
          </label>
          {isAssertion(step.type) && <span className="chip plain">check</span>}
        </div>
      )}
      <div className="row wrap small" style={{ gap: 8, alignItems: 'center' }}>
        <span className="muted">If this step fails:</span>
        <select
          className="in"
          style={{ width: 'auto', maxWidth: 360 }}
          value={step.onFailPass ? '__pass' : step.onFailSkip ? '__skip' : (step.retryFrom ?? '')}
          onChange={(e) => {
            const none = {
              retryFrom: undefined,
              retryMax: undefined,
              onFailPass: undefined,
              onFailSkip: undefined,
            };
            onChange(
              e.target.value === '__pass'
                ? { ...none, onFailPass: true }
                : e.target.value === '__skip'
                  ? { ...none, onFailSkip: step.onFailSkip ?? 1 }
                  : e.target.value
                    ? { ...none, retryFrom: e.target.value, retryMax: step.retryMax ?? 3 }
                    : none,
            );
          }}
        >
          <option value="">stop the test (default)</option>
          <option value="__pass">end the test as passed (skip the rest, e.g. no data to test)</option>
          <option value="__skip">skip the next steps and continue (a part that only shows sometimes)</option>
          {steps.slice(0, position + 1).map((s, i) => (
            <option key={s.id} value={s.id}>
              retry from step {i + 1} · {s.description.slice(0, 50)}
            </option>
          ))}
        </select>
        {!!step.onFailSkip && (
          <label className="row" style={{ gap: 6 }}>
            skip the next
            <input
              className="in"
              type="number"
              min={1}
              max={50}
              style={{ width: 70 }}
              value={step.onFailSkip}
              onChange={(e) =>
                onChange({ onFailSkip: Math.min(Math.max(Number(e.target.value) || 1, 1), 50) })
              }
            />
            {step.onFailSkip === 1 ? 'step' : 'steps'}
            {steps[position + step.onFailSkip] &&
              ` (to step ${position + 1 + step.onFailSkip} · ${steps[position + step.onFailSkip].description.slice(0, 40)})`}
          </label>
        )}
        {step.retryFrom && (
          <label className="row" style={{ gap: 6 }}>
            up to
            <input
              className="in"
              type="number"
              min={1}
              max={20}
              style={{ width: 70 }}
              value={step.retryMax ?? 3}
              onChange={(e) => onChange({ retryMax: Math.min(Math.max(Number(e.target.value) || 1, 1), 20) })}
            />
            times — "Save element text" steps then pick a value not tried yet in this run
          </label>
        )}
      </div>
    </div>
  );
}
