import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LearnError, MARK_START, newId, nowIso } from '@learn/domain';
import { LibraryRepository, migrate, openDatabase, type AssetRow, type Db } from '@learn/db';
import { searchBody, searchPages } from './search';

let db: Db;
let repo: LibraryRepository;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, { dbFile: null });
  repo = new LibraryRepository(db);
});
afterEach(() => db.close());

let seq = 0;
function item(type: 'pdf' | 'video' = 'pdf'): { itemId: string; sha: string } {
  seq += 1;
  const sha = seq.toString(16).padStart(64, '0');
  const now = nowIso();
  const asset: AssetRow = {
    id: newId(), sha256: sha, storageMode: 'managed', relativePath: `assets/${sha.slice(0, 2)}/${sha}`, externalPath: null,
    originalName: 'a.pdf', mime: type === 'pdf' ? 'application/pdf' : 'video/mp4', size: 10, availability: 'available', createdAt: now, checkedAt: now,
  };
  const itemId = newId();
  repo.insertImported({ item: { id: itemId, type, title: `item ${seq}`, createdAt: now }, asset, assetIsNew: true, revision: { id: newId(), createdAt: now }, job: null });
  return { itemId, sha };
}
const put = (sha: string, page: number, text: string) =>
  db.prepare('INSERT INTO page_texts (sha256, page_index, text) VALUES (?, ?, ?)').run(sha, page, text.normalize('NFC'));
const live = () => new AbortController().signal;

describe('searchBody', () => {
  it('a one-letter query has no body words: nothing is searched', async () => {
    const a = item();
    put(a.sha, 0, '형광 현미경');
    expect(await searchBody(db, '형', live())).toEqual({ itemIds: [], searched: false });
    expect(await searchBody(db, '  ', live())).toEqual({ itemIds: [], searched: false });
    expect(await searchBody(db, '형광', live())).toEqual({ itemIds: [a.itemId], searched: true }); // positive control
  });

  it('three letters use the index, two letters the scan, and a mix needs both on one page', async () => {
    const a = item();
    const b = item();
    put(a.sha, 0, '형광 현미경 관찰');
    put(b.sha, 0, 'signal transduction 형광');
    put(b.sha, 1, '세포 기록');
    expect((await searchBody(db, '현미경', live())).itemIds).toEqual([a.itemId]);
    expect((await searchBody(db, '형광', live())).itemIds.sort()).toEqual([a.itemId, b.itemId].sort());
    expect((await searchBody(db, 'transduction 형광', live())).itemIds).toEqual([b.itemId]);
    expect((await searchBody(db, 'transduction 세포', live())).itemIds).toEqual([]); // two pages of one file are not one page
    expect((await searchBody(db, 'xylophone', live())).searched).toBe(true);
  });

  it('a scan in several chunks gives what one chunk gives', async () => {
    for (let i = 0; i < 6; i++) put(item().sha, 0, i % 2 === 0 ? `형광 ${i}` : `세포 ${i}`);
    const whole = await searchBody(db, '형광', live());
    expect(whole.itemIds).toHaveLength(3);
    expect(await searchBody(db, '형광', live(), 2)).toEqual(whole);
  });

  it('a scan stopped after its first chunk reads no second one and answers CANCELLED', async () => {
    for (let i = 0; i < 6; i++) put(item().sha, 0, `형광 ${i}`);
    const ctl = new AbortController();
    let reads = 0;
    const real = db.prepare.bind(db);
    const spy = {
      prepare: (sql: string) => {
        const stmt = real(sql);
        if (!sql.includes('p.id > ?')) return stmt;
        return {
          pluck: () => ({
            all: (...args: unknown[]) => {
              reads += 1;
              const rows = (stmt.pluck() as unknown as { all: (...a: unknown[]) => unknown }).all(...args);
              if (reads === 1) ctl.abort();
              return rows;
            },
          }),
        };
      },
    };
    const proxy = new Proxy(db, { get: (t, k) => (k === 'prepare' ? spy.prepare : Reflect.get(t, k) as unknown) });
    const err = await searchBody(proxy, '형광', ctl.signal, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LearnError);
    expect((err as LearnError).code).toBe('CANCELLED');
    expect(reads).toBe(1);
    // positive control: the same scan, not stopped, reads every chunk.
    reads = 0;
    expect((await searchBody(proxy, '형광', new AbortController().signal, 2)).itemIds).toHaveLength(6);
    expect(reads).toBeGreaterThan(1);
  });

  it('an indexed query stopped before it starts answers CANCELLED', async () => {
    put(item().sha, 0, 'transduction');
    const ctl = new AbortController();
    ctl.abort();
    const statements: string[] = [];
    const real = db.prepare.bind(db);
    const proxy = new Proxy(db, { get: (t, k) => (k === 'prepare' ? (sql: string) => (statements.push(sql), real(sql)) : (Reflect.get(t, k) as unknown)) });
    // positive control: the same query, not stopped, prepares its statement
    expect((await searchBody(proxy, 'transduction', live())).itemIds).toHaveLength(1);
    expect(statements.length).toBeGreaterThan(0);
    statements.length = 0;
    await expect(searchBody(proxy, 'transduction', ctl.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(statements, 'a stopped query does not start its statement').toEqual([]);
  });
});

describe('searchPages', () => {
  it('gives the pages in order with marked snippets and the total; a video and a trashed item give none', () => {
    const a = item();
    put(a.sha, 4, 'later 형광 page');
    put(a.sha, 1, 'earlier 형광 page');
    put(a.sha, 2, 'nothing here');
    const r = searchPages(db, a.itemId, '형광');
    expect(r.total).toBe(2);
    expect(r.pages.map((p) => p.pageIndex)).toEqual([1, 4]);
    expect(r.pages[0]!.snippet).toContain(MARK_START);
    expect(searchPages(db, a.itemId, 'earlier').pages.map((p) => p.pageIndex)).toEqual([1]);
    expect(searchPages(db, a.itemId, '형')).toEqual({ pages: [], total: 0 });

    const v = item('video');
    put(v.sha, 0, '형광');
    expect(searchPages(db, v.itemId, '형광')).toEqual({ pages: [], total: 0 });

    repo.trash([a.itemId]);
    expect(searchPages(db, a.itemId, '형광')).toEqual({ pages: [], total: 0 });
  });

  it('an item that does not exist is NOT_FOUND', () => {
    expect(() => searchPages(db, newId(), '형광')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});
