import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionsRepository, LibraryRepository, TagsRepository, readOrganizeSnapshot, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
let repo: LibraryRepository;
let collections: CollectionsRepository;
let tags: TagsRepository;
beforeEach(() => {
  db = freshDb();
  repo = new LibraryRepository(db);
  collections = new CollectionsRepository(db);
  tags = new TagsRepository(db);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T01:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
});

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const deletedAt = (id: string) => (db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(id) as { deleted_at: string | null }).deleted_at;
const memberships = () => db.prepare('SELECT collection_id, item_id FROM collection_items ORDER BY collection_id, item_id').raw().all();
const tagPairs = () => db.prepare('SELECT tag_id, item_id FROM item_tags ORDER BY tag_id, item_id').raw().all();

/** A group of three items sharing one file, imported a minute apart; and a second group of two. */
function twoGroups() {
  const a1 = seedItem(db);
  at('2026-10-31T01:01:00.000Z');
  const a2 = seedItem(db, { reuseAsset: a1.asset });
  at('2026-10-31T01:02:00.000Z');
  const a3 = seedItem(db, { reuseAsset: a1.asset });
  const b1 = seedItem(db);
  at('2026-10-31T01:03:00.000Z');
  const b2 = seedItem(db, { sha: b1.asset.sha256, mode: 'linked' }); // the same bytes, linked: still a duplicate
  at('2026-10-31T02:00:00.000Z');
  return { a: [a1.itemId, a2.itemId, a3.itemId] as const, b: [b1.itemId, b2.itemId] as const };
}

describe('keepOneOfDuplicates (spec 5)', () => {
  it('keeps the item imported first in each group of the chosen items and trashes the rest under one stamp', () => {
    const { a, b } = twoGroups();
    const result = repo.keepOneOfDuplicates([a[2]]); // a row of group a only
    expect(result).toEqual({ kept: [a[0]], trashed: [a[1], a[2]], undo: { trashed: [a[1], a[2]], stamp: '2026-10-31T02:00:00.000Z', kept: [a[0]], memberships: [], tags: [] } });
    expect([deletedAt(a[1]), deletedAt(a[2])]).toEqual(['2026-10-31T02:00:00.000Z', '2026-10-31T02:00:00.000Z']);
    expect(deletedAt(a[0])).toBeNull();
    expect(b.map(deletedAt)).toEqual([null, null]); // the other group is not touched
    expect(readOrganizeSnapshot(db).duplicates).toEqual([[...b]]);
  });

  it('with equal import times, the smaller id stays', () => {
    const first = seedItem(db);
    const second = seedItem(db, { reuseAsset: first.asset });
    const [low, high] = [first.itemId, second.itemId].sort();
    expect(repo.keepOneOfDuplicates([low!]).kept).toEqual([low]);
    expect(deletedAt(high!)).not.toBeNull();
  });

  it('gives the kept item every collection and tag of the others; what it already had stays as it was', () => {
    const { a } = twoGroups();
    const lecture = collections.create({ name: '강의' }).id;
    const exam = collections.create({ name: '시험' }).id;
    const red = tags.create('중요').id;
    const blue = tags.create('복습').id;
    collections.addItems(lecture, [a[0], a[1]]); // the kept one is already in 강의
    collections.addItems(exam, [a[2]]);
    tags.assign(red, [a[1], a[2]]);
    tags.assign(blue, [a[0]]);
    const before = { m: memberships(), t: tagPairs() };

    const { undo } = repo.keepOneOfDuplicates([a[0]]);
    expect(undo.memberships).toEqual([[exam, a[0]]]);
    expect(undo.tags).toEqual([[red, a[0]]]); // added once, though both others had it
    const detail = repo.getItemDetail(a[0]);
    expect(detail.collections.map((c) => c.id).sort()).toEqual([lecture, exam].sort());
    expect(detail.tags.map((t) => t.id).sort()).toEqual([red, blue].sort());

    expect(repo.undoKeepOne(undo)).toEqual([a[1], a[2]]);
    expect({ m: memberships(), t: tagPairs() }).toEqual(before); // exactly as it was: the others' own pairs were never touched
    expect(a.map(deletedAt)).toEqual([null, null, null]);
  });

  it('every group at once with keepOneOfAllDuplicates, one stamp for all', () => {
    const { a, b } = twoGroups();
    const result = repo.keepOneOfAllDuplicates();
    expect(result.kept.sort()).toEqual([a[0], b[0]].sort());
    expect(result.trashed.sort()).toEqual([a[1], a[2], b[1]].sort());
    expect(new Set(result.trashed.map(deletedAt))).toEqual(new Set([result.undo.stamp]));
    expect(readOrganizeSnapshot(db).duplicates).toEqual([]);
    expect(repo.keepOneOfAllDuplicates()).toMatchObject({ kept: [], trashed: [] });
  });

  it('takes the stamp after the latest one: a move to the trash in the same millisecond is told apart (m-4)', () => {
    const { a } = twoGroups();
    const other = seedItem(db).itemId;
    repo.trash([other]); // 02:00:00.000
    expect(repo.keepOneOfDuplicates([a[0]]).undo.stamp).toBe('2026-10-31T02:00:00.001Z');
    expect(deletedAt(other)).toBe('2026-10-31T02:00:00.000Z');
  });

  it('chosen items that are not in a group, are trashed or unknown do nothing', () => {
    const lone = seedItem(db).itemId;
    const { a } = twoGroups();
    repo.trash([a[1]]);
    const result = repo.keepOneOfDuplicates([lone, a[1], '00000000-0000-4000-8000-000000000000']);
    expect(result).toMatchObject({ kept: [], trashed: [], undo: { trashed: [], memberships: [], tags: [] } });
    expect(deletedAt(lone)).toBeNull();
  });
});

describe('undoKeepOne', () => {
  it('restores only the items still in the trash under its stamp; one restored or trashed again since stays as it is', () => {
    const { a } = twoGroups();
    const { undo } = repo.keepOneOfDuplicates([a[0]]);
    repo.restore([a[1]]);
    at('2026-10-31T03:00:00.000Z');
    repo.trash([a[1]]); // trashed again: a new stamp
    expect(repo.undoKeepOne(undo)).toEqual([a[2]]);
    expect(deletedAt(a[1])).toBe('2026-10-31T03:00:00.000Z');
    expect(deletedAt(a[2])).toBeNull();
  });

  it('when nothing comes back (a second undo, or the others purged since) the kept item keeps what it was given', () => {
    const { a } = twoGroups();
    const exam = collections.create({ name: '시험' }).id;
    collections.addItems(exam, [a[1]]);
    const { undo } = repo.keepOneOfDuplicates([a[0]]);
    expect(repo.undoKeepOne(undo)).toEqual([a[1], a[2]]);
    collections.addItems(exam, [a[0]]); // the user files the kept one by hand afterwards
    expect(repo.undoKeepOne(undo)).toEqual([]);
    expect(memberships()).toEqual([a[0], a[1]].sort().map((id) => [exam, id]));

    const again = repo.keepOneOfDuplicates([a[0]]).undo; // 시험 is already the kept one's: nothing to add
    repo.purge({ itemIds: again.trashed, collectionIds: [] });
    expect(repo.undoKeepOne(again)).toEqual([]);
    expect(memberships()).toEqual([[exam, a[0]]]);
  });

  it('takes a membership or tag pair away only for an item it kept: a pair of another item in a token stays', () => {
    const { a } = twoGroups();
    const exam = collections.create({ name: '시험' }).id;
    const red = tags.create('중요').id;
    collections.addItems(exam, [a[1]]);
    tags.assign(red, [a[1]]);
    const { undo } = repo.keepOneOfDuplicates([a[0]]);
    const bystander = seedItem(db).itemId;
    collections.addItems(exam, [bystander]);
    tags.assign(red, [bystander]);
    const forged = { ...undo, memberships: [...undo.memberships, [exam, bystander] as [string, string]], tags: [...undo.tags, [red, bystander] as [string, string]] };
    expect(repo.undoKeepOne(forged)).toEqual([a[1], a[2]]);
    expect(memberships()).toContainEqual([exam, bystander]);
    expect(tagPairs()).toContainEqual([red, bystander]);
    expect(memberships()).not.toContainEqual([exam, a[0]]); // what it really gave the kept item went
    expect(tagPairs()).not.toContainEqual([red, a[0]]);
  });

  it('is partial when one trashed item is gone: the others come back and the kept item keeps what the merge gave it', () => {
    const { a } = twoGroups();
    const exam = collections.create({ name: '시험' }).id;
    const red = tags.create('중요').id;
    collections.addItems(exam, [a[1]]);
    tags.assign(red, [a[2]]);
    const { undo } = repo.keepOneOfDuplicates([a[0]]);
    repo.purge({ itemIds: [a[1]], collectionIds: [] });
    expect(repo.undoKeepOne(undo)).toEqual([a[2]]);
    expect(deletedAt(a[2])).toBeNull();
    expect(repo.getItemDetail(a[0]).collections.map((c) => c.id)).toEqual([exam]);
    expect(repo.getItemDetail(a[0]).tags.map((t) => t.id)).toEqual([red]);
  });

  it('is partial when one trashed item was restored on its own: the other comes back and the merge stays', () => {
    const { a } = twoGroups();
    const exam = collections.create({ name: '시험' }).id;
    const red = tags.create('중요').id;
    collections.addItems(exam, [a[1]]);
    tags.assign(red, [a[2]]);
    const { undo } = repo.keepOneOfDuplicates([a[0]]);
    repo.restore([a[1]]);
    expect(deletedAt(a[1])).toBeNull();
    expect(repo.undoKeepOne(undo)).toEqual([a[2]]);
    expect(deletedAt(a[2])).toBeNull();
    expect(repo.getItemDetail(a[0]).collections.map((c) => c.id)).toEqual([exam]);
    expect(repo.getItemDetail(a[0]).tags.map((t) => t.id)).toEqual([red]);
  });
});
