import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionsRepository, LibraryRepository, nextDeletionStamp, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

const T = '2026-10-31T01:00:00.000Z';
let db: Db;
beforeEach(() => {
  db = freshDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(T));
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
});
const stamp = (table: 'items' | 'collections', id: string) =>
  (db.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id) as { deleted_at: string | null }).deleted_at;

describe('nextDeletionStamp (m-4: a library\'s deletion stamps only go up)', () => {
  it('is the current time while nothing was deleted at or after it', () => {
    expect(nextDeletionStamp(db)).toBe(T);
    const { itemId } = seedItem(db);
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-31T00:59:59.999Z', itemId);
    expect(nextDeletionStamp(db)).toBe(T);
  });

  it('is 1 ms after the latest stamp, of items or of collections, that the clock has not passed', () => {
    const { itemId } = seedItem(db);
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run(T, itemId);
    expect(nextDeletionStamp(db)).toBe('2026-10-31T01:00:00.001Z');
    const c = new CollectionsRepository(db).create({ name: '나중' });
    // A stamp ahead of the clock (the clock was set back since): the next one still comes after it.
    db.prepare('UPDATE collections SET deleted_at = ? WHERE id = ?').run('2026-10-31T01:00:05.000Z', c.id);
    expect(nextDeletionStamp(db)).toBe('2026-10-31T01:00:05.001Z');
  });

  it('counts only stamps still in the table: a restore clears its stamp', () => {
    const repo = new LibraryRepository(db);
    const a = seedItem(db).itemId;
    repo.trash([a]);
    repo.restore([a]);
    expect(nextDeletionStamp(db)).toBe(T);
  });
});

describe('the moves to the trash take it', () => {
  it('two moves of items in one millisecond get two stamps; the items of one move share one', () => {
    const repo = new LibraryRepository(db);
    const [a, b, c] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    expect(repo.trashChanged([a, b])).toEqual([a, b]);
    expect(repo.trashChanged([c])).toEqual([c]);
    expect([stamp('items', a), stamp('items', b), stamp('items', c)]).toEqual([T, T, '2026-10-31T01:00:00.001Z']);
  });

  it('an item and a collection deleted in one millisecond do not share a stamp', () => {
    const repo = new LibraryRepository(db);
    const collections = new CollectionsRepository(db);
    const a = seedItem(db).itemId;
    const c = collections.create({ name: '강의' }).id;
    repo.trash([a]);
    collections.softDelete(c);
    expect([stamp('items', a), stamp('collections', c)]).toEqual([T, '2026-10-31T01:00:00.001Z']);
  });
});
