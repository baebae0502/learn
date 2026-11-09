import { describe, expect, it } from 'vitest';
import { t } from '../strings';
import { BODY_SETTLE_MS, bodyQueryable, createSettle, emptyNote, indexing, mergeBodyResult, parseSearchScope } from './bodySearch';
import type { SearchResult } from './search';

const meta = (ids: string[], marked: string[] = ids): SearchResult => ({
  ids: new Set(ids),
  titleMatches: new Map(marked.map((id) => [id, { kind: 'substring', start: 0, end: 2 }])),
});

describe('mergeBodyResult', () => {
  it('is the metadata matches and the body matches together; only the metadata matches mark a title', () => {
    const merged = mergeBodyResult(meta(['a', 'b'], ['a']), ['b', 'c', 'd'])!;
    expect([...merged.ids].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...merged.titleMatches.keys()]).toEqual(['a']);
    // A body-only match has no mark of its own (spec 5.8: no sign on a row that only the body matched).
    expect(merged.titleMatches.has('c')).toBe(false);
  });
  it('is null with no query (meta null): there is nothing to filter, whatever the body said', () => {
    expect(mergeBodyResult(null, ['a'])).toBeNull();
    expect(mergeBodyResult(null, undefined)).toBeNull();
  });
  it('hands back the metadata result itself when the body adds nothing, so the rows are not drawn again', () => {
    const m = meta(['a', 'b']);
    expect(mergeBodyResult(m, undefined)).toBe(m);
    expect(mergeBodyResult(m, [])).toBe(m);
    expect(mergeBodyResult(m, ['b', 'a'])).toBe(m);
  });
  it('a metadata result with nothing gains the body matches', () => {
    expect([...mergeBodyResult(meta([]), ['x'])!.ids]).toEqual(['x']);
  });
});

describe('bodyQueryable', () => {
  it('needs a word of two letters or more, counted in code points', () => {
    expect(bodyQueryable('형광')).toBe(true);
    expect(bodyQueryable('형')).toBe(false);
    expect(bodyQueryable('형 광')).toBe(false);
    expect(bodyQueryable('a 형광')).toBe(true);
    expect(bodyQueryable('')).toBe(false);
    expect(bodyQueryable('   ')).toBe(false);
    expect(bodyQueryable('😀')).toBe(false); // one code point, two UTF-16 units
  });
  it('stays within what search:body takes (200 after NFC): a longer query is not sent', () => {
    expect(bodyQueryable('가'.repeat(200))).toBe(true);
    expect(bodyQueryable('가'.repeat(201))).toBe(false);
  });
});

describe('parseSearchScope', () => {
  it('reads the stored scope, and metadata when there is none or it is not one', () => {
    expect(parseSearchScope('fulltext')).toBe('fulltext');
    expect(parseSearchScope('metadata')).toBe('metadata');
    for (const v of [undefined, null, 'body', 3, {}]) expect(parseSearchScope(v)).toBe('metadata');
  });
});

describe('indexing', () => {
  it('is true while fewer PDFs are indexed than there are', () => {
    expect(indexing({ done: 37, total: 120 })).toBe(true);
    expect(indexing({ done: 120, total: 120 })).toBe(false);
    expect(indexing({ done: 0, total: 0 })).toBe(false);
    expect(indexing(undefined)).toBe(false);
  });
});

describe('emptyNote (what no results could not search yet)', () => {
  const going = { done: 37, total: 120 };
  const done = { done: 120, total: 120 };
  it('says nothing in the metadata scope', () => {
    expect(emptyNote({ scope: 'metadata', query: '형', searched: false, progress: going })).toEqual([]);
    expect(emptyNote({ scope: 'metadata', query: '효소 억제제', searched: false, progress: going })).toEqual([]);
  });
  it('a one-letter query: the body is searched by words of two letters or more', () => {
    expect(emptyNote({ scope: 'fulltext', query: '효', searched: false, progress: done })).toEqual([t.library.searchEmptyOneLetter]);
    expect(t.library.searchEmptyOneLetter).toBe('본문은 두 글자 이상인 낱말로 찾습니다.');
  });
  it('while the index is being made, the body search may find more once it is done', () => {
    expect(emptyNote({ scope: 'fulltext', query: '효소 억제제', searched: true, progress: going })).toEqual([t.library.searchEmptyIndexing(37, 120)]);
    expect(t.library.searchEmptyIndexing(37, 120)).toBe('본문 색인이 끝나면 더 찾을 수 있습니다(37 / 120).');
  });
  it('both: a one-letter query is not helped by a finished index, so only the one-letter note', () => {
    expect(emptyNote({ scope: 'fulltext', query: '효', searched: false, progress: going })).toEqual([t.library.searchEmptyOneLetter]);
  });
  it('says nothing when the body was searched and the index is done', () => {
    expect(emptyNote({ scope: 'fulltext', query: '효소 억제제', searched: true, progress: done })).toEqual([]);
    expect(emptyNote({ scope: 'fulltext', query: '효소 억제제', searched: true, progress: undefined })).toEqual([]);
  });
  it('promises nothing about the index when the body was not searched (the search failed)', () => {
    expect(emptyNote({ scope: 'fulltext', query: '효소 억제제', searched: false, progress: going })).toEqual([]);
  });
});

describe('searchEmptyBody', () => {
  it('ends the field list with ·PDF 본문 only when the body was searched', () => {
    expect(t.library.searchEmptyBody('분자생물학', 0, true)).toBe('‘분자생물학’⁠의 제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모⁠·PDF 본문에서 찾았습니다.');
    expect(t.library.searchEmptyBody(null, 0, false)).toBe('제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모에서 찾았습니다.');
    expect(t.library.searchEmptyBody(null, 2, true)).toBe('제목⁠·저자⁠·태그⁠·출판사⁠·원래 이름⁠·초록⁠·메모⁠·PDF 본문에서 찾았습니다. 고른 태그 2개로 거른 결과입니다.');
  });
});

describe('createSettle (the query the body is searched for, one timer for the window)', () => {
  function clock() {
    let now = 0;
    let timers: Array<{ at: number; fn: () => void; id: number }> = [];
    let next = 1;
    return {
      setTimer: (fn: () => void, ms: number) => {
        const id = next++;
        timers.push({ at: now + ms, fn, id });
        return id;
      },
      clearTimer: (id: unknown) => {
        timers = timers.filter((x) => x.id !== id);
      },
      advance(ms: number) {
        now += ms;
        const due = timers.filter((x) => x.at <= now);
        timers = timers.filter((x) => x.at > now);
        for (const x of due) x.fn();
      },
      pending: () => timers.length,
    };
  }

  it('takes a query once it has held for the settle time', () => {
    const c = clock();
    const s = createSettle(c);
    const seen: string[] = [];
    s.subscribe(() => seen.push(s.get()));
    s.ask('형광');
    c.advance(BODY_SETTLE_MS - 1);
    expect(s.get()).toBe('');
    c.advance(1);
    expect(s.get()).toBe('형광');
    expect(seen).toEqual(['형광']);
    expect(BODY_SETTLE_MS).toBe(200);
  });
  it('a new query starts the wait again; the same query asked again (another reader) does not', () => {
    const c = clock();
    const s = createSettle(c);
    s.ask('형');
    c.advance(150);
    s.ask('형광');
    c.advance(150);
    s.ask('형광');
    c.advance(49);
    expect(s.get()).toBe('');
    c.advance(1);
    expect(s.get()).toBe('형광');
    expect(c.pending()).toBe(0);
  });
  it('back to the query already taken: the wait is dropped and nothing is asked again', () => {
    const c = clock();
    const s = createSettle(c);
    s.ask('형광');
    c.advance(BODY_SETTLE_MS);
    let calls = 0;
    s.subscribe(() => (calls += 1));
    s.ask('형광 현');
    s.ask('형광');
    expect(c.pending()).toBe(0);
    c.advance(BODY_SETTLE_MS);
    expect(s.get()).toBe('형광');
    expect(calls).toBe(0);
  });
  it('no query (another scope, an empty field) is taken at once', () => {
    const c = clock();
    const s = createSettle(c);
    s.ask('형광');
    c.advance(BODY_SETTLE_MS);
    s.ask('형광 현');
    s.ask('');
    expect(s.get()).toBe('');
    expect(c.pending()).toBe(0);
  });
  it('a listener that leaves is not called', () => {
    const c = clock();
    const s = createSettle(c);
    let calls = 0;
    const leave = s.subscribe(() => (calls += 1));
    leave();
    s.ask('형광');
    c.advance(BODY_SETTLE_MS);
    expect(calls).toBe(0);
  });
});
