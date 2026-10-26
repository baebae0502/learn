import { describe, expect, it } from 'vitest';
import type { OrganizeTag } from '@learn/domain';
import { SUGGESTIONS_MAX, suggestTags } from './tagSuggestions';

const tag = (id: string, name: string, over: Partial<OrganizeTag> = {}): OrganizeTag => ({ id, name, color: null, position: null, ...over });
const NONE: ReadonlySet<string> = new Set();

describe('the add field\'s suggestions (spec 6.1)', () => {
  it('offers nothing for an empty query — the field suggests what is being typed, not the whole list', () => {
    expect(suggestTags([tag('1', '수용체')], NONE, '')).toEqual([]);
    expect(suggestTags([tag('1', '수용체')], NONE, '   ')).toEqual([]);
  });
  it('matches NFC lower-case substrings and 초성, with the last syllable still being composed', () => {
    const tags = [tag('1', '수용체'), tag('2', 'G 단백질'), tag('3', '세포 주기')];
    expect(suggestTags(tags, NONE, '용').map((t) => t.id)).toEqual(['1']);
    expect(suggestTags(tags, NONE, 'g').map((t) => t.id)).toEqual(['2']);
    expect(suggestTags(tags, NONE, 'ㅅㅇㅊ').map((t) => t.id)).toEqual(['1']);
    expect(suggestTags(tags, NONE, '수용ㅊ').map((t) => t.id)).toEqual(['1']);
    expect(suggestTags(tags, NONE, '수용체'.normalize('NFD')).map((t) => t.id)).toEqual(['1']);
  });
  it('leaves out the tags the items already have', () => {
    const tags = [tag('1', '효소 1'), tag('2', '효소 2'), tag('3', '효소 3')];
    expect(suggestTags(tags, new Set(['2']), '효소').map((t) => t.id)).toEqual(['1', '3']);
  });
  it('shows at most eight', () => {
    const tags = Array.from({ length: 12 }, (_, i) => tag(String(i), `효소 ${i + 1}`));
    expect(SUGGESTIONS_MAX).toBe(8);
    expect(suggestTags(tags, NONE, '효소')).toHaveLength(8);
    expect(suggestTags(tags, NONE, '효소', 3)).toHaveLength(3);
  });
  it('puts a name that starts with the query first, then a word start, then a match inside; ties by name with numbers by value', () => {
    const tags = [tag('a', '감수용'), tag('b', '2차 수용체'), tag('c', '수용체 10'), tag('d', '수용체 2')];
    expect(suggestTags(tags, NONE, '수용').map((t) => t.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('puts a literal match before a 초성 one', () => {
    // 사과 is ㅅㄱ, not ㅅㅇ: it does not match at all; 수아 is ㅅㅇ only by its initials, ㅅㅇ 노트 literally.
    expect(suggestTags([tag('a', '사과'), tag('b', 'ㅅㅇ 노트')], NONE, 'ㅅㅇ').map((t) => t.id)).toEqual(['b']);
    expect(suggestTags([tag('c', '수아'), tag('d', 'ㅅㅇ 노트')], NONE, 'ㅅㅇ').map((t) => t.id)).toEqual(['d', 'c']);
  });
});
