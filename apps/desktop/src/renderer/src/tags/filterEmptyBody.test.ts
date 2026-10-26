import { describe, expect, it } from 'vitest';
import { filterEmptyBody } from './filterEmptyBody';

describe('the line under 고른 태그를 모두 가진 자료가 없습니다 (spec 3.6)', () => {
  it('names up to three chosen tags, in the order given', () => {
    expect(filterEmptyBody(['수용체'])).toBe('고른 태그 1개(수용체)로 거른 결과입니다.');
    expect(filterEmptyBody(['수용체', '회귀분석'])).toBe('고른 태그 2개(수용체 · 회귀분석)로 거른 결과입니다.');
    expect(filterEmptyBody(['가', '나', '다'])).toBe('고른 태그 3개(가 · 나 · 다)로 거른 결과입니다.');
  });
  it('gives only the count beyond three', () => {
    expect(filterEmptyBody(['가', '나', '다', '라'])).toBe('고른 태그 4개로 거른 결과입니다.');
  });
  it('binds 태그 and the number with U+00A0 so they never part across lines', () => {
    expect(filterEmptyBody(['가', '나'])).toContain('태그 2개');
  });
});
