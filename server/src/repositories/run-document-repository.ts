import type { Database } from '../db/database';
import { nowIso } from '../lib/time';
import { DocumentRepository } from './document-repository';

type SqlValue = string | number | null;

/** Bentuk minimal dokumen run (API run, performance run, UI run). */
export interface RunDocument {
  id: string;
  projectId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  failureReason?: string;
  steps?: unknown[];
}

/**
 * Repository dasar untuk tabel run. Kolom wajib: project_id, status, started_at,
 * ditambah satu kolom induk (`parentColumn`, mis. scenario_id / test_id).
 */
export class RunDocumentRepository<T extends RunDocument> extends DocumentRepository<T> {
  constructor(
    db: Database,
    table: string,
    private readonly parentColumn: string,
    parentOf: (run: T) => string,
  ) {
    super(db, table, {
      project_id: (r) => r.projectId,
      [parentColumn]: parentOf,
      status: (r) => r.status,
      started_at: (r) => r.startedAt,
    });
  }

  /** Run terbaru; filter opsional per project, induk (scenario/test), dan status. */
  recent(filter: { projectId?: string; parentId?: string; status?: string }, limit = 100): T[] {
    const where: Record<string, SqlValue> = {
      project_id: filter.projectId ?? null,
      [this.parentColumn]: filter.parentId ?? null,
      status: filter.status ?? null,
    };
    return this.list(where, 'started_at DESC', limit);
  }

  /** Run selesai milik project dalam rentang [from, to], terbaru dulu. */
  between(projectId: string, fromIso: string, toIso: string): T[] {
    const rows = this.db
      .prepare(
        `SELECT data FROM ${this.table} WHERE project_id = ? AND started_at >= ? AND started_at <= ?
         AND status != 'running' ORDER BY started_at DESC`,
      )
      .all(projectId, fromIso, toIso) as unknown as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  /** Id run milik project (dipakai untuk membersihkan file sebelum project dihapus). */
  idsForProject(projectId: string): string[] {
    return (
      this.db.prepare(`SELECT id FROM ${this.table} WHERE project_id = ?`).all(projectId) as { id: string }[]
    ).map((r) => r.id);
  }

  /** Hapus run lama supaya database tidak tumbuh tanpa batas. Mengembalikan id yang dihapus. */
  prune(keep: number): string[] {
    const doomed = (
      this.db
        .prepare(
          `SELECT id FROM ${this.table} WHERE id NOT IN (SELECT id FROM ${this.table} ORDER BY started_at DESC LIMIT ?)`,
        )
        .all(keep) as { id: string }[]
    ).map((r) => r.id);
    doomed.forEach((id) => this.delete(id));
    return doomed;
  }

  /**
   * Run yang masih "running" saat server mati diberi status akhir saat start ulang.
   * Step yang belum selesai ditandai "skipped".
   */
  markInterrupted(status: string, reason: string, from: string[] = ['running']): number {
    const stuck = from.flatMap((s) => this.list({ status: s }));
    for (const run of stuck) {
      run.status = status;
      run.failureReason = reason;
      run.finishedAt = nowIso();
      for (const step of (run.steps ?? []) as { status?: string }[])
        if (step.status === 'running' || step.status === 'queued') step.status = 'skipped';
      this.save(run);
    }
    return stuck.length;
  }
}
