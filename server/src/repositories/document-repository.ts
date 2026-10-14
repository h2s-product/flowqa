import type { Database } from '../db/database';

interface Row {
  data: string;
}

type SqlValue = string | number | null;

/**
 * Repository generik untuk tabel berbentuk dokumen JSON.
 * `extraColumns` memetakan kolom tambahan (mis. project_id, status) dari dokumen.
 */
export class DocumentRepository<T extends { id: string; createdAt: string; updatedAt: string }> {
  constructor(
    protected readonly db: Database,
    protected readonly table: string,
    private readonly extraColumns: Record<string, (doc: T) => SqlValue> = {},
  ) {}

  get(id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${this.table} WHERE id = ?`).get(id) as Row | undefined;
    return row ? (JSON.parse(row.data) as T) : undefined;
  }

  list(where: Record<string, SqlValue> = {}, orderBy = 'created_at ASC', limit?: number): T[] {
    const { clause, params } = buildWhere(where);
    const sql = `SELECT data FROM ${this.table} ${clause} ORDER BY ${orderBy}${limit ? ` LIMIT ${Number(limit)}` : ''}`;
    const rows = this.db.prepare(sql).all(...params) as unknown as Row[];
    return rows.map((r) => JSON.parse(r.data) as T);
  }

  count(where: Record<string, SqlValue> = {}): number {
    const { clause, params } = buildWhere(where);
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${this.table} ${clause}`).get(...params) as {
      n: number;
    };
    return row.n;
  }

  /** Insert atau update (upsert) dokumen utuh. */
  save(doc: T): T {
    const columns = ['id', 'data', 'created_at', 'updated_at', ...Object.keys(this.extraColumns)];
    const values: SqlValue[] = [
      doc.id,
      JSON.stringify(doc),
      doc.createdAt,
      doc.updatedAt,
      ...Object.values(this.extraColumns).map((fn) => fn(doc)),
    ];
    const updates = columns
      .filter((c) => c !== 'id' && c !== 'created_at')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ');
    this.db
      .prepare(
        `INSERT INTO ${this.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
         ON CONFLICT(id) DO UPDATE SET ${updates}`,
      )
      .run(...values);
    return doc;
  }

  delete(id: string): boolean {
    return Number(this.db.prepare(`DELETE FROM ${this.table} WHERE id = ?`).run(id).changes) > 0;
  }
}

function buildWhere(where: Record<string, SqlValue>) {
  const keys = Object.keys(where).filter((k) => where[k] !== undefined && where[k] !== null);
  return {
    clause: keys.length ? `WHERE ${keys.map((k) => `${k} = ?`).join(' AND ')}` : '',
    params: keys.map((k) => where[k]),
  };
}
