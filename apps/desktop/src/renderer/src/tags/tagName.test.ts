import { describe, expect, it } from 'vitest';
import { MAX_TAG_NAME, cleanTagName, sameTagName, tagNameVerdict, tooLongTagName } from './tagName';

describe('a tag name (spec 4.1)', () => {
  it('is NFC and trimmed, as the database stores it', () => {
    expect(cleanTagName('  \u1112\u1161\u11ab  ')).toBe('한');
    expect(cleanTagName('  중요 ')).toBe('중요');
  });
  it('is the same name when only the case, the spaces at the ends or the composition differ', () => {
    expect(sameTagName('Alpha', ' ALPHA ')).toBe(true);
    expect(sameTagName('\u1112\u1161\u11ab', '한')).toBe(true);
    expect(sameTagName('중요', '중요 표시')).toBe(false);
  });
  it('is too long past 200 UTF-16 units of the cleaned name, the database\'s count', () => {
    expect(MAX_TAG_NAME).toBe(200);
    expect(tooLongTagName('가'.repeat(200))).toBe(false);
    expect(tooLongTagName(`  ${'가'.repeat(200)}  `)).toBe(false);
    expect(tooLongTagName('가'.repeat(201))).toBe(true);
  });
  it('judges what the field held: blank or the same name keeps the old one, over the limit refuses, anything else renames (a case change is a rename)', () => {
    expect(tagNameVerdict('   ', '중요')).toEqual({ kind: 'unchanged' });
    expect(tagNameVerdict(' 중요 ', '중요')).toEqual({ kind: 'unchanged' });
    expect(tagNameVerdict('가'.repeat(201), '중요')).toEqual({ kind: 'tooLong' });
    expect(tagNameVerdict(' 시험 범위 ', '중요')).toEqual({ kind: 'rename', name: '시험 범위' });
    expect(tagNameVerdict('ALPHA', 'alpha')).toEqual({ kind: 'rename', name: 'ALPHA' });
  });
});
