import { describe, expect, it } from 'vitest';
import { readerWindowTitle } from './readerTitle';

describe('the window title while reading (design-spec 2.1, polish minor 3)', () => {
  it('loading: null, so the previous title stays until the item is known', () => {
    expect(readerWindowTitle({ data: undefined, isError: false })).toBeNull();
  });
  it('the item is known (reader, missing notice, a file that failed to open): its title', () => {
    expect(readerWindowTitle({ data: { title: 'sample' }, isError: false })).toBe('sample');
  });
  it('the item could not be read: "Learn"; a cached item keeps its title', () => {
    expect(readerWindowTitle({ data: undefined, isError: true })).toBe('Learn');
    expect(readerWindowTitle({ data: null, isError: true })).toBe('Learn');
    expect(readerWindowTitle({ data: { title: 'sample' }, isError: true })).toBe('sample');
  });
});
