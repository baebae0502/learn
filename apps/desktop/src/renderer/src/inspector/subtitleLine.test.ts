import { describe, expect, it } from 'vitest';
import { subtitleLine } from './subtitleLine';

describe('subtitleLine (spec 6.8)', () => {
  it('joins up to three names with a middot that stays with the name before it', () => {
    expect(subtitleLine(['한국어'])).toBe('한국어');
    expect(subtitleLine(['한국어', '영어'])).toBe('한국어\u00a0· 영어');
    expect(subtitleLine(['한국어', '영어', '일본어'])).toBe('한국어\u00a0· 영어\u00a0· 일본어');
  });
  it('shortens four or more to the first two and the number of the rest', () => {
    expect(subtitleLine(['한국어', '영어', '일본어', '자막 4'])).toBe('한국어\u00a0· 영어\u00a0외\u00a02개');
    expect(subtitleLine(['a', 'b', 'c', 'd', 'e'])).toBe('a\u00a0· b\u00a0외\u00a03개');
  });
});
