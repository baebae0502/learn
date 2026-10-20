import { LearnError, SETTINGS, isSettingKey, parseSetting, type SettingKey } from '@learn/domain';
import type { Db } from './connection';

function assertKnownKey(key: string): asserts key is SettingKey {
  if (!isSettingKey(key)) throw new LearnError('VALIDATION_FAILED', '알 수 없는 설정 항목입니다.');
}

/** Library-scoped settings (the `settings` table), validated against the `SETTINGS` registry and stored as JSON. */
export class SettingsRepository {
  constructor(private readonly db: Db) {}

  /** `undefined` when the key was never set, or when the stored value is corrupt / no longer matches the schema. */
  get(key: string): unknown {
    assertKnownKey(key);
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(row.value);
    } catch {
      console.warn('SETTING_CORRUPT_JSON');
      return undefined;
    }
    const r = SETTINGS[key].safeParse(raw);
    if (!r.success) {
      console.warn('SETTING_INVALID');
      return undefined;
    }
    return r.data;
  }

  set(key: string, value: unknown): void {
    const parsed = parseSetting(key, value);
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(parsed));
  }

  keys(): string[] {
    return (this.db.prepare('SELECT key FROM settings ORDER BY key').all() as { key: string }[]).map((r) => r.key);
  }
}
