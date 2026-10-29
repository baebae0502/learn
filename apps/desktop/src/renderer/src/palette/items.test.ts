import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { search, searchIndexFor } from '../library/search';
import { t } from '../strings';
import { initialsExample, itemMeta, itemMetaMatch, rankItems } from './items';

const item = (id: string, title: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id, title, type: 'pdf', mime: 'application/pdf', size: 1, storageMode: 'managed', availability: 'available', assetId: 'a', revisionId: 'r',
  originalName: `${title}.pdf`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null,
  publisher: null, progress: null, openedAt: null, ...over,
});
const at = (start: number) => ({ start, end: start + 2, kind: 'word' as const });

describe('palette 자료 results (spec §4.4)', () => {
  it('title matches first, the earlier the higher, then other fields; a tie goes to the last opened, then the newest; five at most', () => {
    const items = [
      item('a', '세포 신호 전달', { createdAt: '2026-10-01T00:00:00.000Z' }),
      item('b', '신호 증폭'),
      item('c', '단백질 접힘', { createdAt: '2026-10-03T00:00:00.000Z' }), // matched by its publisher
      item('d', '전달 신호 모음', { openedAt: '2026-10-20T09:00:00.000Z' }),
      item('e', '강의 · 신호'),
      item('f', '효소 반응', { createdAt: '2026-10-05T00:00:00.000Z' }), // matched by its memo
      item('g', '열역학'),
    ];
    const result = { ids: new Set(['a', 'b', 'c', 'd', 'e', 'f']), titleMatches: new Map([['a', at(3)], ['b', at(0)], ['d', at(3)], ['e', at(5)]]) };
    expect(rankItems(items, result).map((r) => r.item.id)).toEqual(['b', 'd', 'a', 'e', 'f']);
    expect(rankItems(items, result, 10).map((r) => r.item.id)).toEqual(['b', 'd', 'a', 'e', 'f', 'c']);
    expect(rankItems(items, result)[0]!.match).toEqual(at(0));
    expect(rankItems(items, result)[4]!.match).toBeNull(); // no <mark> for a match outside the title
  });

  it('a letter match ranks above a 초성 match even when the 초성 match is earlier in the title (spec 7.2)', () => {
    const items = [item('a', '신호 증폭'), item('b', '노트 ㅅㅎ'), item('c', '열역학')];
    const ranked = rankItems(items, search(searchIndexFor(items), 'ㅅㅎ')!);
    // 노트 ㅅㅎ holds the jamo themselves (a letter match at 3); 신호 증폭 only reads as ㅅㅎ (a 초성 match at 0).
    expect(ranked.map((r) => [r.item.id, r.match?.kind])).toEqual([['b', 'word'], ['a', 'initials']]);
  });

  it('equal in everything else: the id decides, so the rows never swap between renders', () => {
    const items = [item('z', '신호'), item('y', '신호')];
    const result = { ids: new Set(['y', 'z']), titleMatches: new Map([['y', at(0)], ['z', at(0)]]) };
    expect(rankItems(items, result).map((r) => r.item.id)).toEqual(['y', 'z']);
  });

  it('says 저자 · 연도, whichever there are, and the kind when there is neither', () => {
    expect(itemMeta({ creators: ['김하늘', '이도윤'], year: 2024, type: 'pdf' })).toBe('김하늘, 이도윤 · 2024');
    expect(itemMeta({ creators: [], year: 2024, type: 'video' })).toBe('2024');
    expect(itemMeta({ creators: ['박서준'], year: null, type: 'video' })).toBe('박서준');
    expect(itemMeta({ creators: [], year: null, type: 'video' })).toBe('동영상');
    expect(itemMeta({ creators: [], year: null, type: 'pdf' })).toBe('PDF');
  });

  it('marks where the query matched in 저자 · 연도 (a row the author or the year brought in says why); never on the kind', () => {
    const kim = item('k', '세포 신호 전달 개요', { creators: ['김철수'], year: 2024 });
    expect(itemMetaMatch(kim, '김철수')).toEqual({ start: 0, end: 3, kind: 'prefix' });
    expect(itemMetaMatch(kim, 'ㄱㅊㅅ')).toEqual({ start: 0, end: 3, kind: 'initials' });
    expect(itemMetaMatch(kim, '2024')).toEqual({ start: 6, end: 10, kind: 'word' });
    expect(itemMetaMatch(item('j', 'Bayes', { creators: ['Jane Smith'] }), 'smith')).toEqual({ start: 5, end: 10, kind: 'word' });
    expect(itemMetaMatch(kim, '단백질')).toBeNull();
    expect(itemMetaMatch(item('p', 'sample'), 'pdf')).toBeNull();
    expect(itemMetaMatch(kim, '  ')).toBeNull();
  });

  it('takes the 초성 example from the first title (list order) with a word of two to four Hangul syllables', () => {
    expect(initialsExample([{ title: 'Intro to Bayesian Inference' }, { title: '분자생물학 6장 · 신호 전달' }])).toEqual({ initials: 'ㅅㅎ', word: '신호' });
    expect(initialsExample([{ title: '세포 신호 전달 개요' }])).toEqual({ initials: 'ㅅㅍ', word: '세포' });
    expect(initialsExample([{ title: 'sample' }, { title: '가' }, { title: '분자생물학' }])).toBeNull();
  });

  it("ranks the quick search's own answer, from the one index per list the toolbar shares (search.ts searchIndexFor)", () => {
    const items = [item('a', '세포 신호 전달'), item('b', '신호 증폭'), item('g', '열역학')];
    expect(searchIndexFor(items)).toBe(searchIndexFor(items)); // the palette builds no index of its own
    const ranked = rankItems(items, search(searchIndexFor(items), '신호')!);
    expect(ranked.map((r) => [r.item.id, r.match?.start])).toEqual([['b', 0], ['a', 3]]);
    expect(ranked[0]!.match).toMatchObject({ start: 0, end: 2 });
  });

  it('chooses 와 or 과 after the quoted query by its last syllable (josa.ts waGwa, as the quick search does)', () => {
    expect(t.palette.emptyTitle('효소 억제제')).toBe('‘효소 억제제’\u2060와 일치하는 자료·컬렉션·명령이 없습니다');
    expect(t.palette.emptyTitle('신호 전달')).toBe('‘신호 전달’\u2060과 일치하는 자료·컬렉션·명령이 없습니다');
    expect(t.palette.emptyTitle('Bayesian')).toBe('‘Bayesian’\u2060와 일치하는 자료·컬렉션·명령이 없습니다');
    expect(t.palette.emptyTitle('2023')).toBe('‘2023’\u2060과 일치하는 자료·컬렉션·명령이 없습니다'); // 삼: digits read as Korean numbers
    expect(t.palette.searchLibrary('신호')).toBe('라이브러리에서 ‘신호’ 검색');
    expect(t.palette.searchLibraryParts('신호').join('')).toBe(t.palette.searchLibrary('신호'));
    expect(t.palette.resultCount(4, 0, 1)).toBe('자료 4개, 명령 1개');
    expect(t.palette.resultCount(0, 0, 7)).toBe('명령 7개');
    expect(t.palette.resultCount(5, 0, 0)).toBe('자료 5개'); // the search row is not a command
    expect(t.palette.resultCount(2, 1, 3)).toBe('자료 2개, 컬렉션 1개, 명령 3개');
    expect(t.palette.resultCount(0, 2, 0)).toBe('컬렉션 2개');
    expect(t.palette.collectionMeta('분자생물학', 14)).toBe('분자생물학 안 · 14개');
    expect(t.palette.collectionMeta(null, 14)).toBe('14개');
  });

  it("says where the search looked: the fields in 내 라이브러리, the view's name first elsewhere, and the tag filter's count (spec 7.1, 3.6)", () => {
    const fields = '제목\u2060·저자\u2060·태그\u2060·출판사\u2060·원래 이름\u2060·초록\u2060·메모에서 찾았습니다.';
    expect(t.library.searchEmptyBody(null, 0)).toBe(fields);
    expect(t.library.searchEmptyBody('분자생물학', 0)).toBe(`‘분자생물학’\u2060의 ${fields}`);
    expect(t.library.searchEmptyBody('미분류', 2)).toBe(`‘미분류’\u2060의 ${fields} 고른 태그 2개로 거른 결과입니다.`);
    expect(t.library.searchEmptyBody(null, 1)).toMatch(/ 고른 태그 1개로 거른 결과입니다\.$/);
    // a line may end with a dot, never start with one
    for (const body of [t.library.searchEmptyBody('분자생물학', 0), t.library.searchEmptyBody(null, 2)]) expect(body).not.toMatch(/[^\u2060]·/);
    expect(t.library.searchPlaceholder).toBe('제목, 저자, 태그 검색');
  });
});
