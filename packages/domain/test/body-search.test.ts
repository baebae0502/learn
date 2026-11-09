import { describe, expect, it } from 'vitest';
import { bodyQueryWords, extractKey, findWordOf, ftsMatch, hasBodyWords, likePattern, likeSnippet } from '../src/index';

describe('body search words', () => {
  it('splits a query into body words: NFC, one of each, the first eight, by code points; one letter is metadata only', () => {
    expect(bodyQueryWords('형 형광  현미경 형광 transduction')).toEqual({ fts: ['현미경', 'transduction'], like: ['형광'] });
    expect(bodyQueryWords('형광'.normalize('NFD'))).toEqual({ fts: [], like: ['형광'] });
    expect(bodyQueryWords('𝒜𝒜')).toEqual({ fts: [], like: ['𝒜𝒜'] });
    expect(bodyQueryWords('a b')).toEqual({ fts: [], like: [] });
    expect(bodyQueryWords('aaa bbb ccc ddd eee fff ggg hhh iii').fts).toHaveLength(8);
  });

  it('tells whether a query has any body word', () => {
    expect(hasBodyWords(bodyQueryWords('형광'))).toBe(true);
    expect(hasBodyWords(bodyQueryWords('현미경'))).toBe(true);
    expect(hasBodyWords(bodyQueryWords('a b'))).toBe(false);
  });

  it('picks the one body word a matched page\'s find bar opens on: the longest, three letters before two, the first on a tie', () => {
    expect(findWordOf('transduction fluorescence')).toBe('transduction');
    expect(findWordOf('fluorescence transduction')).toBe('fluorescence');
    expect(findWordOf('a 형광')).toBe('형광');
    expect(findWordOf('형광')).toBe('형광');
    expect(findWordOf('transduction')).toBe('transduction');
    expect(findWordOf('형광 현미경')).toBe('현미경');
    expect(findWordOf('현미경 transduction 신호')).toBe('transduction');
    expect(findWordOf('  형광  ')).toBe('형광');
    expect(findWordOf('형광'.normalize('NFD'))).toBe('형광'.normalize('NFC'));
    // Code points, as the index counts them: two astral letters are a two-letter word, shorter than three Hangul.
    expect(findWordOf('𝒜𝒜 현미경')).toBe('현미경');
    expect(findWordOf('𝒜𝒜𝒜 현미경신')).toBe('현미경신');
  });

  it('keys the extract job by file content and extractor version', () => {
    expect(extractKey('f'.repeat(64))).toBe(`extract:${'f'.repeat(64)}:pdf-text-1`);
  });

  it('quotes an FTS phrase and escapes a LIKE pattern', () => {
    expect(ftsMatch(['say "hi"', 'cell'])).toBe('"say ""hi""" AND "cell"');
    expect(likePattern('5%_\\')).toBe('%5\\%\\_\\\\%');
  });

  it('cuts a two-letter snippet at word bounds around the first match and marks every match in it', () => {
    expect(likeSnippet('오늘 형광 현미경으로 세포를 봤다. 형광 신호.', ['형광'])).toBe('오늘 형광 현미경으로 세포를 봤다. 형광 신호.');
    const long = `${'lorem ipsum '.repeat(10)}the Cy marker and cy again ${'dolor sit '.repeat(10)}`;
    const s = likeSnippet(long, ['cy']);
    expect(s.startsWith('…') && s.endsWith('…')).toBe(true);
    expect(s).toContain('Cy marker and cy again');
    expect(s.replace(/[…]/g, '').length).toBeLessThanOrEqual(20 + 2 + 28);
  });
});
