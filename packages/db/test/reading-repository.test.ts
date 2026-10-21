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

  it('markOpened creates the row of a never-opened item: default locator, latest revision, no progress', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const pdf = seedItem(db);
    const video = seedItem(db, { type: 'video' });
    // A later revision of the PDF's asset is the one a new row points at.
    const later = newId();
    db.prepare(`INSERT INTO source_revisions (id, asset_id, hash, created_at) VALUES (?, ?, ?, '2026-10-20T02:00:00.000Z')`)
      .run(later, pdf.asset.id, pdf.asset.sha256);

    vi.setSystemTime(new Date('2026-10-21T09:30:00.000Z'));
    repo.markOpened(pdf.itemId);
    repo.markOpened(video.itemId);
    expect(repo.get(pdf.itemId)).toEqual({
      itemId: pdf.itemId, revisionId: later, locator: { kind: 'pdf', pageIndex: 0 }, progress: null,
      openedAt: '2026-10-21T09:30:00.000Z', updatedAt: '2026-10-21T09:30:00.000Z',
    });
    expect(repo.get(video.itemId)).toEqual({
      itemId: video.itemId, revisionId: video.revisionId, locator: { kind: 'video', timeMs: 0 }, progress: null,
      openedAt: '2026-10-21T09:30:00.000Z', updatedAt: '2026-10-21T09:30:00.000Z',
    });
  });

  it('markOpened on an existing row refreshes openedAt only (locator, progress, revision and updatedAt stay)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { itemId, revisionId } = seedItem(db, { type: 'video' });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    repo.save({ itemId, revisionId, locator: { kind: 'video', timeMs: 61_000 }, progress: 0.5 });
    vi.setSystemTime(new Date('2026-10-21T09:30:00.000Z'));
    repo.markOpened(itemId);
    expect(repo.get(itemId)).toEqual({
      itemId, revisionId, locator: { kind: 'video', timeMs: 61_000 }, progress: 0.5,
      openedAt: '2026-10-21T09:30:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    });
    // A later save keeps that openedAt.
    vi.setSystemTime(new Date('2026-10-21T10:00:00.000Z'));
    repo.save({ itemId, revisionId, locator: { kind: 'video', timeMs: 62_000 }, progress: 0.51 });
    expect(repo.get(itemId)).toMatchObject({ openedAt: '2026-10-21T09:30:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM reading_positions').get() as { n: number }).n).toBe(1);
  });

  it('markOpened refuses a type without a reading locator (nothing is written)', () => {
    const { itemId } = seedItem(db);
    db.prepare(`UPDATE items SET type = 'epub' WHERE id = ?`).run(itemId);
    expectLearnError(() => repo.markOpened(itemId), 'VALIDATION_FAILED', '읽기 위치');
    expect(repo.get(itemId)).toBeUndefined();
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
