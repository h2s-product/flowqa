import type { UiTestCase } from '@flowqa/shared';
import type { Database } from '../db/database';
import { DocumentRepository } from './document-repository';
import type { SettingsRepository } from './settings-repository';

const PREFIX = 'TC-';
/** Nomor terakhir yang pernah dipakai (nomor test yang dihapus tidak dipakai ulang). */
const SEQUENCE_KEY = 'uiTestCodeSequence';

/** "TC-0001" … "TC-9999", lalu "TC-10000" dst. */
export const formatTestCode = (n: number) => `${PREFIX}${String(n).padStart(4, '0')}`;

/**
 * UI test case dengan Test Case ID (TC-xxxx). ID diberikan di sini, saat test
 * pertama kali disimpan, sehingga semua jalur pembuatan (rekam, Mobile Inspector,
 * duplikat, import, editor) otomatis mendapatkannya tanpa perlu diubah. ID yang
 * sudah ada tidak pernah berubah.
 */
export class UiTestRepository extends DocumentRepository<UiTestCase> {
  constructor(
    db: Database,
    extraColumns: ConstructorParameters<typeof DocumentRepository<UiTestCase>>[2],
    private readonly settings: SettingsRepository,
  ) {
    super(db, 'ui_tests', extraColumns);
  }

  override save(doc: UiTestCase): UiTestCase {
    // Edit yang tidak membawa code (mis. dokumen dibangun ulang) tetap memakai code lamanya.
    const code = doc.code ?? this.get(doc.id)?.code;
    const valid = code && !this.takenByOther(code, doc.id);
    return super.save(valid && code === doc.code ? doc : { ...doc, code: valid ? code : this.nextCode() });
  }

  /** Beri ID ke test lama yang belum punya, urut sesuai waktu dibuat. Mengembalikan jumlahnya. */
  assignMissingCodes(): number {
    const rows = this.db
      .prepare(
        `SELECT id FROM ${this.table} WHERE json_extract(data, '$.code') IS NULL ORDER BY created_at ASC, id ASC`,
      )
      .all() as { id: string }[];
    for (const { id } of rows) this.save(this.get(id)!);
    return rows.length;
  }

  findByCode(code: string): UiTestCase | undefined {
    const row = this.db
      .prepare(`SELECT id FROM ${this.table} WHERE json_extract(data, '$.code') = ? LIMIT 1`)
      .get(code.trim().toUpperCase()) as { id: string } | undefined;
    return row ? this.get(row.id) : undefined;
  }

  private takenByOther(code: string, id: string): boolean {
    return !!this.db
      .prepare(`SELECT 1 FROM ${this.table} WHERE json_extract(data, '$.code') = ? AND id != ? LIMIT 1`)
      .get(code, id);
  }

  private nextCode(): string {
    const highest = this.db
      .prepare(
        `SELECT MAX(CAST(substr(json_extract(data, '$.code'), ${PREFIX.length + 1}) AS INTEGER)) AS n FROM ${this.table}`,
      )
      .get() as { n: number | null };
    const next = Math.max(this.settings.get<number>(SEQUENCE_KEY) ?? 0, highest.n ?? 0) + 1;
    this.settings.set(SEQUENCE_KEY, next);
    return formatTestCode(next);
  }
}
