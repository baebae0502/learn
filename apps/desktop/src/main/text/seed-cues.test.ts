import { describe, expect, it } from 'vitest';
import { LibraryRepository, SubtitlesRepository, cueMatches, migrate, openDatabase } from '@learn/db';
import { bodyQueryWords } from '@learn/domain';
import { seedCues } from './seed-cues';

describe('seedCues', () => {
  it('makes live video items with one track and the cues each, found by cue search', () => {
    const db = openDatabase(':memory:');
    migrate(db, { dbFile: null });
    const { itemIds } = seedCues({ db, repo: new LibraryRepository(db), layout: { root: '/none' } }, { videos: 3, cuesEach: 40 });
    expect(itemIds).toHaveLength(3);
    const subs = new SubtitlesRepository(db);
    expect(subs.list(itemIds[0]!).map((t) => t.cueCount)).toEqual([40]);
    expect(db.prepare(`SELECT COUNT(*) FROM items WHERE type = 'video' AND deleted_at IS NULL`).pluck().get()).toBe(3);
    expect(cueMatches(db, itemIds[0]!, bodyQueryWords('signal')).total).toBeGreaterThan(0);
    expect(() => seedCues({ db, repo: new LibraryRepository(db), layout: { root: '/none' } }, { videos: -1, cuesEach: 1 })).toThrow();
    db.close();
  });
});
