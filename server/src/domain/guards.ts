/**
 * Validasi relasi antar-entitas yang dipakai banyak route & service.
 * Selalu 400 dengan pesan yang sama, supaya perilaku API konsisten.
 */
import type { Environment, Scenario } from '@flowqa/shared';
import { HttpError } from '../lib/http';
import type { Repositories } from '../repositories';

/** Environment harus ada dan milik project ini. */
export function assertProjectEnvironment(
  repos: Repositories,
  projectId: string,
  environmentId: unknown,
): Environment {
  const env = typeof environmentId === 'string' ? repos.environments.get(environmentId) : undefined;
  if (!env || env.projectId !== projectId) throw new HttpError(400, 'Unknown environment for this project');
  return env;
}

/** Scenario harus ada dan milik project ini. */
export function assertProjectScenario(repos: Repositories, projectId: string, scenarioId: unknown): Scenario {
  const scenario = typeof scenarioId === 'string' ? repos.scenarios.get(scenarioId) : undefined;
  if (!scenario || scenario.projectId !== projectId)
    throw new HttpError(400, 'Unknown scenario for this project');
  return scenario;
}

/** URL awal UI test: http(s) absolut, atau diawali {{VARIABEL}}. */
export function assertStartUrl(value: string): string {
  if (!/^(https?:\/\/|\{\{)/i.test(value))
    throw new HttpError(400, 'Start URL must begin with http:// or https:// (or a {{VARIABLE}})');
  return value;
}
