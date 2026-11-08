import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bodyQueryWords, MARK_END, MARK_START } from '@learn/domain';
import { LibraryRepository, bodyItemIds, bodyLikeChunks, bodyPages, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
beforeEach(() => { db = freshDb(); });
afterEach(() => db.close());

const put = (sha: string, page: number, text: string) =>
  db.prepare('INSERT INTO page_texts (sha256, page_index, text) VALUES (?, ?, ?)').run(sha, page, text.normalize('NFC'));
const find = (query: string): string[] => {
  const words = bodyQueryWords(query);
  const ids = words.fts.length > 0 ? bodyItemIds(db, words) : [...bodyLikeChunks(db, words.like)].flat();
  return [...new Set(ids)];
};

describe('body queries', () => {
  it('finds by a two-letter scan and by a trigram phrase', () => {
    const a = seedItem(db);
    put(a.asset.sha256, 0, '오늘 형광 현미경으로 본다');
    expect(find('형광')).toEqual([a.itemId]);
    expect(find('현미경')).toEqual([a.itemId]);
    expect(find('없는말')).toEqual([]);
    expect(find('형광'.normalize('NFD'))).toEqual([a.itemId]);
  });

  it('ignores case and diacritics in the index', () => {
    const a = seedItem(db);
    const b = seedItem(db);
    const c = seedItem(db);
    put(a.asset.sha256, 0, 'Signal TRANSDUCTION pathway');
    put(b.asset.sha256, 0, 'Un Café ouvert');
    put(c.asset.sha256, 0, "À l'ÉCOLE");
    expect(find('trans')).toEqual([a.itemId]);
    expect(find('cafe')).toEqual([b.itemId]);
    expect(find('école')).toEqual([c.itemId]);
  });

  it('wants every word on one page', () => {
    const split = seedItem(db);
    const same = seedItem(db);
    put(split.asset.sha256, 0, '형광 표지');
    put(split.asset.sha256, 1, 'transduction 기전');
    put(same.asset.sha256, 3, '형광 그리고 transduction');
    expect(find('형광 transduction')).toEqual([same.itemId]);
    expect(find('transduction')).toEqual([split.itemId, same.itemId]); // positive control: the split one is indexed
  });

  it('leaves trashed items out and drops everything at a purge', () => {
    const a = seedItem(db);
    put(a.asset.sha256, 0, '현미경 형광');
    expect(find('현미경')).toEqual([a.itemId]); // positive control
    expect(find('형광')).toEqual([a.itemId]);
    const repo = new LibraryRepository(db);
    repo.trash([a.itemId]);
    expect(find('현미경')).toEqual([]);
    expect(find('형광')).toEqual([]);
    repo.purge({ itemIds: [a.itemId], collectionIds: [] });
    expect(db.prepare('SELECT count(*) FROM page_texts').pluck().get()).toBe(0);
    expect(db.prepare(`SELECT count(*) FROM page_texts_fts WHERE page_texts_fts MATCH '"현미경"'`).pluck().get()).toBe(0);
  });
});

describe('bodyPages', () => {
  it('lists up to twenty matching pages in order with marked snippets, and the total', () => {
    const a = seedItem(db);
    for (let p = 0; p < 30; p++) put(a.asset.sha256, p, `쪽 ${p} 현미경 관찰 기록 형광 신호`);
    const fts = bodyPages(db, a.asset.sha256, bodyQueryWords('현미경'));
    expect(fts.total).toBe(30);
    expect(fts.pages).toHaveLength(20);
    expect(fts.pages.map((p) => p.pageIndex)).toEqual([...Array(20).keys()]);
    expect(fts.pages[0]!.snippet).toContain(`${MARK_START}현미경${MARK_END}`);
    const like = bodyPages(db, a.asset.sha256, bodyQueryWords('형광'));
    expect(like.total).toBe(30);
    expect(like.pages[3]).toEqual({ pageIndex: 3, snippet: `쪽 3 현미경 관찰 기록 ${MARK_START}형광${MARK_END} 신호` });
    expect(bodyPages(db, a.asset.sha256, bodyQueryWords('없는말'))).toEqual({ pages: [], total: 0 });
  });
});

describe('bodyLikeChunks', () => {
  it('yields one result per id range and their union is the whole answer', () => {
    const a = seedItem(db);
    const b = seedItem(db);
    for (let p = 0; p < 5; p++) put(a.asset.sha256, p, '형광');
    for (let p = 0; p < 2; p++) put(b.asset.sha256, p, '형광');
    const chunks = [...bodyLikeChunks(db, ['형광'], 2)];
    expect(chunks).toHaveLength(Math.ceil(7 / 2));
    expect(new Set(chunks.flat())).toEqual(new Set([a.itemId, b.itemId]));
    expect(new Set(chunks.flat())).toEqual(new Set([...bodyLikeChunks(db, ['형광'])].flat()));
  });
});
