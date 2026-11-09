import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bodyQueryWords, MARK_END, MARK_START } from '@learn/domain';
import { LIKE_CHUNK_SQL, LibraryRepository, PAGES_COUNT_SQL, PAGES_SQL, PAGE_WALK_MAX, bodyItemIds, bodyLikeChunks, bodyPages, pagesPlan, type Db } from '../src/index';
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

describe('bodyLikeChunks plan', () => {
  it('scans page_texts by its id range first and reaches the items through the sha', () => {
    const a = seedItem(db);
    put(a.asset.sha256, 0, '형광');
    expect([...bodyLikeChunks(db, ['형광'])].flat()).toEqual([a.itemId]); // positive control: the query answers
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${LIKE_CHUNK_SQL(1)}`).all(0, 10, '%형광%') as Array<{ detail: string }>).map((r) => r.detail);
    expect(plan[0]).toMatch(/SEARCH p USING INTEGER PRIMARY KEY \(rowid>\? AND rowid<=?\?\)/);
    expect(plan.join('\n')).toMatch(/SEARCH a USING (COVERING )?INDEX assets_sha256/);
  });
});

describe('bodyPages plan', () => {
  it('walks a short file\'s own pages by their key and asks the index for each by rowid, for the rows and for the count', () => {
    const a = seedItem(db);
    put(a.asset.sha256, 0, '형광 현미경');
    expect(bodyPages(db, a.asset.sha256, bodyQueryWords('현미경')).total).toBe(1); // positive control: the query answers
    for (const sql of [PAGES_SQL(0, 'pages'), PAGES_COUNT_SQL(0, 'pages')]) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(a.asset.sha256, '"현미경"') as Array<{ detail: string }>).map((r) => r.detail);
      expect(plan[0], plan.join('\n')).toMatch(/SEARCH p USING (COVERING )?INDEX sqlite_autoindex_page_texts_1 \(sha256=\?\)/);
      expect(plan.join('\n')).toMatch(/SCAN f VIRTUAL TABLE INDEX/);
      expect(plan.join('\n')).not.toMatch(/SCAN p\b/);
    }
  });

  it('counts past the pages it shows', () => {
    const a = seedItem(db);
    const b = seedItem(db);
    for (let i = 0; i < 25; i++) put(a.asset.sha256, i, `형광 현미경 ${i}`);
    for (let i = 0; i < 5; i++) put(b.asset.sha256, i, `형광 현미경 ${i}`);
    const r = bodyPages(db, a.asset.sha256, bodyQueryWords('현미경'));
    expect(r.pages).toHaveLength(20);
    expect(r.total).toBe(25);
    expect(bodyPages(db, b.asset.sha256, bodyQueryWords('현미경')).total).toBe(5);
  });

  it('walks a file of up to 64 pages page by page and reads a longer one from the index', () => {
    const short = seedItem(db);
    const long = seedItem(db);
    for (let i = 0; i < PAGE_WALK_MAX; i++) put(short.asset.sha256, i, `현미경 ${i}`);
    for (let i = 0; i <= PAGE_WALK_MAX; i++) put(long.asset.sha256, i, `현미경 ${i}`);
    expect(PAGE_WALK_MAX).toBe(64);
    expect(pagesPlan(db, short.asset.sha256)).toBe('pages');
    expect(pagesPlan(db, long.asset.sha256)).toBe('index');
    // bodyPages itself takes that plan: the statements it prepares are the plan's.
    const prepared = vi.spyOn(db, 'prepare');
    expect(bodyPages(db, long.asset.sha256, bodyQueryWords('현미경')).total).toBe(PAGE_WALK_MAX + 1);
    const sqls = prepared.mock.calls.map(([sql]) => sql);
    expect(sqls).toContain(PAGES_SQL(0, 'index'));
    expect(sqls).toContain(PAGES_COUNT_SQL(0, 'index'));
    expect(sqls).not.toContain(PAGES_SQL(0, 'pages'));
    prepared.mockClear();
    expect(bodyPages(db, short.asset.sha256, bodyQueryWords('현미경')).total).toBe(PAGE_WALK_MAX);
    expect(prepared.mock.calls.map(([sql]) => sql)).toContain(PAGES_SQL(0, 'pages')); // positive control: the short file keeps its walk
    prepared.mockRestore();
  });

  describe('on a file of 70 pages, both plans give the same pages and total', () => {
    // Another file holds every word on every page: the index-driven plan must keep this file's pages only.
    const seedLong = () => {
      const other = seedItem(db);
      for (let i = 0; i < 30; i++) put(other.asset.sha256, i, `현미경 형광 fluorescence ${i}`);
      const a = seedItem(db);
      for (let i = 0; i < 70; i++) put(a.asset.sha256, i, `쪽 ${i} 현미경 관찰${i % 3 === 0 ? ' 형광' : ''}${i === 69 ? ' fluorescence' : ''}`);
      expect(pagesPlan(db, a.asset.sha256)).toBe('index');
      return a.asset.sha256;
    };
    const both = (sha: string, query: string) => {
      const byPages = bodyPages(db, sha, bodyQueryWords(query), 'pages');
      const byIndex = bodyPages(db, sha, bodyQueryWords(query), 'index');
      expect(byIndex).toEqual(byPages);
      expect(bodyPages(db, sha, bodyQueryWords(query))).toEqual(byIndex);
      return byIndex;
    };

    it('a word on every page', () => {
      const r = both(seedLong(), '현미경');
      expect(r.total).toBe(70);
      expect(r.pages.map((p) => p.pageIndex)).toEqual([...Array(20).keys()]);
      expect(r.pages[5]!.snippet).toContain(`${MARK_START}현미경${MARK_END}`);
    });

    it('a word on the last page only', () => {
      const r = both(seedLong(), 'fluorescence');
      expect(r).toEqual({ pages: [{ pageIndex: 69, snippet: expect.stringContaining(`${MARK_START}fluorescence${MARK_END}`) }], total: 1 });
    });

    it('no match', () => {
      expect(both(seedLong(), 'xylophone')).toEqual({ pages: [], total: 0 });
    });

    it('a two-letter word with a three-letter one', () => {
      const r = both(seedLong(), '현미경 형광');
      expect(r.total).toBe(24);
      expect(r.pages.map((p) => p.pageIndex)).toEqual(Array.from({ length: 20 }, (_, k) => k * 3));
    });
  });

  it('reads the long file\'s matches from the index first and reaches each page by its rowid, for the rows and for the count', () => {
    const a = seedItem(db);
    put(a.asset.sha256, 0, '형광 현미경');
    expect(bodyPages(db, a.asset.sha256, bodyQueryWords('현미경'), 'index').total).toBe(1); // positive control: the query answers
    const args = [a.asset.sha256, '"현미경"'];
    for (const [sql, likes] of [[PAGES_SQL(0, 'index'), []], [PAGES_COUNT_SQL(0, 'index'), []], [PAGES_SQL(1, 'index'), ['%형광%']]] as const) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args, ...likes) as Array<{ detail: string }>).map((r) => r.detail);
      expect(plan[0], plan.join('\n')).toMatch(/SCAN f VIRTUAL TABLE INDEX/);
      expect(plan.join('\n')).toMatch(/SEARCH p USING INTEGER PRIMARY KEY \(rowid=\?\)/);
      expect(plan.join('\n')).not.toMatch(/sqlite_autoindex_page_texts_1/);
    }
  });
});
