import { describe, expect, it } from 'vitest';
import { NAME_MAX, NEW_COLLECTION_NAME, finishName, tooLong } from './nameEdit';

describe('what a finished name means (spec 3.4)', () => {
  it('starts a new collection as 새 컬렉션 (U+00A0), Finder\'s new folder', () => {
    expect(NEW_COLLECTION_NAME).toBe('새\u00a0컬렉션');
  });
  it('trims and normalizes; an empty or blank name is the original (no error)', () => {
    expect(finishName('  논문 읽기 ', NEW_COLLECTION_NAME)).toEqual({ name: '논문 읽기' });
    expect(finishName('', NEW_COLLECTION_NAME)).toEqual({ name: NEW_COLLECTION_NAME });
    expect(finishName(' \u00a0 ', '통계')).toEqual({ name: '통계' });
    expect(finishName('각'.normalize('NFD'), 'x')).toEqual({ name: '각'.normalize('NFC') });
  });
  it('allows 200 characters and no more, counted after trimming (the same count the database makes)', () => {
    expect(NAME_MAX).toBe(200);
    expect(finishName('가'.repeat(200), 'x')).toEqual({ name: '가'.repeat(200) });
    expect(finishName(`  ${'가'.repeat(200)}  `, 'x')).toEqual({ name: '가'.repeat(200) });
    expect(finishName('가'.repeat(201), 'x')).toEqual({ tooLong: true });
    expect(tooLong('가'.repeat(201))).toBe(true);
    expect(tooLong('가'.repeat(200))).toBe(false);
  });
});
