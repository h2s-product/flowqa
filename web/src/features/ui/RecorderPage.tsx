import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useFolders, useRecording, useRecordingActions } from '@/api/queries';
import { FolderSelect } from '@/components/folders/FolderSelect';
import { indexFolders } from '@/components/folders/folderIndex';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import { EmptyState, ErrorBox, Field, IconButton, Loading } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { StepTypeIcon, stepTypeLabel, stepValue } from './uiSteps';
import { LIVE_RECORDING_STATUSES } from '@flowqa/shared';
import { useConfirm } from '@/context/ConfirmContext';

const STATUS_TEXT = {
  starting: 'Opening Chrome…',
  'signing-in': 'Signing in to the web app…',
  replaying: 'Replaying the existing steps before you continue…',
  recording: 'Recording — use the Chrome window. Every click and input appears here.',
  stopped: 'Recording stopped. Review the steps and save the test.',
  failed: 'The recording could not start.',
};

/** Pantau sesi rekaman secara live, lalu simpan sebagai UI test case. */
export function RecorderPage() {
  const { sessionId = '' } = useParams();
  const { projectId = '' } = useWorkspace();
  const { data: session, isLoading, error } = useRecording(sessionId);
  const actions = useRecordingActions(sessionId, projectId);
  const { data: folders = [] } = useFolders('ui', projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const stepCount = session?.steps.length ?? 0;

  useEffect(() => {
    if (session) {
      setName((n) => n || session.name);
      setFolderId((f) => f ?? session.folderId);
    }
  }, [session]);
  // Gulir ke step terbaru saat ada step baru masuk.
  // Kurung kurawal penting: scrollIntoView bisa mengembalikan Promise, dan efek tidak boleh mengembalikan apa pun.
  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [stepCount]);

  if (isLoading) return <Loading />;
  if (error || !session)
    return (
      <div className="panel">
        <EmptyState
          title="This recording is no longer available"
          action={
            <Link className="btn" to="/ui/tests">
              Back to UI tests
            </Link>
          }
        >
          It was saved, discarded, or the server restarted.
        </EmptyState>
      </div>
    );

  const live = LIVE_RECORDING_STATUSES.includes(session.status);
  const isNew = !session.testCaseId;

  const save = () =>
    actions.save.mutate(
      { name: name.trim() || session.name, folderId },
      {
        onSuccess: (test) => {
          toast(isNew ? 'UI test saved' : `${session.steps.length} steps added to the test`);
          navigate(`/ui/tests/${test.id}`);
        },
      },
    );
  const discard = async () =>
    (await confirm({
      title: 'Discard this recording?',
      message: 'The browser window closes and the recorded steps are lost.',
      confirmLabel: 'Discard',
    })) && actions.cancel.mutate(undefined, { onSuccess: () => navigate('/ui/tests') });

  return (
    <div className="recorder">
      <div className={`rec-status ${session.status}`}>
        <span className="rec-dot" aria-hidden="true" />
        <div className="grow">
          <b>{STATUS_TEXT[session.status]}</b>
          <div className="small">
            {isNew ? 'New test' : `Continuing “${session.name}”`} · started{' '}
            <DateTime value={session.startedAt} /> · <span className="code">{session.startUrl}</span>
          </div>
        </div>
        {live ? (
          <button
            className="btn danger"
            onClick={() => actions.stop.mutate()}
            disabled={actions.stop.isPending}
          >
            <Icon name="stop" size={13} /> Stop recording
          </button>
        ) : null}
      </div>

      {session.error && (
        <div className="mb-12">
          <ErrorBox error={session.error} />
        </div>
      )}

      <div className="dash-grid" style={{ marginTop: 0 }}>
        <section className="panel c-8">
          <div className="panel-h">
            <h3>Recorded steps</h3>
            <span className="small muted">
              {session.steps.length} new step{session.steps.length === 1 ? '' : 's'}
              {session.replayed ? ` · ${session.replayed} existing steps replayed` : ''}
            </span>
          </div>
          {session.steps.length ? (
            <ol className="ui-step-list">
              {session.steps.map((step, i) => (
                <li key={step.id}>
                  <span className="num muted">{i + 1 + (isNew ? 0 : session.replayed)}</span>
                  <StepTypeIcon type={step.type} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{step.description}</b>
                    <div className="small muted ellipsis">
                      {stepTypeLabel(step.type)}
                      {stepValue(step) && (
                        <>
                          {' '}
                          · <span className="code">{stepValue(step)}</span>
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
            <div className="panel-b muted">
              {live ? 'Waiting for your first action in the Chrome window…' : 'No steps were recorded.'}
            </div>
          )}
        </section>

        <section className="panel c-4">
          <div className="panel-h">
            <h3>{isNew ? 'Save as test' : 'Add to test'}</h3>
          </div>
          <div className="panel-b grid">
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
              <Icon name="check" size={14} /> {live ? 'Stop & save' : 'Save'}
            </button>
            <button className="btn ghost" onClick={discard}>
              Discard recording
            </button>
            <div className="small muted rec-tips">
              <b>Tips while recording</b>
              <ul>
                <li>
                  Use <b>✓ Check text</b> or <b>👁 Check visible</b> in the in-page toolbar, then click an
                  element to add a check.
                </li>
                <li>
                  Use <b>🔗 Check URL</b> to verify you landed on the right page.
                </li>
                <li>Typing is saved as one step per field. Passwords are hidden.</li>
                <li>Closing the Chrome window also stops the recording.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
