import { describe, expect, it } from 'vitest';
import { DEFAULT_TAGS_SELECTOR, parseExpanded, parseTagsSelector } from './viewSettings';

const A = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const B = '6b1c9d2e-4f50-4b6c-9d7e-8f9a0b1c2d3e';

describe('tags.selector as stored', () => {
  it('defaults to the current view\'s tags by name', () => {
    expect(DEFAULT_TAGS_SELECTOR).toEqual({ show: 'view', sort: 'name' });
    expect(Object.isFrozen(DEFAULT_TAGS_SELECTOR)).toBe(true);
  });
  it('reads a stored value and falls back to the default for anything else', () => {
    expect(parseTagsSelector({ show: 'all', sort: 'count' })).toEqual({ show: 'all', sort: 'count' });
    for (const raw of [null, undefined, 3, {}, { show: 'all' }, { show: 'some', sort: 'name' }]) expect(parseTagsSelector(raw)).toEqual(DEFAULT_TAGS_SELECTOR);
  });
});

describe('sidebar.expanded as stored', () => {
  const known = (id: string) => id === A;
  it('drops ids of collections that no longer exist, and repeats', () => {
    expect(parseExpanded([A, B, A], known)).toEqual([A]);
  });
  it('is empty for anything unreadable', () => {
    for (const raw of [null, undefined, 'x', [3], ['not-a-uuid']]) expect(parseExpanded(raw, () => true)).toEqual([]);
  });
});
