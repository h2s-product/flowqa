import type {
  ApiDefinition,
  E2EFlow,
  FlowRun,
  Folder,
  Environment,
  PerfRun,
  PerfTest,
  Project,
  ProjectApp,
  Run,
  Scenario,
  Schedule,
  UiRun,
  UiSchedule,
} from '@flowqa/shared';
import type { Database } from '../db/database';
import { DocumentRepository } from './document-repository';
import { RunDocumentRepository } from './run-document-repository';
import { SettingsRepository } from './settings-repository';
import { UserRepository } from './user-repository';
import { UiTestRepository } from './ui-test-repository';

const byProject = { project_id: (d: { projectId: string }) => d.projectId };

export class ScenarioStateRepository {
  constructor(private readonly db: Database) {}

  get(scenarioId: string): Record<string, unknown> {
    const row = this.db
      .prepare('SELECT variables FROM scenario_state WHERE scenario_id = ?')
      .get(scenarioId) as { variables: string } | undefined;
    return row ? JSON.parse(row.variables) : {};
  }

  merge(scenarioId: string, variables: Record<string, unknown>): void {
    const next = { ...this.get(scenarioId), ...variables };
    this.db
      .prepare(
        `INSERT INTO scenario_state (scenario_id, variables) VALUES (?, ?)
         ON CONFLICT(scenario_id) DO UPDATE SET variables = excluded.variables`,
      )
      .run(scenarioId, JSON.stringify(next));
  }
}

export function createRepositories(db: Database) {
  const settings = new SettingsRepository(db);
  const uiTests = new UiTestRepository(db, byProject, settings);
  // Test lama yang belum punya Test Case ID (TC-xxxx) diberi ID sekali, urut waktu dibuat.
  uiTests.assignMissingCodes();
  return {
    projects: new DocumentRepository<Project>(db, 'projects'),
    apps: new DocumentRepository<ProjectApp>(db, 'project_apps', byProject),
    environments: new DocumentRepository<Environment>(db, 'environments', byProject),
    apis: new DocumentRepository<ApiDefinition>(db, 'apis', byProject),
    apiFolders: new DocumentRepository<Folder>(db, 'api_folders', byProject),
    scenarios: new DocumentRepository<Scenario>(db, 'scenarios', byProject),
    scenarioFolders: new DocumentRepository<Folder>(db, 'scenario_folders', byProject),
    schedules: new DocumentRepository<Schedule>(db, 'schedules', byProject),
    runs: new RunDocumentRepository<Run>(db, 'runs', 'scenario_id', (r) => r.scenarioId),
    perfTests: new DocumentRepository<PerfTest>(db, 'perf_tests', byProject),
    perfRuns: new RunDocumentRepository<PerfRun>(db, 'perf_runs', 'test_id', (r) => r.testId),
    scenarioState: new ScenarioStateRepository(db),
    users: new UserRepository(db),
    settings,
    uiFolders: new DocumentRepository<Folder>(db, 'ui_folders', byProject),
    uiTests,
    uiRuns: new RunDocumentRepository<UiRun>(db, 'ui_runs', 'test_id', (r) => r.testCaseId),
    uiSchedules: new DocumentRepository<UiSchedule>(db, 'ui_schedules', byProject),
    flows: new DocumentRepository<E2EFlow>(db, 'e2e_flows', byProject),
    flowRuns: new RunDocumentRepository<FlowRun>(db, 'e2e_runs', 'flow_id', (r) => r.flowId),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
