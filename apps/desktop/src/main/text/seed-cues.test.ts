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

  it('gives the first videos a second track written after every first one: its cues come after the other videos\'', () => {
    const db = openDatabase(':memory:');
    migrate(db, { dbFile: null });
    const { itemIds } = seedCues({ db, repo: new LibraryRepository(db), layout: { root: '/none' } }, { videos: 3, cuesEach: 40, lateTracks: 2 });
    const subs = new SubtitlesRepository(db);
    expect(itemIds.map((id) => subs.list(id).map((t) => [t.language, t.position, t.cueCount]))).toEqual([
      [['ko', 0, 40], ['en', 1, 40]],
      [['ko', 0, 40], ['en', 1, 40]],
      [['ko', 0, 40]],
    ]);
    const ids = (itemId: string, position: number) =>
      db.prepare('SELECT MIN(c.id) AS lo, MAX(c.id) AS hi FROM subtitle_tracks t JOIN assets a ON a.id = t.asset_id JOIN cue_texts c ON c.sha256 = a.sha256 WHERE t.item_id = ? AND t.position = ?').get(itemId, position) as { lo: number; hi: number };
    expect(ids(itemIds[0]!, 1).lo).toBeGreaterThan(ids(itemIds[2]!, 0).hi);
    expect(() => seedCues({ db, repo: new LibraryRepository(db), layout: { root: '/none' } }, { videos: 1, cuesEach: 1, lateTracks: 2 })).toThrow();
    db.close();
  });
});
