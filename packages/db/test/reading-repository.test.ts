import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@learn/domain';
import { ReadingRepository, type Db } from '../src/index';
import { expectLearnError, freshDb, seedItem } from './fixtures';

let db: Db;
let repo: ReadingRepository;
beforeEach(() => {
  db = freshDb();
  repo = new ReadingRepository(db);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ReadingRepository', () => {
  it('upserts a position: first save sets openedAt, later saves keep it and bump updatedAt', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { itemId, revisionId } = seedItem(db);
    expect(repo.get(itemId)).toBeUndefined();

    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const first = repo.save({ itemId, revisionId, locator: { kind: 'pdf', pageIndex: 3, scale: 1.25 }, progress: 0.1 });
    expect(first).toEqual({
      itemId, revisionId, locator: { kind: 'pdf', pageIndex: 3, scale: 1.25 }, progress: 0.1,
      openedAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    });

    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    repo.save({ itemId, revisionId, locator: { kind: 'pdf', pageIndex: 7 }, progress: null });
    expect(repo.get(itemId)).toEqual({
      itemId, revisionId, locator: { kind: 'pdf', pageIndex: 7 }, progress: null,
      openedAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T02:00:00.000Z',
    });
    expect((db.prepare('SELECT COUNT(*) AS n FROM reading_positions').get() as { n: number }).n).toBe(1);
  });

  it('markOpened refreshes openedAt only, and is a no-op before the first save', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { itemId, revisionId } = seedItem(db, { type: 'video' });
    expect(repo.markOpened(itemId)).toBe(false);
    expect(repo.get(itemId)).toBeUndefined();

    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    repo.save({ itemId, revisionId, locator: { kind: 'video', timeMs: 61_000 }, progress: 0.5 });
    vi.setSystemTime(new Date('2026-10-21T09:30:00.000Z'));
    expect(repo.markOpened(itemId)).toBe(true);
    expect(repo.get(itemId)).toMatchObject({
      locator: { kind: 'video', timeMs: 61_000 }, progress: 0.5,
      openedAt: '2026-10-21T09:30:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    });
  });

  it('rejects invalid locators and strips unknown locator fields', () => {
    const { itemId, revisionId } = seedItem(db);
    for (const locator of [
      { kind: 'epub', cfi: 'x' },
      { kind: 'pdf', pageIndex: -1 },
      { kind: 'pdf', pageIndex: 1.5 },
      { kind: 'pdf' },
      { kind: 'video', timeMs: -5 },
      null,
    ]) {
      expectLearnError(() => repo.save({ itemId, revisionId, locator: locator as never, progress: 0 }), 'VALIDATION_FAILED', '읽기 위치가 올바르지 않습니다.');
    }
    expect(repo.get(itemId)).toBeUndefined();
    repo.save({ itemId, revisionId, locator: { kind: 'pdf', pageIndex: 0, extra: 'x' } as never, progress: 0 });
    expect(repo.get(itemId)!.locator).toEqual({ kind: 'pdf', pageIndex: 0 });
  });

  it('accepts progress in [0, 1] or null and rejects anything else', () => {
    const { itemId, revisionId } = seedItem(db);
    const locator = { kind: 'pdf', pageIndex: 0 } as const;
    for (const progress of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectLearnError(() => repo.save({ itemId, revisionId, locator, progress }), 'VALIDATION_FAILED', '진행률');
    }
    for (const progress of [0, 1, null]) {
      expect(repo.save({ itemId, revisionId, locator, progress }).progress).toBe(progress);
    }
  });

  it('requires an existing item and a revision of that item', () => {
    const { itemId, revisionId } = seedItem(db);
    const other = seedItem(db);
    const locator = { kind: 'pdf', pageIndex: 0 } as const;
    expectLearnError(() => repo.save({ itemId: newId(), revisionId, locator, progress: 0 }), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    expectLearnError(() => repo.save({ itemId, revisionId: other.revisionId, locator, progress: 0 }), 'NOT_FOUND', '원본 버전');
    expectLearnError(() => repo.markOpened(newId()), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    expect(repo.get(newId())).toBeUndefined();
  });

  it('is removed with its item (cascade)', () => {
    const { itemId, revisionId } = seedItem(db);
    repo.save({ itemId, revisionId, locator: { kind: 'pdf', pageIndex: 2 }, progress: 0.2 });
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    expect(repo.get(itemId)).toBeUndefined();
    expect((db.prepare('SELECT COUNT(*) AS n FROM reading_positions').get() as { n: number }).n).toBe(0);
  });

  it('treats a corrupt stored locator as no position', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { itemId, revisionId } = seedItem(db);
    db.prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, updated_at) VALUES (?, ?, '{"kind":"pdf"}', 0.5, 'now')`)
      .run(itemId, revisionId);
    expect(repo.get(itemId)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('READING_LOCATOR_INVALID');
    warn.mockRestore();
  });
});
