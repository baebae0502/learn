import { describe, expect, it } from 'vitest';
import { buildPageText, codePointOffset, findQuote, matchText, quoteAround } from '../src/index';

describe('page text and quote search', () => {
  const page = buildPageText([
    { str: 'Attention is all', hasEOL: true },
    { str: 'you need. The domi-', hasEOL: true },
    { str: 'nant model.', hasEOL: false },
  ]);

  it('joins items, with a newline at each line end', () => {
    expect(page.text).toBe('Attention is all\nyou need. The domi-\nnant model.');
    expect(page.starts).toEqual([0, 17, 37]);
  });

  it('finds a quote across a line break and a hyphenated word, in original offsets', () => {
    const span = findQuote(page.text, 'all you need. The dominant')!;
    expect(page.text.slice(span.start, span.end)).toBe('all\nyou need. The domi-\nnant');
    expect(findQuote(page.text, 'absent words')).toBeNull();
  });

  it('does not take a dropped line-end hyphen or soft hyphen along when the match stops before it', () => {
    const text = 'The transduc-\ntion model and co­operate';
    expect(findQuote(text, 'transduc')).toEqual({ start: 4, end: 12 });
    expect(findQuote(text, 'transduction')).toEqual({ start: 4, end: 18 });
    expect(findQuote(text, 'co')).toEqual({ start: 29, end: 31 });
  });

  it('keeps the hyphen of a range between digits across a line break', () => {
    expect(matchText('1990-\n2000').norm).toBe('1990- 2000');
    expect(findQuote('in 1990-\n2000 only', '1990- 2000')).toEqual({ start: 3, end: 13 });
  });

  it('matches across Unicode forms and soft hyphens', () => {
    const nfd = '주의 메커니즘'.normalize('NFD');
    expect(findQuote(nfd, '주의 메커니즘')).toEqual({ start: 0, end: nfd.length });
    expect(findQuote('co­operate here', 'cooperate')).toEqual({ start: 0, end: 10 });
  });

  it('picks the occurrence nearest the hint', () => {
    expect(findQuote('cat. dog. cat.', 'cat.', 9)).toEqual({ start: 10, end: 14 });
    expect(findQuote('cat. dog. cat.', 'cat.')).toEqual({ start: 0, end: 4 });
  });

  it('keeps map one longer than the normalized text', () => {
    const { norm, map } = matchText('a \n  b-\nc');
    expect(norm).toBe('a bc');
    expect(map).toHaveLength(norm.length + 1);
    expect(map[norm.length]).toBe(9);
  });

  it('cuts a quote with context', () => {
    expect(quoteAround('0123456789', { start: 4, end: 6 }, 2)).toEqual({ exact: '45', prefix: '23', suffix: '67' });
    expect(quoteAround('abc', { start: 0, end: 1 })).toEqual({ exact: 'a', prefix: '', suffix: 'bc' });
  });

  it('counts code points', () => {
    expect(codePointOffset('a😀b', 3)).toBe(2);
    expect(codePointOffset('abc', 2)).toBe(2);
  });
});
