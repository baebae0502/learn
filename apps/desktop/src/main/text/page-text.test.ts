import { describe, expect, it } from 'vitest';
import { cleanPageText, guardStoredText } from './page-text';

describe('page text', () => {
  it('joins a word broken at a line end, collapses whitespace, composes, and drops controls and the snippet marks', () => {
    expect(cleanPageText('The dominant sequence transduc-\ntion models')).toBe('The dominant sequence transduction models');
    expect(cleanPageText('state-of-the-art  1990-\n2000')).toBe('state-of-the-art 1990- 2000');
    expect(cleanPageText('  주의\n\n메커니즘은\t중요합니다.  ')).toBe('주의 메커니즘은 중요합니다.');
    expect(cleanPageText('한글'.normalize('NFD'))).toBe('한글');
    expect(cleanPageText('a\u0007b c')).toBe('ab c');
    expect(cleanPageText('a\u0007b \ue000c\ue001')).toBe('ab c');
    expect(cleanPageText('ab\ue000cd\ue001')).toBe('abcd'); // a mark inside a word does not split it
    expect(cleanPageText('x\ue000y\ue001 z')).toBe('xy z');
  });
  it('guards what is stored: marks gone, cut at the limit', () => {
    expect(guardStoredText('abcdef', 4)).toBe('abcd');
    expect(guardStoredText('ab\ue000cd\ue001ef', 4)).toBe('abcd');
    expect(guardStoredText('\ue000\ue001ab', 10)).toBe('ab'); // a stored text can never carry a highlight mark
  });
  it('does not leave half of a surrogate pair at the cut', () => {
    expect(guardStoredText('ab😀', 3)).toBe('ab');
  });
});
