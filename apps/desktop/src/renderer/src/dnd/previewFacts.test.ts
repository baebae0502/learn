import { describe, expect, it } from 'vitest';
import { item } from '../organize/testing';
import { previewFacts } from './previewFacts';

describe('what the row drag image shows (spec 8.2)', () => {
  const items = [item('a', { title: '분자생물학 6장 · 신호 전달' }), item('b', { title: '통계', type: 'video' })];

  it('is the first dragged row — its title and its kind — and the count', () => {
    expect(previewFacts(['a', 'b'], items)).toEqual({ title: '분자생물학 6장 · 신호 전달', type: 'pdf', count: 2 });
    expect(previewFacts(['b'], items)).toEqual({ title: '통계', type: 'video', count: 1 });
  });

  it('names the drag by its count when the first row is not in the list any more', () => {
    expect(previewFacts(['gone', 'a'], items)).toEqual({ title: '자료 2개', type: 'pdf', count: 2 });
    expect(previewFacts(['a'], undefined)).toEqual({ title: '자료 1개', type: 'pdf', count: 1 });
  });
});
