import { beforeEach, describe, expect, it } from 'vitest';
import { TRANSLATION_CACHE_MAX } from '@learn/domain';
import { TranslationCacheRepository, type CachedTranslation, type Db } from '../src/index';
import { freshDb } from './fixtures';

let db: Db;
let repo: TranslationCacheRepository;
beforeEach(() => {
  db = freshDb();
  repo = new TranslationCacheRepository(db);
});

const entry = (key: string, usedAt: string, over: Partial<CachedTranslation> = {}): CachedTranslation => ({
  key, engine: 'google-web', from: 'auto', to: 'ko', detected: 'en', result: `r-${key}`, createdAt: usedAt, usedAt, ...over,
});
const count = () => (db.prepare('SELECT COUNT(*) AS n FROM translation_cache').get() as { n: number }).n;

describe('TranslationCacheRepository', () => {
  it('returns nothing for an unknown key, and what was put for a known one', () => {
    expect(repo.get('a', '2026-11-03T00:00:00.000Z')).toBeUndefined();
    repo.put(entry('a', '2026-11-03T00:00:00.000Z', { detected: null }));
    expect(repo.get('a', '2026-11-03T00:00:01.000Z')).toMatchObject({ key: 'a', engine: 'google-web', from: 'auto', to: 'ko', detected: null, result: 'r-a' });
  });
  it('get marks the row as used now', () => {
    repo.put(entry('a', '2026-11-03T00:00:00.000Z'));
    const hit = repo.get('a', '2026-11-04T00:00:00.000Z');
    expect(hit?.usedAt).toBe('2026-11-04T00:00:00.000Z');
    expect(hit?.createdAt).toBe('2026-11-03T00:00:00.000Z');
    expect((db.prepare('SELECT used_at FROM translation_cache WHERE key = ?').get('a') as { used_at: string }).used_at).toBe('2026-11-04T00:00:00.000Z');
  });
  it('put replaces a row with the same key', () => {
    repo.put(entry('a', '2026-11-03T00:00:00.000Z'));
    repo.put(entry('a', '2026-11-03T00:00:05.000Z', { result: 'new' }));
    expect(count()).toBe(1);
    expect(repo.get('a', '2026-11-03T00:00:06.000Z')?.result).toBe('new');
  });
  it('keeps the newest-used 2,000 rows', () => {
    const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    db.transaction(() => {
      for (let i = 0; i < TRANSLATION_CACHE_MAX; i++) repo.put(entry(`k${i}`, at(i)));
    })();
    expect(count()).toBe(TRANSLATION_CACHE_MAX);
    repo.get('k0', at(5000)); // the oldest is used again: the next oldest goes
    repo.put(entry('new', at(6000)));
    expect(count()).toBe(TRANSLATION_CACHE_MAX);
    expect(repo.get('k0', at(7000))).toBeDefined();
    expect(repo.get('k1', at(7000))).toBeUndefined();
    expect(repo.get('new', at(7000))).toBeDefined();
  });
});
