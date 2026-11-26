import { describe, expect, it } from 'vitest';
import type { Cue } from '@learn/domain';
import { findInCues, foldForSearch } from './transcriptSearch';

const cue = (text: string, i = 0): Cue => ({ startMs: i * 1000, endMs: i * 1000 + 800, text });

describe('foldForSearch (spec 7.4)', () => {
  it('takes Latin diacritics off and lower-cases, with each folded unit mapped to the text it came from', () => {
    const f = foldForSearch('Café 앞');
    expect(f.folded).toBe('cafe 앞');
    expect(f.map).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('keeps Hangul as it is, composed: a decomposed syllable meets the composed one', () => {
    expect(foldForSearch('칼슘').folded).toBe('칼슘');
    expect(foldForSearch('아').folded).toBe('아');
    expect(foldForSearch('한글'.normalize('NFD')).folded).toBe('한글');
  });
  it('folds an unnormalised accent (e + combining acute) to the same letter and maps it to the letter\'s start', () => {
    const f = foldForSearch('Café x');
    expect(f.folded).toBe('cafe x');
    expect(f.map).toEqual([0, 1, 2, 3, 5, 6]);
  });
  it('leaves the marks of other scripts alone (kana voicing is a different letter)', () => {
    expect(foldForSearch('が').folded).toBe('が');
  });
  it('reads a line break and a no-break space as a space, so a phrase matches across them', () => {
    expect(foldForSearch('칼슘\n펌프 끝').folded).toBe('칼슘 펌프 끝');
  });
});

describe('findInCues (spec 7.4)', () => {
  it('finds a Latin word without its accent, in the cue\'s own text', () => {
    expect(findInCues([cue('Café 앞')], 'cafe')).toEqual([{ index: 0, ranges: [[0, 4]] }]);
  });
  it('ignores case in both directions', () => {
    expect(findInCues([cue('ecole')], 'ÉCOLE')).toEqual([{ index: 0, ranges: [[0, 5]] }]);
  });
  it('gives every range of a cue', () => {
    expect(findInCues([cue('칼슘 펌프와 칼슘 펌프')], '칼슘 펌프')).toEqual([{ index: 0, ranges: [[0, 5], [7, 12]] }]);
  });
  it('is the cue\'s index in the list, and only the cues that match', () => {
    const hits = findInCues([cue('가', 0), cue('칼슘 펌프', 1), cue('나', 2), cue('칼슘 펌프가', 3)], '칼슘 펌프');
    expect(hits.map((h) => h.index)).toEqual([1, 3]);
  });
  it('matches a phrase across a line break and ranges over the original text', () => {
    expect(findInCues([cue('칼슘\n펌프')], '칼슘 펌프')).toEqual([{ index: 0, ranges: [[0, 5]] }]);
  });
  it('is empty for an empty or blank query', () => {
    expect(findInCues([cue('칼슘 펌프')], '   ')).toEqual([]);
    expect(findInCues([cue('칼슘 펌프')], '')).toEqual([]);
    expect(findInCues([], '칼슘')).toEqual([]);
  });
  it('trims the query, so a space after the word is not part of it', () => {
    expect(findInCues([cue('칼슘 펌프')], ' 칼슘 ')).toEqual([{ index: 0, ranges: [[0, 2]] }]);
  });
  it('ranges an accented letter in a decomposed text over its marks too', () => {
    expect(findInCues([cue('Café 앞')], 'cafe')).toEqual([{ index: 0, ranges: [[0, 5]] }]);
  });
  it('searches 2,000 cues in under 20 ms', () => {
    const cues = Array.from({ length: 2000 }, (_, i) => cue(`${i}번째 문장: 세포막의 운반 단백질은 농도 기울기를 거슬러 물질을 옮깁니다. Café ${i}`, i));
    findInCues(cues, '단백질');
    // The best of three: a collection pause in one run says nothing of the search.
    const runs = [0, 1, 2].map(() => {
      const t = performance.now();
      const hits = findInCues(cues, '단백질은');
      expect(hits).toHaveLength(2000);
      return performance.now() - t;
    });
    expect(Math.min(...runs)).toBeLessThan(20);
  });
});
