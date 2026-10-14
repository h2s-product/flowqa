import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Step } from '@flowqa/shared';
import { createId } from '@flowqa/shared';
import { useApis, useRun, useRuns, useScenario, useStartRun } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { BackLink, ErrorBox, Loading, Tabs, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { AddStepModal, type AddStepAction } from './AddStepModal';
import { RunResultsPanel } from './RunResultsPanel';
import { StepCard } from './StepCard';
import { StepConfigPanel, type ConfigTab } from './StepConfigPanel';
import { createAssertion } from './step-factory';
import { useScenarioDraft } from './useScenarioDraft';
import { DateTime } from '@/components/DateTime';
import { useConfirm } from '@/context/ConfirmContext';

const SAVE_LABEL = {
  saved: 'All changes saved',
  unsaved: 'Unsaved changes…',
  saving: 'Saving…',
  error: 'Could not save — retrying on next change',
};

export function ScenarioBuilderPage() {
  const { scenarioId = '' } = useParams();
  const { environment } = useWorkspace();
  const scenarioQuery = useScenario(scenarioId);
  const { draft, saveState, change, updateStep, flush } = useScenarioDraft(scenarioQuery.data);
  const { data: apis = [] } = useApis(draft?.projectId);
  const lastRuns = useRuns(draft?.projectId, { scenarioId, limit: 1 });
  const startRun = useStartRun();
  const toast = useToast();
  const confirm = useConfirm();

  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<'config' | 'results'>('config');
  const [configTab, setConfigTab] = useState<ConfigTab>('request');
  const [adding, setAdding] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);

  const currentRunId = runId ?? lastRuns.data?.[0]?.id ?? null;
  const run = useRun(currentRunId).data;

  useEffect(() => {
    setRunId(null);
    setActiveIndex(0);
    setSelected(new Set());
  }, [scenarioId]);

  if (scenarioQuery.isLoading) return <Loading />;
  if (scenarioQuery.error || !draft) return <ErrorBox error={scenarioQuery.error} />;

  const steps = draft.steps;
  const running = run?.status === 'running';
  const setSteps = (updater: (steps: Step[]) => Step[]) => change((s) => ({ ...s, steps: updater(s.steps) }));

  const execute = async (options: { fromStep?: number; onlySteps?: number[] } = {}) => {
    if (!environment) return toast('Choose an environment first');
    await flush();
    startRun.mutate(
      { scenarioId: draft.id, environmentId: environment.id, ...options },
      { onSuccess: (r) => (setRunId(r.id), setPanel('results')) },
    );
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    setSteps((list) => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setActiveIndex(to);
  };

  const handleAddAction = (action: AddStepAction) => {
    setAdding(false);
    if (action.kind === 'insert') {
      const at = steps.length ? Math.min(activeIndex + 1, steps.length) : 0;
      setSteps((list) => [...list.slice(0, at), action.step, ...list.slice(at)]);
      setActiveIndex(at);
      setConfigTab('request');
    } else if (action.kind === 'assertion') {
      updateStep(activeIndex, (s) =>
        s.type === 'api' ? { ...s, assertions: [...s.assertions, createAssertion(action.assertion)] } : s,
      );
      setConfigTab('expect');
    } else {
      setConfigTab(action.tab);
    }
    setPanel('config');
  };

  const selectedIndexes = steps.map((s, i) => (selected.has(s.id) ? i : -1)).filter((i) => i >= 0);

  return (
    <>
      <div className="row wrap detail-bar">
        <BackLink to="/scenarios" label="Scenarios" />
        <div className="grow" style={{ minWidth: 240 }}>
          <input
            className="in"
            style={{
              fontSize: 18,
              fontWeight: 650,
              border: '1px solid transparent',
              background: 'transparent',
              padding: '4px 6px',
            }}
            value={draft.name}
            aria-label="Scenario name"
            onChange={(e) => change((s) => ({ ...s, name: e.target.value }))}
          />
          <input
            className="in small"
            style={{
              border: '1px solid transparent',
              background: 'transparent',
              padding: '2px 6px',
              color: 'var(--ink2)',
            }}
            value={draft.description}
            placeholder="Describe what this scenario proves"
            aria-label="Scenario description"
            onChange={(e) => change((s) => ({ ...s, description: e.target.value }))}
          />
        </div>
        <span
          className={`small ${saveState === 'error' ? '' : 'muted'}`}
          style={saveState === 'error' ? { color: 'var(--red)' } : undefined}
        >
          {SAVE_LABEL[saveState]}
          {saveState === 'saved' && scenarioQuery.data?.updatedAt && (
            <>
              {' '}
              · <DateTime value={scenarioQuery.data.updatedAt} />
            </>
          )}
        </span>
      </div>

      <div className="builder">
        <section className="panel">
          <div className="panel-h">
            <h3>Flow</h3>
            <span className="small muted">{steps.length} steps</span>
            <div className="grow" />
            <span className="small" title="Run remaining steps even after a failure">
              <Toggle
                checked={draft.continueOnFailure}
                onChange={(continueOnFailure) => change((s) => ({ ...s, continueOnFailure }))}
              >
                Keep going after a failure
              </Toggle>
            </span>
          </div>
          <div className="run-bar">
            <button
              className="btn primary"
              onClick={() => execute()}
              disabled={running || !steps.length || startRun.isPending}
            >
              <Icon name={running ? 'spin' : 'play'} size={13} /> {running ? 'Running…' : 'Run test'}
            </button>
            <button
              className="btn"
              onClick={() => execute({ fromStep: activeIndex })}
              disabled={running || !steps.length}
            >
              Run from step {activeIndex + 1}
            </button>
            <button
              className="btn"
              onClick={() => execute({ onlySteps: selectedIndexes })}
              disabled={running || !selectedIndexes.length}
            >
              Run selected ({selectedIndexes.length})
            </button>
            <div className="grow" />
            <span className="small muted">
              on <b>{environment?.name}</b>
            </span>
          </div>
          <div className="flow">
            {steps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                index={i}
                total={steps.length}
                api={step.type === 'api' ? apis.find((a) => a.id === step.apiId) : undefined}
                apis={apis}
                result={run?.steps.find((r) => r.stepId === step.id)}
                active={i === activeIndex}
                selected={selected.has(step.id)}
                onSelect={() => (setActiveIndex(i), setPanel('config'))}
                onToggleSelected={() =>
                  setSelected(
                    (s) => new Set(s.has(step.id) ? [...s].filter((x) => x !== step.id) : [...s, step.id]),
                  )
                }
                onMove={(to) => move(i, to)}
                onDuplicate={() => {
                  setSteps((list) => [
                    ...list.slice(0, i + 1),
                    { ...structuredClone(step), id: createId('st'), name: `${step.name} (copy)` },
                    ...list.slice(i + 1),
                  ]);
                  setActiveIndex(i + 1);
                }}
                onToggleDisabled={() => updateStep(i, (s) => ({ ...s, disabled: !s.disabled }))}
                onDelete={async () => {
                  // Builder menyimpan otomatis, jadi hapus step dikonfirmasi dulu.
                  if (
                    !(await confirm({
                      title: `Delete step ${i + 1} “${step.name}”?`,
                      message: 'The change is saved automatically.',
                    }))
                  )
                    return;
                  setSteps((list) => list.filter((_, j) => j !== i));
                  setActiveIndex(Math.max(0, Math.min(activeIndex, steps.length - 2)));
                }}
                onDropStep={(from) => move(from, i)}
              />
            ))}
            <button className="add-step" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} /> Add step {steps.length ? `after step ${activeIndex + 1}` : ''}
            </button>
          </div>
        </section>

        <section className="panel cfg">
          <div style={{ padding: '0 16px' }}>
            <Tabs
              tabs={[
                { id: 'config' as const, label: 'Configure step' },
                { id: 'results' as const, label: running ? 'Results · running' : 'Results' },
              ]}
              active={panel}
              onChange={setPanel}
            />
          </div>
          {panel === 'config' ? (
            <StepConfigPanel
              scenario={draft}
              index={activeIndex}
              apis={apis}
              environment={environment}
              run={run}
              tab={configTab}
              onTabChange={setConfigTab}
              onChange={(updater) => updateStep(activeIndex, updater)}
              onAddStep={() => setAdding(true)}
            />
          ) : (
            <RunResultsPanel run={run} />
          )}
        </section>
      </div>

      {adding && (
        <AddStepModal
          apis={apis}
          currentStep={steps[activeIndex]}
          currentIndex={activeIndex}
          onAction={handleAddAction}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
}
