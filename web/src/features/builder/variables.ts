/**
 * Logika "aliran data" antar step: variabel apa yang dipakai & dihasilkan setiap step.
 * Dipakai untuk chip {{variabel}}, pemilih variabel, dan petunjuk sumber nilai.
 */
import type { ApiDefinition, Environment, Scenario, Step } from '@flowqa/shared';
import { DYNAMIC_VARIABLES, extractVariables, pathParameters } from '@flowqa/shared';

const DYNAMIC_KEYS = new Set<string>(DYNAMIC_VARIABLES.map((d) => d.key));

export function variablesUsed(step: Step, apis: ApiDefinition[]): string[] {
  const found = new Set(extractVariables(JSON.stringify(step)));
  if (step.type === 'api') {
    const api = apis.find((a) => a.id === step.apiId);
    if (api) {
      pathParameters(api.path).forEach((p) => !step.pathParams[p] && found.add(p));
      if (api.auth === 'bearer') found.add(step.tokenVariable || 'auth_token');
      extractVariables(JSON.stringify(api.headers)).forEach((v) => found.add(v));
    }
  }
  return [...found].filter((v) => !DYNAMIC_KEYS.has(v));
}

export function variablesProduced(step: Step): string[] {
  if (step.type === 'api') return step.captures.map((c) => c.variable).filter(Boolean);
  if (step.type === 'setVariable' && step.variable) return [step.variable];
  return [];
}

export function findProducer(scenario: Scenario, variable: string, beforeIndex: number) {
  for (let i = 0; i < Math.min(beforeIndex, scenario.steps.length); i++) {
    if (variablesProduced(scenario.steps[i]).includes(variable)) return { index: i, step: scenario.steps[i] };
  }
  return undefined;
}

export interface AvailableVariable {
  key: string;
  source: 'step' | 'environment' | 'dynamic';
  label: string;
}

export function availableVariables(
  scenario: Scenario,
  index: number,
  env?: Environment,
): AvailableVariable[] {
  const fromSteps = scenario.steps.slice(0, index).flatMap((s, i) =>
    variablesProduced(s).map((key) => ({
      key,
      source: 'step' as const,
      label: `Step ${i + 1} · ${s.name}`,
    })),
  );
  const fromEnv = (env?.variables ?? []).map((v) => ({
    key: v.key,
    source: 'environment' as const,
    label: 'Environment',
  }));
  const dynamic = DYNAMIC_VARIABLES.map((d) => ({ key: d.key, source: 'dynamic' as const, label: d.label }));
  return [...fromSteps, ...fromEnv, ...dynamic];
}

/** Usulan nama variabel saat user menekan "Capture" pada field response. */
export function suggestVariableName(
  api: ApiDefinition | undefined,
  field: string,
  taken: Set<string>,
): string {
  const last = field.split('.').pop() ?? field;
  if (last === 'token' || last === 'access_token') return 'auth_token';
  let name = field.replace(/\./g, '_');
  if (last === 'id' && api) {
    const segments = api.path
      .split('/')
      .filter((s) => s && !s.startsWith('{') && s !== 'api' && s !== 'cancel');
    const resource = (segments[segments.length - 1] ?? 'item').replace(/ies$/, 'y').replace(/s$/, '');
    name = field.includes('.') ? `${field.split('.').slice(-2, -1)[0]}_id` : `${resource}_id`;
  }
  if (!taken.has(name) || name === 'auth_token') return name;
  let n = 2;
  while (taken.has(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}
