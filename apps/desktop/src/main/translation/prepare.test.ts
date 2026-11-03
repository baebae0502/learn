import { describe, expect, it } from 'vitest';
import { isMostlyHangul, prepareText, splitForRequest } from './prepare';

describe('prepareText', () => {
  it('joins a word broken at a line end, only between letters', () => {
    expect(prepareText('state-of-the-\nart models\nwork')).toBe('state-of-theart models work');
  });
  it('turns line breaks into spaces, collapses runs and trims', () => {
    expect(prepareText('  a\r\nb \t  c\n\n d  ')).toBe('a b c d');
  });
  it('normalises to NFC', () => {
    expect(prepareText(String.fromCharCode(0x1112, 0x1161, 0x11ab))).toBe(String.fromCharCode(0xd55c));
  });
});

describe('splitForRequest', () => {
  it('returns one piece for a short text', () => {
    expect(splitForRequest('One. Two! Three?')).toEqual(['One. Two! Three?']);
  });
  it('packs whole sentences up to max', () => {
    expect(splitForRequest('Aaaa. Bbbb. Cccc.', 11)).toEqual(['Aaaa. Bbbb.', 'Cccc.']);
  });
  it('cuts a sentence longer than max at max', () => {
    expect(splitForRequest('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('splits after full-width sentence marks too', () => {
    expect(splitForRequest('一。 二。 三。', 3)).toEqual(['一。', '二。', '三。']);
  });
});

describe('isMostlyHangul', () => {
  it('counts letters only, at 60 percent', () => {
    expect(isMostlyHangul('안녕하세요 wo 123 !!!')).toBe(true);
    expect(isMostlyHangul('안녕 hello')).toBe(false);
    expect(isMostlyHangul('안녕하세요 he')).toBe(true);
    expect(isMostlyHangul('12345 !?')).toBe(false);
    expect(isMostlyHangul('')).toBe(false);
  });
});
