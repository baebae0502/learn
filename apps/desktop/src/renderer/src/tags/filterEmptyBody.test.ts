import { describe, expect, it } from 'vitest';
import { chosenTagNames, filterEmptyBody } from './filterEmptyBody';

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

describe('the chosen names in the tag cloud\'s order', () => {
  const tag = (id: string, name: string, position: number | null = null) => ({ id, name, color: null, position });
  const tags = [tag('b', '나비'), tag('a', '가지'), tag('c', '다람쥐', 2), tag('d', '라면')];
  const base = { tags, filter: new Set(['b', 'a', 'c']), counts: new Map([['a', 1], ['b', 5], ['c', 0], ['d', 9]]) };
  it('lists the coloured slot first, then by name — not in the order the model keeps the tags', () => {
    expect(chosenTagNames({ ...base, selector: { show: 'all', sort: 'name' } })).toEqual(['다람쥐', '가지', '나비']);
  });
  it('follows the sort setting: by how many items of the view have the tag', () => {
    expect(chosenTagNames({ ...base, selector: { show: 'all', sort: 'count' } })).toEqual(['다람쥐', '나비', '가지']);
  });
  it('keeps a chosen tag the view lacks, and leaves out the ones not chosen', () => {
    expect(chosenTagNames({ ...base, selector: { show: 'view', sort: 'name' } })).toContain('다람쥐');
    expect(chosenTagNames({ ...base, selector: { show: 'all', sort: 'name' } })).not.toContain('라면');
  });
});
