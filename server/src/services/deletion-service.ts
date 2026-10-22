/**
 * Menghapus entitas beserta data turunannya yang tidak ditangani cascade SQL
 * (jadwal yang menunjuk entitas itu, dan file screenshot UI run di disk),
 * serta menghapus riwayat test run.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Environment, Scenario } from '@flowqa/shared';
import { config } from '../config';
import { HttpError } from '../lib/http';
import type { Repositories } from '../repositories';

/** Jenis run yang bisa dihapus: API run (scenario) atau UI run. */
export type RunKind = 'api' | 'ui';

/** Batas jumlah run per permintaan hapus massal. */
export const MAX_RUNS_PER_DELETE = 500;

export interface RunDeletionResult {
  deleted: number;
  /** Run yang dilewati karena masih berjalan. */
  running: number;
}

export class DeletionService {
  constructor(
    private readonly repos: Repositories,
    /** Pengaturan di luar tabel project (mis. koneksi Firebase app-nya) ikut dibuang. */
    private readonly onProjectDeleted?: (projectId: string, appIds: string[]) => void,
  ) {}

  /** Hapus project; tabel turunan ikut terhapus (ON DELETE CASCADE), file screenshot dibersihkan di sini. */
  deleteProject(projectId: string): boolean {
    const uiRunIds = this.repos.uiRuns.idsForProject(projectId);
    const appIds = this.repos.apps.list({ project_id: projectId }).map((a) => a.id);
    if (!this.repos.projects.delete(projectId)) return false;
    uiRunIds.forEach((id) => this.removeUiArtifacts(id));
    this.onProjectDeleted?.(projectId, appIds);
    return true;
  }

  /** Hapus scenario beserta jadwal yang menjalankannya. */
  deleteScenario(scenario: Scenario): void {
    this.repos.scenarios.delete(scenario.id);
    this.deleteSchedules(scenario.projectId, (s) => s.scenarioId === scenario.id);
  }

  /** Hapus environment (minimal harus tersisa satu) beserta jadwal yang memakainya. */
  deleteEnvironment(environment: Environment): void {
    if (this.repos.environments.count({ project_id: environment.projectId }) <= 1)
      throw new HttpError(400, 'A project needs at least one environment');
    this.repos.environments.delete(environment.id);
    this.deleteSchedules(environment.projectId, (s) => s.environmentId === environment.id);
  }

  /**
   * Hapus run milik project. Run yang masih berjalan dilewati (dihitung di
   * `running`); id milik project lain / tidak dikenal diabaikan.
   */
  deleteRuns(kind: RunKind, projectId: string, ids: string[]): RunDeletionResult {
    const repo = kind === 'ui' ? this.repos.uiRuns : this.repos.runs;
    const result: RunDeletionResult = { deleted: 0, running: 0 };
    for (const id of new Set(ids)) {
      const run = repo.get(id);
      if (!run || run.projectId !== projectId) continue;
      if (run.status === 'running') {
        result.running++;
        continue;
      }
      repo.delete(id);
      if (kind === 'ui') this.removeUiArtifacts(id);
      result.deleted++;
    }
    return result;
  }

  private removeUiArtifacts(runId: string) {
    fs.rmSync(path.join(config.uiArtifactsDir, runId), { recursive: true, force: true });
  }

  private deleteSchedules(
    projectId: string,
    match: (s: { scenarioId: string; environmentId: string }) => boolean,
  ) {
    this.repos.schedules
      .list({ project_id: projectId })
      .filter(match)
      .forEach((s) => this.repos.schedules.delete(s.id));
  }
}
