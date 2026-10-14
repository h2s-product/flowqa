import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useAddDemoUiTest,
  useDeleteUiTest,
  useDuplicateUiTest,
  useRunUiTestAndOpen,
  useRunUiTestsBatch,
  useStartInspector,
  useStartRecording,
  useUiTests,
  type UiTestWithLastRun,
} from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { FolderBrowser } from '@/components/folders/FolderBrowser';
import { useFolderBrowser } from '@/components/folders/useFolderBrowser';
import { Icon } from '@/components/Icon';
import {
  ErrorBox,
  IconButton,
  Loading,
  SearchInput,
  Segmented,
  SelectCell,
  StatusBadge,
} from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { plural } from '@/lib/format';
import { NewMobileTestModal } from './NewMobileTestModal';
import { NewRecordingModal } from './NewRecordingModal';
import { ExecutionModePicker, useExecutionMode } from './mobileMode';
import { testTarget } from './uiSteps';
import { useConfirm } from '@/context/ConfirmContext';

const LABELS = { one: 'UI test', many: 'UI tests' };

type PlatformFilter = 'all' | 'web' | 'android';
const PLATFORM_FILTERS: { id: PlatformFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'web', label: 'Web' },
  { id: 'android', label: 'Android' },
];

/** Platform test: web atau android. */
const platformOf = (t: UiTestWithLastRun): Exclude<PlatformFilter, 'all'> =>
  testTarget(t) === 'mobile' ? 'android' : 'web';

/** Keterangan di bawah nama test: URL awal (web) atau aplikasi (mobile). */
const testSubtitle = (t: UiTestWithLastRun) =>
  testTarget(t) === 'mobile'
    ? t.mobile?.appPackage || t.mobile?.app.split('/').pop() || 'Android app'
    : t.startUrl;

export function UiTestsPage() {
  const { projectId = '', environment } = useWorkspace();
  const { data: tests = [], isLoading, error } = useUiTests(projectId);
  const run = useRunUiTestAndOpen(projectId);
  const runBatch = useRunUiTestsBatch(projectId);
  const duplicate = useDuplicateUiTest(projectId);
  const remove = useDeleteUiTest(projectId);
  const recordMore = useStartRecording(projectId);
  const inspectMore = useStartInspector(projectId);
  const addDemo = useAddDemoUiTest(projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [recording, setRecording] = useState(false);
  const [newMobile, setNewMobile] = useState(false);
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [mode, setMode] = useExecutionMode();
  const hasMobile = tests.some((t) => testTarget(t) === 'mobile');
  const browser = useFolderBrowser({
    kind: 'ui',
    projectId,
    items: platform === 'all' ? tests : tests.filter((t) => platformOf(t) === platform),
    labels: LABELS,
    matches: (t, q) =>
      `${t.code ?? ''} ${t.name} ${testSubtitle(t)} ${t.description}`.toLowerCase().includes(q),
  });

  if (isLoading || browser.loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const start = (id: string, headless: boolean) =>
    run.run({ id, headless, environmentId: environment?.id, mode });
  const runSelected = (ids: string[], headless: boolean) =>
    runBatch.mutate(
      { ids, headless, environmentId: environment?.id, mode },
      {
        onSuccess: ({ queued, skipped }) => {
          browser.setChecked(new Set());
          toast(
            `Running ${plural(queued, 'UI test')} one after another${headless ? '' : ' at recorded speed (web tests in a visible Chrome window)'} — results appear in UI Test Runs.` +
              (skipped.length ? ` Skipped (no steps): ${skipped.join(', ')}.` : ''),
          );
        },
      },
    );
  const continueRecording = (t: UiTestWithLastRun) =>
    testTarget(t) === 'mobile'
      ? inspectMore.mutate(
          { testCaseId: t.id, environmentId: environment?.id, mode },
          { onSuccess: (s) => navigate(`/ui/mobile/${s.id}`) },
        )
      : recordMore.mutate(
          { testCaseId: t.id, environmentId: environment?.id },
          { onSuccess: (s) => navigate(`/ui/record/${s.id}`) },
        );

  return (
    <>
      <div className="row wrap toolbar">
        <SearchInput
          value={browser.search}
          onChange={browser.setSearch}
          placeholder="Search UI tests by name, URL or app"
        />
        {(hasMobile || platform !== 'all') && (
          <Segmented options={PLATFORM_FILTERS} value={platform} onChange={setPlatform} />
        )}
        <div className="grow" />
        {hasMobile && <ExecutionModePicker value={mode} onChange={setMode} />}
        <button className="btn" onClick={() => setNewMobile(true)}>
          <Icon name="android" size={14} /> New Android test
        </button>
        <button className="btn primary" onClick={() => setRecording(true)}>
          <Icon name="record" size={14} /> New recording
        </button>
      </div>

      <FolderBrowser
        browser={browser}
        allIcon="cursor"
        searchHint="Try another name or URL."
        onAddHere={() => setRecording(true)}
        bulkActions={(ids) => (
          <>
            <button
              className="btn sm blue"
              disabled={runBatch.isPending}
              onClick={() => runSelected(ids, true)}
              title="Runs the selected tests headless, one after another, with the environment chosen at the top right"
            >
              <Icon name="play" size={12} /> {runBatch.isPending ? 'Starting…' : `Run ${ids.length} selected`}
            </button>
            <button
              className="btn sm"
              disabled={runBatch.isPending}
              onClick={() => runSelected(ids, false)}
              title="Opens Chrome on the server and replays each selected test at the speed it was recorded, one after another"
            >
              <Icon name="eye" size={12} /> Run with browser visible
            </button>
          </>
        )}
        emptyProject={{
          title: 'No UI tests yet',
          body: 'Record your first test: open your web app (or your Android app with “New Android test”), click through it, and every action becomes a replayable step.',
          action: (
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <button className="btn primary" onClick={() => setRecording(true)}>
                <Icon name="record" size={14} /> Record a test
              </button>
              <button
                className="btn"
                disabled={addDemo.isPending}
                onClick={() =>
                  addDemo.mutate(undefined, {
                    onSuccess: (t) => navigate(`/ui/tests/${t.id}`),
                  })
                }
              >
                Add demo shop test
              </button>
            </div>
          ),
        }}
        tableHead={
          <thead>
            <tr>
              <th />
              <th>Test</th>
              <th>Steps</th>
              <th>Last result</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
        }
        renderRows={(items, { showFolder }) =>
          items.map((t) => (
            <tr
              key={t.id}
              className={`click ${browser.checked.has(t.id) ? 'selected' : ''}`}
              onClick={() => navigate(`/ui/tests/${t.id}`)}
              draggable
              onDragStart={(e) => browser.dragItem(e, t)}
            >
              <SelectCell
                checked={browser.checked.has(t.id)}
                onChange={() => browser.toggleCheck(t.id)}
                label={`Select ${t.name}`}
              />
              <td style={{ minWidth: 220 }}>
                {t.code && <span className="chip plain code test-code">{t.code}</span>} <b>{t.name}</b>{' '}
                {testTarget(t) === 'mobile' && (
                  <span className="chip plain platform-chip">
                    <Icon name="android" size={11} /> Android
                  </span>
                )}
                <div className="small muted code" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {showFolder ? (
                    <>
                      <Icon name="folder" size={11} /> {browser.folderLabel(t)}
                    </>
                  ) : (
                    testSubtitle(t)
                  )}
                </div>
              </td>
              <td>{t.steps.length}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {t.lastRun ? (
                  <>
                    <StatusBadge status={t.lastRun.status} />{' '}
                    <span className="small">
                      <DateTime value={t.lastRun.startedAt} relative />
                    </span>
                  </>
                ) : (
                  <span className="muted small">Never run</span>
                )}
              </td>
              <td className="small">
                <DateTime value={t.updatedAt} />
              </td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                <button
                  className="btn sm"
                  onClick={() => start(t.id, true)}
                  disabled={!t.steps.length || run.isPending}
                >
                  <Icon name="play" size={12} /> Run
                </button>
                <IconButton
                  icon="record"
                  label="Record more steps"
                  onClick={() => continueRecording(t)}
                  disabled={recordMore.isPending || inspectMore.isPending}
                />
                {t.steps.length > 0 && (
                  <a
                    className="icon-btn"
                    href={`/api/ui-tests/${t.id}/manual`}
                    title="Download manual book (HTML: steps + screenshots)"
                    aria-label="Download manual book"
                  >
                    <Icon name="download" size={14} />
                  </a>
                )}
                <IconButton
                  icon="copy"
                  label="Duplicate"
                  onClick={() => duplicate.mutate(t.id, { onSuccess: () => toast('Test duplicated') })}
                />
                <IconButton
                  icon="trash"
                  label="Delete"
                  onClick={async () =>
                    (await confirm({
                      title: `Delete “${t.name}”?`,
                      message:
                        'The UI test and its steps are deleted. Its run history stays in UI Test Runs.',
                    })) && remove.mutate(t.id)
                  }
                />
              </td>
            </tr>
          ))
        }
      />

      {newMobile && (
        <NewMobileTestModal
          folderIndex={browser.index}
          defaultFolderId={browser.selectedFolder?.id ?? null}
          onClose={() => setNewMobile(false)}
        />
      )}
      {recording && (
        <NewRecordingModal
          folderIndex={browser.index}
          defaultFolderId={browser.selectedFolder?.id ?? null}
          onClose={() => setRecording(false)}
        />
      )}
    </>
  );
}
