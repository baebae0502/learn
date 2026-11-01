import { describe, expect, it } from 'vitest';
import { TRASH_TARGET, type CommandTargetInfo, type OrganizeSnapshot, type TrashView, type TrashedCollection } from '@learn/domain';
import { item } from '../organize/testing';
import { collectionMatch, splitTrashSelection, trashCollectionRows, trashModelFor, trashSelectionCount, withTrashTargets } from './trashRows';

const col = (id: string, name: string, deletedAt: string): TrashedCollection => ({ id, name, parentId: null, deletedAt, childCount: 0, itemCount: 1 });
const ROWS = [col('c1', '학회 준비', '2026-10-31T00:05:00.000Z'), col('c2', '통계', '2026-10-30T00:05:00.000Z'), col('c3', '세포 신호', '2026-10-31T00:09:00.000Z')];
const ids = (rows: readonly TrashedCollection[]) => rows.map((c) => c.id);
const plain = { query: '', tagFiltered: false };
const LIVE: CommandTargetInfo = { kind: 'item', storageMode: 'managed', availability: 'available' };
const VIEW: TrashView = { items: [{ ...item('t1'), deletedAt: '2026-10-31T00:01:00.000Z' }], collections: [ROWS[0]!], members: {}, tagged: {} };

describe('the trash view\'s collection rows (spec 4.3)', () => {
  it('newest first by default and under the columns they have no value in; by name or by date when that column sorts', () => {
    expect(ids(trashCollectionRows(ROWS, { ...plain, sort: { column: 'deletedAt', direction: 'desc' } }))).toEqual(['c3', 'c1', 'c2']);
    expect(ids(trashCollectionRows(ROWS, { ...plain, sort: { column: 'deletedAt', direction: 'asc' } }))).toEqual(['c2', 'c1', 'c3']);
    expect(ids(trashCollectionRows(ROWS, { ...plain, sort: { column: 'title', direction: 'asc' } }))).toEqual(['c3', 'c2', 'c1']); // 세포 · 통계 · 학회
    expect(ids(trashCollectionRows(ROWS, { ...plain, sort: { column: 'title', direction: 'desc' } }))).toEqual(['c1', 'c2', 'c3']);
    expect(ids(trashCollectionRows(ROWS, { ...plain, sort: { column: 'year', direction: 'asc' } }))).toEqual(['c3', 'c1', 'c2']);
    expect(trashCollectionRows(ROWS, { ...plain, sort: { column: 'title', direction: 'asc' } })).not.toBe(ROWS);
  });
  it('the quick search keeps the rows whose name has every word (초성 too, as the palette reads it); a tag filter keeps none', () => {
    const sort = { column: 'deletedAt', direction: 'desc' } as const;
    expect(ids(trashCollectionRows(ROWS, { sort, query: 'ㅎㅎ', tagFiltered: false }))).toEqual(['c1']);
    expect(ids(trashCollectionRows(ROWS, { sort, query: '세포  신호', tagFiltered: false }))).toEqual(['c3']);
    expect(ids(trashCollectionRows(ROWS, { sort, query: '신호 통계', tagFiltered: false }))).toEqual([]);
    expect(trashCollectionRows(ROWS, { sort, query: '', tagFiltered: true })).toEqual([]);
    expect(collectionMatch('학회 준비', '학회')).toMatchObject({ start: 0, end: 2 });
    expect(collectionMatch('학회 준비', '  ')).toBeNull();
  });
});

describe('trash rows as command targets and selection (P-10)', () => {
  const live = (target: { itemIds?: readonly string[] }) => (target.itemIds ?? []).map(() => LIVE);
  it('an id the trash holds is a trash row; the others are judged as they are elsewhere', () => {
    expect(withTrashTargets(VIEW, { itemIds: ['t1', 'x'], collectionIds: ['c1'] }, live)).toEqual([LIVE, TRASH_TARGET, TRASH_TARGET]);
    expect(withTrashTargets(undefined, { itemIds: ['t1'] }, live)).toEqual([LIVE]);
  });
  it('splits a selection into the trash\'s items and collections, leaving out what it does not hold', () => {
    const selected = new Set(['c1', 't1', 'gone']);
    expect(splitTrashSelection(VIEW, selected)).toEqual({ itemIds: ['t1'], collectionIds: ['c1'] });
    expect(trashSelectionCount(VIEW, selected)).toBe(2);
    expect(splitTrashSelection(undefined, selected)).toEqual({ itemIds: [], collectionIds: [] });
    expect(trashSelectionCount(undefined, selected)).toBe(0);
  });
});

describe('the organize model over the trash (Q-6a)', () => {
  it('has the trashed items\' tags and live places, the live tree and tags, and the count; one model per snapshot and view', () => {
    const snapshot: OrganizeSnapshot = {
      collections: [{ id: 'bio', name: '분자생물학', parentId: null, createdAt: '2026-10-01T00:00:00.000Z' }],
      tags: [{ id: 'g', name: '기말', color: null, position: null }],
      members: { bio: ['live'] }, tagged: { g: ['live'] }, duplicates: [], trashCount: 2,
    };
    const view: TrashView = { ...VIEW, members: { bio: ['t1'] }, tagged: { g: ['t1'] } };
    const model = trashModelFor(snapshot, view);
    expect(model.tagsOfItem('t1').map((x) => x.id)).toEqual(['g']);
    expect(model.directCollectionsOf('t1')).toEqual(['bio']);
    expect(model.tagItems('g')).toEqual(new Set(['t1']));
    expect(model.node('bio')?.name).toBe('분자생물학');
    expect(model.trashCount).toBe(2);
    expect(trashModelFor(snapshot, view)).toBe(model);
  });
});
