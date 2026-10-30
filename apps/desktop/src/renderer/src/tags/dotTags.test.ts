import { describe, expect, it } from 'vitest';
import { TAG_COLORS, type OrganizeTag } from '@learn/domain';
import { dotTags, tagsDescription } from './dotTags';

const tag = (id: string, name: string, position: number | null = null): OrganizeTag => ({ id, name, color: position === null ? null : TAG_COLORS[position - 1]!.id, position });
const IMPORTANT = tag('a', '중요', 3);
const EXAM = tag('b', '시험 범위', 1);
const PLAIN = tag('c', '복습');

describe('the table\'s colour dots (spec 5.1)', () => {
  it('are the coloured tags only, by slot', () => {
    expect(dotTags([IMPORTANT, EXAM, PLAIN]).map((x) => x.id)).toEqual(['b', 'a']);
    expect(dotTags([EXAM, IMPORTANT]).map((x) => x.id)).toEqual(['b', 'a']);
    expect(dotTags([PLAIN])).toEqual([]);
    expect(dotTags([])).toEqual([]);
  });
  it('are described as the dots show them: 태그: …, and not at all when there is no dot', () => {
    expect(tagsDescription([IMPORTANT, EXAM, PLAIN])).toBe('태그: 시험 범위, 중요');
    expect(tagsDescription([PLAIN])).toBeNull();
  });
});
