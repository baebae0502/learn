import { TRANSLATION_CACHE_MAX } from '@learn/domain';
import type { Db } from './connection';

export interface CachedTranslation {
  key: string;
  engine: string;
  from: string;
  to: string;
  detected: string | null;
  result: string;
  createdAt: string;
  usedAt: string;
}

interface CacheRow {
  key: string; engine: string; from_lang: string; to_lang: string; detected_lang: string | null; result: string; created_at: string; used_at: string;
}

/** Translations already paid for (translation_cache): kept per library, the 2,000 used most recently. */
export class TranslationCacheRepository {
  constructor(private readonly db: Db) {}

  /** The cached translation, marked as used at `now` so the one a reader keeps coming back to is the last to go. */
  get(key: string, now: string): CachedTranslation | undefined {
    const row = this.db.prepare('SELECT * FROM translation_cache WHERE key = ?').get(key) as CacheRow | undefined;
    if (!row) return undefined;
    this.db.prepare('UPDATE translation_cache SET used_at = ? WHERE key = ?').run(now, key);
    return {
      key: row.key, engine: row.engine, from: row.from_lang, to: row.to_lang, detected: row.detected_lang, result: row.result,
      createdAt: row.created_at, usedAt: now,
    };
  }

  put(entry: CachedTranslation): void {
    this.db.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO translation_cache (key, engine, from_lang, to_lang, detected_lang, result, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(entry.key, entry.engine, entry.from, entry.to, entry.detected, entry.result, entry.createdAt, entry.usedAt);
      this.db
        .prepare('DELETE FROM translation_cache WHERE key IN (SELECT key FROM translation_cache ORDER BY used_at DESC, rowid DESC LIMIT -1 OFFSET ?)')
        .run(TRANSLATION_CACHE_MAX);
    })();
  }
}
