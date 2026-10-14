import type { Database } from '../db/database';
import { nowIso } from '../lib/time';

/** Pengaturan aplikasi (satu nilai JSON per key), mis. "email". */
export class SettingsRepository {
  constructor(private readonly db: Database) {}

  get<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  set<T>(key: string, value: T): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), nowIso());
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }
}
