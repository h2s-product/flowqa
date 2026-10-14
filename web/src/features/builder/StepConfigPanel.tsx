import { useEffect, useState } from 'react';
import type { ApiDefinition, ApiStep, Environment, Run, Scenario, Step } from '@flowqa/shared';
import { Icon } from '@/components/Icon';
import { EmptyState, MethodBadge, Tabs } from '@/components/ui';
import { ConditionForm, SetVariableForm, WaitForm } from './SimpleStepForms';
import { CaptureTab } from './tabs/CaptureTab';
import { ExpectTab } from './tabs/ExpectTab';
import { RequestTab } from './tabs/RequestTab';
import { SettingsTab } from './tabs/SettingsTab';

export type ConfigTab = 'request' | 'capture' | 'expect' | 'settings';

interface Props {
  scenario: Scenario;
  index: number;
  apis: ApiDefinition[];
  environment?: Environment;
  run?: Run;
  tab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
  onChange: (updater: (step: Step) => Step) => void;
  onAddStep: () => void;
}

/** Panel kanan: konfigurasi step yang sedang dipilih. */
export function StepConfigPanel({
  scenario,
  index,
  apis,
  environment,
  run,
  tab,
  onTabChange,
  onChange,
  onAddStep,
}: Props) {
  const step = scenario.steps[index];
  const [name, setName] = useState(step?.name ?? '');
  useEffect(() => setName(step?.name ?? ''), [step?.id, step?.name]);

  if (!step) {
    return (
      <EmptyState
        title="No step selected"
        action={
          <button className="btn primary" onClick={onAddStep}>
            Add first step
          </button>
        }
      >
        Add a step to start building the flow.
      </EmptyState>
    );
  }

  const result = run?.steps.find((r) => r.stepId === step.id);
  const common = { scenario, index, environment };
  const patch = <T extends Step>(p: Partial<T>) => onChange((s) => ({ ...s, ...p }) as Step);

  let body: JSX.Element;
  if (step.type === 'api') {
    const api = apis.find((a) => a.id === step.apiId);
    const props = { ...common, step, update: (p: Partial<ApiStep>) => patch<ApiStep>(p), api, apis, result };
    body = (
      <>
        <Tabs
          tabs={[
            { id: 'request', label: 'Request' },
            { id: 'capture', label: 'Capture values', count: step.captures.length },
            { id: 'expect', label: 'Checks', count: step.assertions.length },
            { id: 'settings', label: 'Settings' },
          ]}
          active={tab}
          onChange={onTabChange}
        />
        {tab === 'request' && <RequestTab {...props} />}
        {tab === 'capture' && <CaptureTab {...props} />}
        {tab === 'expect' && <ExpectTab {...props} />}
        {tab === 'settings' && <SettingsTab {...props} />}
      </>
    );
  } else if (step.type === 'wait') {
    body = <WaitForm {...common} step={step} update={(p) => patch(p)} />;
  } else if (step.type === 'setVariable') {
    body = <SetVariableForm {...common} step={step} update={(p) => patch(p)} />;
  } else {
    body = <ConditionForm {...common} step={step} update={(p) => patch(p)} />;
  }

  const api = step.type === 'api' ? apis.find((a) => a.id === step.apiId) : undefined;
  return (
    <>
      <div className="cfg-section" style={{ paddingBottom: 12 }}>
        <div className="row">
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
            Step {index + 1}
          </span>
          {api && <MethodBadge method={api.method} />}
          <input
            className="in"
            style={{
              fontWeight: 600,
              fontSize: 15,
              border: '1px solid transparent',
              background: 'transparent',
            }}
            value={name}
            aria-label="Step name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== step.name && patch({ name: name.trim() || step.name })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {step.disabled && (
            <span className="chip plain">
              <Icon name="power" size={12} /> off
            </span>
          )}
        </div>
      </div>
      {body}
    </>
  );
}
