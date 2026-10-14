import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { UiRun } from '@flowqa/shared';
import { LIVE_UI_RUN_STATUSES, MOBILE_EXECUTION_MODE_LABEL } from '@flowqa/shared';
import { MobileErrorHelp } from './mobileMode';
import { useRunUiTestAndOpen, useStopUiRun, useUiRun } from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import {
  BackLink,
  ErrorBox,
  IconButton,
  Loading,
  RunCounts,
  Stat,
  StatGrid,
  StatusBadge,
  StatusIcon,
} from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useRunDeletion } from '@/components/runs/useRunDeletion';
import { StopRunButton, StoppedNote } from '@/components/runs/StopRunButton';
import { formatMs, formatNumber, timeAgo } from '@/lib/format';
import { StepTypeIcon } from './uiSteps';

const shotUrl = (run: UiRun, file: string) => `/api/ui-runs/${run.id}/screenshots/${file}`;

/** Hasil satu UI run: status setiap step, waktu, error, dan screenshot. */
export function UiRunDetailPage() {
  const { runId = '' } = useParams();
  const { projectId = '', environment } = useWorkspace();
  const { data: run, isLoading, error } = useUiRun(runId);
  const again = useRunUiTestAndOpen(projectId);
  const [viewing, setViewing] = useState<number | null>(null);
  const deletion = useRunDeletion('ui');
  const stop = useStopUiRun();
  const navigate = useNavigate();

  if (isLoading) return <Loading />;
  if (error || !run) return <ErrorBox error={error} />;

  const running = LIVE_UI_RUN_STATUSES.includes(run.status);
  const done = run.steps.filter((s) => s.status !== 'queued' && s.status !== 'running').length;
  const withShots = run.steps.filter((s) => s.screenshot);

  const rerun = (headless: boolean) =>
    again.run({ id: run.testCaseId, headless, environmentId: environment?.id, mode: run.mobile?.mode });

  const browser = splitBrowser(run.browser);
  const mobile = run.target === 'mobile';
  // Mobile: "Android 14 · Pixel 7" → platform & perangkat.
  const [platform, ...device] = run.browser.split(' · ');

  return (
    <>
      <div className="row wrap detail-bar">
        <BackLink to="/ui/runs" label="UI test runs" />
        <div className="grow" />
        <IconButton
          icon="trash"
          label={running ? 'A running test cannot be deleted' : 'Delete run'}
          className="danger"
          disabled={running || deletion.deleting}
          onClick={() => deletion.remove(run.projectId, [run.id], () => navigate('/ui/runs'))}
        />
        <Link className="btn" to={`/ui/tests/${run.testCaseId}`}>
          Open test
        </Link>
        {!running && run.steps.some((s) => s.screenshot) && (
          <a
            className="btn"
            href={`/api/ui-tests/${run.testCaseId}/manual?runId=${run.id}`}
            title="HTML manual book of the test, with the screenshots of this run"
          >
            <Icon name="download" size={14} /> Manual book
          </a>
        )}
        {running && (
          <StopRunButton
            pending={stop.isPending}
            what={
              mobile
                ? run.status === 'queued'
                  ? 'The test leaves the device queue and will not run.'
                  : 'The Appium session closes (the device is freed for the next test) and the remaining steps are skipped.'
                : 'The browser closes and the remaining steps are skipped.'
            }
            onStop={(done) => stop.mutate(run.id, done)}
          />
        )}
        <button
          className="btn"
          title={
            mobile
              ? 'Replays the steps on the device at the speed they were recorded'
              : 'Opens Chrome on the server and replays the steps at the speed they were recorded'
          }
          onClick={() => rerun(false)}
          disabled={running || again.isPending}
        >
          <Icon name="eye" size={14} /> {mobile ? 'Run at recorded speed' : 'Run with browser visible'}
        </button>
        <button className="btn primary" onClick={() => rerun(true)} disabled={running || again.isPending}>
          <Icon name="play" size={13} /> Run again
        </button>
      </div>

      <StatGrid className="mb-16" columns={3}>
        <Stat label="Test" size="sm" value={run.testName} sub={run.testCode} />
        <Stat
          label="Result"
          value={
            <StatusBadge status={run.status}>
              {run.status === 'queued'
                ? 'Waiting for device'
                : running
                  ? `Running ${done}/${run.steps.length}`
                  : undefined}
            </StatusBadge>
          }
          sub={running ? undefined : `took ${formatMs(run.durationMs)}`}
        />
        <Stat
          label="Steps"
          size="sm"
          value={formatNumber(run.steps.length)}
          sub={
            <RunCounts passed={run.counts.passed} failed={run.counts.failed} skipped={run.counts.skipped} />
          }
        />
        <Stat
          label="Started"
          size="sm"
          value={<DateTime value={run.startedAt} />}
          sub={timeAgo(run.startedAt)}
        />
        <Stat label="Finished" size="sm" value={running ? '…' : <DateTime value={run.finishedAt} />} />
        {mobile ? (
          <Stat
            label="Device"
            size="sm"
            value={run.mobile?.device || device.join(' · ') || platform}
            sub={[
              run.mobile ? MOBILE_EXECUTION_MODE_LABEL[run.mobile.mode] : '',
              run.mobile?.androidVersion || (device.length ? platform : ''),
              run.mobile?.udid,
              run.pace === 'recorded' && 'recorded speed',
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        ) : (
          <Stat
            label="Browser"
            size="sm"
            value={browser.name}
            sub={[
              browser.version && `v${browser.version}`,
              run.headless ? 'headless' : 'visible',
              run.pace === 'recorded' && 'recorded speed',
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        )}
      </StatGrid>

      {mobile && run.mobile && (run.mobile.appVersion || run.mobile.appiumVersion) && (
        <p className="small muted mb-12">
          App <span className="code">{run.mobile.appPackage || '-'}</span>
          {run.mobile.appVersion && <> v{run.mobile.appVersion}</>} · Appium {run.mobile.appiumVersion || '-'}{' '}
          · UiAutomator2
        </p>
      )}

      {run.status === 'stopped' && (
        <StoppedNote by={run.stoppedBy} what="The steps that had not run yet were skipped." />
      )}

      {run.errorCode && !running ? (
        <div className="mb-16">
          <MobileErrorHelp code={run.errorCode} detail={run.failureReason} />
        </div>
      ) : (
        run.failureReason &&
        !running && (
          <div className="mb-16">
            <ErrorBox>
              <b>Why it failed:</b> {run.failureReason}
            </ErrorBox>
          </div>
        )
      )}

      {!!run.artifacts?.length && (
        <section className="panel mb-16">
          <div className="panel-h">
            <h3>Logs & files</h3>
            <span className="small muted">Sensitive values are masked</span>
          </div>
          <div className="panel-b row wrap" style={{ gap: 8 }}>
            {run.artifacts.map((a) => (
              <a key={a.file} className="btn sm" href={shotUrl(run, a.file)} target="_blank" rel="noreferrer">
                <Icon name={a.kind === 'page-source' ? 'code' : 'terminal'} size={12} /> {a.label}
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-h">
          <h3>Steps</h3>
          <span className="small muted">Click a screenshot to enlarge it</span>
        </div>
        <ol className="ui-step-list results">
          {run.steps.map((s) => (
            <li key={s.stepId} className={s.status}>
              <StatusIcon status={s.status} />
              <StepTypeIcon type={s.type} target={run.target} />
              <div className="grow" style={{ minWidth: 0 }}>
                <b>
                  {s.index + 1}. {s.description}
                </b>
                <div className="small muted">
                  {s.startedAt ? (
                    <>
                      <DateTime value={s.startedAt} timeOnly /> · {formatMs(s.durationMs)}
                    </>
                  ) : s.status === 'queued' ? (
                    'Waiting'
                  ) : (
                    ''
                  )}
                  {s.usedSelector && (
                    <>
                      {' '}
                      · <span className="code">{s.usedSelector}</span>
                    </>
                  )}
                </div>
                {s.detail && <div className="small text-pass">{s.detail}</div>}
                {s.apiRunId && (
                  <div className="small">
                    <Link to={`/runs/${s.apiRunId}`}>Open API run (requests & responses)</Link>
                  </div>
                )}
                {s.error && (
                  <div
                    className="small"
                    style={{ color: s.status === 'failed' ? 'var(--red)' : 'var(--ink3)' }}
                  >
                    {s.error}
                  </div>
                )}
              </div>
              {s.screenshot && (
                <button
                  className={`ui-shot ${run.target === 'mobile' ? 'portrait' : ''}`}
                  onClick={() => setViewing(withShots.findIndex((w) => w.stepId === s.stepId))}
                  title="Enlarge screenshot"
                >
                  <img
                    src={shotUrl(run, s.screenshot)}
                    alt={`Screenshot after step ${s.index + 1}`}
                    loading="lazy"
                  />
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>

      {viewing !== null && withShots[viewing] && (
        <Lightbox
          run={run}
          index={viewing}
          steps={withShots}
          onChange={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

function Lightbox({
  run,
  index,
  steps,
  onChange,
  onClose,
}: {
  run: UiRun;
  index: number;
  steps: UiRun['steps'];
  onChange: (i: number) => void;
  onClose: () => void;
}) {
  const step = steps[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < steps.length - 1) onChange(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onChange(index - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, steps.length, onChange, onClose]);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`lightbox ${run.target === 'mobile' ? 'portrait' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="row" style={{ marginBottom: 8 }}>
          <StatusIcon status={step.status} />
          <b className="grow">
            Step {step.index + 1}. {step.description}
          </b>
          <span className="small muted">
            {index + 1} / {steps.length}
          </span>
          <IconButton
            icon="up"
            label="Previous"
            size={16}
            onClick={() => onChange(index - 1)}
            disabled={index === 0}
          />
          <IconButton
            icon="down"
            label="Next"
            size={16}
            onClick={() => onChange(index + 1)}
            disabled={index === steps.length - 1}
          />
          <IconButton icon="x" label="Close" size={16} onClick={onClose} />
        </div>
        <img src={shotUrl(run, step.screenshot!)} alt={`Screenshot after step ${step.index + 1}`} />
        {step.error && (
          <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>
            {step.error}
          </div>
        )}
      </div>
    </div>
  );
}

/** "Google Chrome 153.0.8010.5" → nama + versi, agar versi tampil sebagai keterangan kecil. */
function splitBrowser(label: string) {
  const m = /^(.*?)\s+v?(\d+(?:\.\d+)+)$/.exec(label.trim());
  return m ? { name: m[1], version: m[2] } : { name: label, version: '' };
}
