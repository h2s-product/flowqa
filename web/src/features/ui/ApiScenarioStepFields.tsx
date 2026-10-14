import { Link } from 'react-router-dom';
import type { UiStep } from '@flowqa/shared';
import { useScenarios } from '@/api/queries';
import { Field } from '@/components/ui';
import { useWorkspace } from '@/context/WorkspaceContext';

const DEFAULT_DESCRIPTION = /^(Run API scenario.*)?$/;

/**
 * Pengaturan step "Run API scenario": pilih scenario API Tester yang dijalankan di
 * tengah UI test (mis. aksi "aplikasi mobile"), plus penjelasan alur variabelnya.
 */
export function ApiScenarioStepFields({
  step,
  onChange,
}: {
  step: UiStep;
  onChange: (patch: Partial<UiStep>) => void;
}) {
  const { projectId } = useWorkspace();
  const { data: scenarios = [], isLoading } = useScenarios(projectId);
  const chosen = scenarios.find((s) => s.id === step.apiScenarioId);
  // Variabel yang dihasilkan scenario (capture) → bisa dipakai step web berikutnya.
  const produces = [
    ...new Set(
      (chosen?.steps ?? [])
        .flatMap((s) => (s.type === 'api' ? s.captures.map((c) => c.variable) : []))
        .filter(Boolean),
    ),
  ];

  const choose = (id: string) => {
    const scenario = scenarios.find((s) => s.id === id);
    onChange({
      apiScenarioId: id,
      ...(scenario && DEFAULT_DESCRIPTION.test(step.description)
        ? { description: `Run API scenario "${scenario.name}"` }
        : {}),
    });
  };

  return (
    <div className="grid">
      <Field
        label="API scenario"
        hint="A scenario from API Tester in this project, e.g. the mobile app submitting data or a second user approving it."
      >
        <select className="in" value={step.apiScenarioId ?? ''} onChange={(e) => choose(e.target.value)}>
          <option value="">
            {isLoading ? 'Loading…' : scenarios.length ? 'Choose a scenario…' : 'No scenarios yet'}
          </option>
          {[...scenarios]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.steps.length} step{s.steps.length === 1 ? '' : 's'})
              </option>
            ))}
        </select>
      </Field>
      <div className="banner small">
        <span>
          <b>In:</b> every value set earlier in this UI test (Set a value, Pick an option, earlier API
          scenarios) is available to the scenario as <span className="code">{'{{name}}'}</span>, together with
          the environment chosen at the top right.
          <br />
          <b>Out:</b>{' '}
          {produces.length ? (
            <>
              values it captures —{' '}
              {produces.map((v, i) => (
                <span key={v}>
                  {i > 0 && ', '}
                  <span className="code">{`{{${v}}}`}</span>
                </span>
              ))}{' '}
              — can be used by the next web steps, e.g. to search for the new record.
            </>
          ) : (
            <>values the scenario captures can be used by the next web steps.</>
          )}{' '}
          If an API call fails, this step fails and the rest is skipped.
        </span>
      </div>
      {chosen && (
        <div className="small">
          <Link to={`/scenarios/${chosen.id}`}>Open “{chosen.name}” in API Tester</Link>
        </div>
      )}
    </div>
  );
}
