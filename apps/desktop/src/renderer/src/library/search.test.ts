import { describe, expect, it } from 'vitest';
import type { LibraryItem, SearchText } from '@learn/domain';
import { matchKorean } from '../palette/hangul';
import { buildSearchIndex, foldText, parseQuery, search, searchCached, searchIndexFor } from './search';

let seq = 0;
const item = (over: Partial<LibraryItem> & { title: string }): LibraryItem => {
  seq += 1;
  const id = `id-${seq}`;
  return {
    id, type: 'pdf', mime: 'application/pdf', size: 1, storageMode: 'managed', availability: 'available', assetId: `a-${id}`, revisionId: `r-${id}`,
    originalName: `${id}.pdf`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null,
    publisher: null, progress: null, openedAt: null, ...over,
  };
};

const SIGNAL = item({ title: '세포 신호 전달 개요', creators: ['김철수'], year: 2024, publisher: '분자생물학회', originalName: 'cell-signal.pdf' });
const FOLD = item({ title: '단백질 접힘 강의 노트', creators: ['이영희', 'Lee'], year: 2023, publisher: 'Learn Press', originalName: '한글 경로 (테스트) #1.pdf' });
const BAYES = item({ title: 'Intro to Bayesian Inference', creators: ['Jane Smith'], year: 2021, originalName: 'sample-h264-aac.mp4' });
const PHOTO = item({ title: '광합성 명반응', originalName: 'photo.mp4' });
const JOINED = item({ title: '세포신호전달', originalName: 'joined.pdf' });
const PRACTICE = item({ title: '가져오기 연습', originalName: 'practice.pdf' });
const ITEMS = [SIGNAL, FOLD, BAYES, PHOTO, JOINED, PRACTICE];
const TEXTS: SearchText[] = [{ id: SIGNAL.id, abstract: '수용체가 신호를 증폭하는 과정을 다룹니다.', extra: '시험 범위' }];
const index = buildSearchIndex(ITEMS, TEXTS);
/** The titles a query finds, in list order; null for an empty query (no filtering). */
const found = (q: string, i = index, items = ITEMS) => {
  const r = search(i, q);
  return r === null ? null : items.filter((x) => r.ids.has(x.id)).map((x) => x.title);
};
const mark = (q: string, it: LibraryItem, i = index) => search(i, q)?.titleMatches.get(it.id) ?? null;

describe('quick search: folding and words (spec 4.2)', () => {
  it('folds NFC, lower case, whitespace and control runs to one space, trimmed', () => {
    expect(foldText('  Signal 전달\n\t노트  ')).toBe('signal 전달 노트');
    expect(foldText('신호'.normalize('NFD'))).toBe('신호');
  });
  it('splits the query into distinct words; a last syllable that may still be composing also reads split', () => {
    expect(parseQuery('ㅅㅎ 신ㅎ 갖 Bayes 신호 신호')).toEqual([
      { text: 'ㅅㅎ', readings: ['ㅅㅎ'] },
      { text: '신ㅎ', readings: ['신ㅎ'] },
      { text: '갖', readings: ['갖', '가ㅈ'] }, // on the way to 가져
      { text: 'bayes', readings: ['bayes'] },
      { text: '신호', readings: ['신호'] },
    ]);
    expect(parseQuery('  \u3000 ')).toEqual([]);
  });
  it('an empty query filters nothing', () => {
    expect(search(index, '')).toBeNull();
    expect(search(index, '   ')).toBeNull();
  });
});

describe('quick search: matching (spec 4.2)', () => {
  it('is NFC-normalised on both sides', () => {
    expect(found('신호'.normalize('NFD'))).toEqual(['세포 신호 전달 개요', '세포신호전달']);
    const nfd = item({ title: '세포 신호'.normalize('NFD') });
    const i = buildSearchIndex([nfd]);
    expect(found('신호', i, [nfd])).toEqual(['세포 신호'.normalize('NFD')]);
    expect(mark('신호', nfd, i)).toEqual({ start: 3, end: 5, kind: 'word' }); // NFC code points, as highlight() slices
  });
  it('ignores case', () => {
    expect(found('BAYES')).toEqual(['Intro to Bayesian Inference']);
    expect(mark('BAYES', BAYES)).toEqual({ start: 9, end: 14, kind: 'word' });
  });
  it('finds 초성 in the short fields only (not in abstracts or memos)', () => {
    expect(found('ㅅㅎ')).toEqual(['세포 신호 전달 개요', '세포신호전달']);
    expect(mark('ㅅㅎ', SIGNAL)).toEqual({ start: 3, end: 5, kind: 'initials' });
    expect(found('ㄱㅊㅅ')).toEqual(['세포 신호 전달 개요']); // 김철수, a creator
    expect(found('ㅈㅍ')).toEqual([]); // 증폭 is in the abstract
    expect(found('증폭')).toEqual(['세포 신호 전달 개요']);
  });
  it('finds two-letter Korean words inside longer ones (no trigram limit)', () => {
    expect(found('신호')).toEqual(['세포 신호 전달 개요', '세포신호전달']);
    expect(mark('신호', JOINED)).toEqual({ start: 2, end: 4, kind: 'substring' });
    expect(found('포신')).toEqual(['세포신호전달']); // never across the space of 세포 신호
  });
  it('needs every word in some field (AND): title, creators, publisher, original file name, year, abstract, memo', () => {
    expect(found('신호 김철')).toEqual(['세포 신호 전달 개요']);
    expect(found('신호 이영희')).toEqual([]);
    expect(found('노트 learn press')).toEqual(['단백질 접힘 강의 노트']);
    expect(found('2024')).toEqual(['세포 신호 전달 개요']);
    expect(found('#1')).toEqual(['단백질 접힘 강의 노트']);
    expect(found('h264')).toEqual(['Intro to Bayesian Inference']);
    expect(found('시험 개요')).toEqual(['세포 신호 전달 개요']); // memo + title
    expect(found('효소 억제제')).toEqual([]);
  });
  it('a last syllable still being composed matches as syllable + 초성 (갖 → 가져), and each IME stage of 신호 keeps it', () => {
    expect(found('갖')).toEqual(['가져오기 연습']);
    expect(mark('갖', PRACTICE)).toEqual({ start: 0, end: 2, kind: 'initials' });
    expect(found('신ㅎ')).toEqual(['세포 신호 전달 개요', '세포신호전달']);
    expect(mark('신ㅎ', SIGNAL)).toEqual({ start: 3, end: 5, kind: 'initials' });
    for (const stage of ['ㅅ', '신', '신ㅎ', '신호']) expect(found(stage), stage).toContain('세포 신호 전달 개요');
  });
  it('reads abstracts and memos once they arrive; until then the short fields alone', () => {
    const shortOnly = buildSearchIndex(ITEMS);
    expect(found('증폭', shortOnly)).toEqual([]);
    expect(found('신호', shortOnly)).toEqual(['세포 신호 전달 개요', '세포신호전달']);
  });
});

describe('quick search: the title highlight (spec 4.2)', () => {
  it('marks the first query word that is in the title, by the palette’s match kinds; none when only another field matched', () => {
    expect(mark('세포', SIGNAL)).toEqual({ start: 0, end: 2, kind: 'prefix' });
    expect(mark('김철 신호', SIGNAL)).toEqual({ start: 3, end: 5, kind: 'word' });
    expect(mark('전달 신호', SIGNAL)).toEqual({ start: 6, end: 8, kind: 'word' });
    expect(mark('김철', SIGNAL)).toBeNull();
    expect(mark('증폭', SIGNAL)).toBeNull();
    const exact = item({ title: '신호' });
    expect(mark('신호', exact, buildSearchIndex([exact]))).toEqual({ start: 0, end: 2, kind: 'exact' });
  });
  it('reads a word in a title exactly as the palette’s matchKorean does (one rule: same place, same kind)', () => {
    const titles = ['세포 신호 전달 개요', '가져오기 연습', '파일 가져오기…', 'Intro to Bayesian Inference', '세포신호전달', 'ㅋㅋ 신호', '사이드바 보기/숨기기'];
    const words = ['신호', 'ㅅㅎ', '신ㅎ', '갖', '가ㅈ', 'ㄱㅈ', 'bayes', '전달', '포신', 'ㅋㅋ', 'ㅅㅇㄷㅂ', '보기', '신', '져오'];
    for (const title of titles) {
      const it = item({ title });
      const i = buildSearchIndex([it]);
      for (const w of words) expect(mark(w, it, i), `${w} in ${title}`).toEqual(matchKorean(w, title));
    }
  });
  it('gives offsets into the title as it is shown (repeated spaces, characters outside the BMP)', () => {
    const spaced = item({ title: '세포  신호' });
    const emoji = item({ title: '📘 신호 노트' });
    const i = buildSearchIndex([spaced, emoji]);
    expect(mark('신호', spaced, i)).toEqual({ start: 4, end: 6, kind: 'word' });
    expect(mark('신호', emoji, i)).toEqual({ start: 2, end: 4, kind: 'word' });
  });
});

describe('quick search: shared work', () => {
  it('builds one index per list array (and once more for the long texts) and answers a repeated query from memory', () => {
    const a = searchIndexFor(ITEMS);
    expect(searchIndexFor(ITEMS)).toBe(a);
    const b = searchIndexFor(ITEMS, TEXTS);
    expect(b).not.toBe(a);
    expect(b.short).toBe(a.short); // the short part is kept
    expect(searchIndexFor(ITEMS, TEXTS)).toBe(b);
    expect(searchIndexFor([...ITEMS])).not.toBe(a); // a list read again is a new array
    expect(searchCached(b, '신호')).toBe(searchCached(b, '신호'));
  });
});

/** A 10,000-item library: Korean and English titles, 1–4 creators, publishers, years; 30 % with an abstract. */
function library(n: number): { items: LibraryItem[]; texts: SearchText[] } {
  let s = 42;
  const rand = () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const KO = ['세포', '신호', '전달', '단백질', '접힘', '효소', '반응', '속도론', '열역학', '광합성', '명반응', '암반응', '유전자', '발현', '조절', '강의', '노트', '요약', '정리', '실험'];
  const EN = ['Linear', 'Algebra', 'Bayesian', 'Inference', 'Signal', 'Protein', 'Kinetics', 'Notes', 'Lecture', 'Review'];
  const NAMES = ['김철수', '이영희', '박민수', '최지우', 'Jane Smith', 'John Doe', 'Lee', 'Kim'];
  const PUBLISHERS = ['분자생물학회', 'Learn Press', 'MIT Press', '대한화학회', null];
  const items: LibraryItem[] = [];
  const texts: SearchText[] = [];
  for (let k = 0; k < n; k++) {
    const words = Array.from({ length: 3 + Math.floor(rand() * 4) }, () => (rand() < 0.7 ? pick(KO) : pick(EN)));
    const it = item({
      title: words.join(' '),
      creators: Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(NAMES)),
      year: 1990 + Math.floor(rand() * 36),
      publisher: pick(PUBLISHERS),
      originalName: `${words[0]}-${k}.pdf`,
    });
    items.push(it);
    if (rand() < 0.3) texts.push({ id: it.id, abstract: Array.from({ length: 150 }, () => pick(KO)).join(' '), extra: rand() < 0.5 ? '시험 범위' : null });
  }
  return { items, texts };
}

describe('quick search at 10,000 items (spec 9: input → paint p95 ≤ 50 ms; this is the search part of it)', () => {
  it('builds its index in well under a second and answers typing-like queries far inside the budget', () => {
    const { items, texts } = library(10_000);
    const t0 = performance.now();
    const big = buildSearchIndex(items, texts);
    const buildMs = performance.now() - t0;
    // The keystrokes of 신호 전달 through an IME, 초성, Latin letters, a year, words of the long fields, AND.
    const queries = ['ㅅ', '시', '신', '신ㅎ', '신호', '신호 ', '신호 ㅈ', '신호 저', '신호 전', '신호 전ㄷ', '신호 전달', 'ㅅㅎ', 'ㅅㅎㅈㄷ', 'b', 'ba', 'bay', 'baye', 'bayes', '2024', '증폭', '시험', '김철수 효소', 'press 2001', 'ㄱ', '갖'];
    const times: number[] = [];
    for (let round = 0; round < 4; round++) {
      for (const q of queries) {
        const t = performance.now();
        search(big, q);
        times.push(performance.now() - t);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    expect(buildMs).toBeLessThan(2_000); // generous for CI; a few hundred ms locally at most
    expect(p95).toBeLessThan(40); // generous for CI; single-digit ms locally
  });
});
