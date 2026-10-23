import { describe, expect, it } from 'vitest';
import { initialOf, isChoseong, matchKorean, splitFinal } from './hangul';

describe('Korean matching for the palette (ADR-0005 §5)', () => {
  it('knows initial consonants and syllables', () => {
    expect(initialOf('가')).toBe('ㄱ');
    expect(initialOf('져')).toBe('ㅈ');
    expect(initialOf('a')).toBe('a');
    expect(isChoseong('ㄲ')).toBe(true);
    expect(isChoseong('ㅏ')).toBe(false);
    expect(splitFinal('갖')).toEqual(['가', 'ㅈ']);
    expect(splitFinal('가')).toBeNull();
    expect(splitFinal('값')).toBeNull(); // ㅄ cannot start a syllable
  });
  it('matches 초성 sequences, whole syllables, and both mixed', () => {
    expect(matchKorean('ㄱㅈ', '파일 가져오기…')).toEqual({ start: 3, end: 5, kind: 'initials' });
    expect(matchKorean('ㅅㅇㄷㅂ', '사이드바 가리기')).toEqual({ start: 0, end: 4, kind: 'initials' });
    expect(matchKorean('가ㅈ', '파일 가져오기…')).toEqual({ start: 3, end: 5, kind: 'initials' });
  });
  it('ranks literal matches: exact, prefix, word start, substring', () => {
    expect(matchKorean('파일 가져오기…', '파일 가져오기…')?.kind).toBe('exact');
    expect(matchKorean('파일', '파일 가져오기…')?.kind).toBe('prefix');
    expect(matchKorean('가져', '파일 가져오기…')).toEqual({ start: 3, end: 5, kind: 'word' });
    expect(matchKorean('져오', '파일 가져오기…')?.kind).toBe('substring');
  });
  it('treats a syllable still being composed (갖 on the way to 가져) as syllable + initial', () => {
    expect(matchKorean('갖', '파일 가져오기…')).toEqual({ start: 3, end: 5, kind: 'initials' });
  });
  it('is case-insensitive, NFC-normalised, and finds nothing when nothing matches', () => {
    expect(matchKorean('IMPORT', 'import')?.kind).toBe('exact');
    expect(matchKorean('가'.normalize('NFD'), '파일 가져오기…')?.start).toBe(3);
    expect(matchKorean('효소', '파일 가져오기…')).toBeNull();
    expect(matchKorean('   ', '파일')).toBeNull();
  });
});
