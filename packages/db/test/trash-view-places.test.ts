import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollectionsRepository, LibraryRepository, TagsRepository, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
let repo: LibraryRepository;
beforeEach(() => {
  db = freshDb();
  repo = new LibraryRepository(db);
});
afterEach(() => db.close());

describe('the trash view carries its items\' places and tags (Task 6, Q-6a: the read-only panel and the tag selector)', () => {
  it('members: live collection → trashed items directly in it; tagged: tag → trashed items; live items are in neither', () => {
    const a = seedItem(db, { title: 'A' }).itemId;
    const b = seedItem(db, { title: 'B' }).itemId;
    const live = seedItem(db, { title: 'live' }).itemId;
    const cols = new CollectionsRepository(db);
    const bio = cols.create({ name: '분자생물학' });
    const gone = cols.create({ name: '옛것' });
    cols.addItems(bio.id, [a, live]);
    cols.addItems(gone.id, [b]);
    const tags = new TagsRepository(db);
    const exam = tags.create('시험 범위');
    const finals = tags.create('기말');
    tags.assign(exam.id, [a, b, live]);
    tags.assign(finals.id, [live]);
    repo.trash([a, b]);
    cols.softDelete(gone.id);

    const view = repo.trashView();
    // 옛것 is in the trash itself: B's place there shows again when it is restored.
    expect(view.members).toEqual({ [bio.id]: [a] });
    expect(Object.keys(view.tagged)).toEqual([exam.id]);
    expect([...view.tagged[exam.id]!].sort()).toEqual([a, b].sort());
  });

  it('an empty trash has empty maps', () => {
    seedItem(db, { title: 'live' });
    expect(repo.trashView()).toEqual({ collections: [], items: [], members: {}, tagged: {} });
  });

  it('library.detail reads a trashed item too (the read-only panel, Q-6b); editing it is still refused', () => {
    const { itemId } = seedItem(db, { title: '휴지통 자료' });
    repo.trash([itemId]);
    const detail = repo.getItemDetail(itemId);
    expect(detail.item).toMatchObject({ id: itemId, title: '휴지통 자료' });
    expect(detail.file.sha256).toHaveLength(64);
    expect(() => repo.updateMetadata(itemId, { title: '바꿈' })).toThrow();
  });
});
