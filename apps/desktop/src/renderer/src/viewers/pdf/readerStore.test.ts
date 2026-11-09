import { describe, expect, it } from 'vitest';
import { createReaderStore, keepsPendingJump } from './readerStore';

describe('the page a 본문 일치 row leaves for a reader', () => {
  it('is kept while the document opens, asks for its password or is shown', () => {
    expect(keepsPendingJump('opening', false)).toBe(true);
    expect(keepsPendingJump('password', false)).toBe(true);
    expect(keepsPendingJump('ready', false)).toBe(true);
  });
  it('is dropped when the document cannot be opened or shown', () => {
    expect(keepsPendingJump('failed', false)).toBe(false);
    expect(keepsPendingJump('ready', true)).toBe(false);
  });
  it('lives in the tab\'s store until it is taken', () => {
    const store = createReaderStore();
    expect(store.getState().pendingJump).toBeNull();
    store.getState().setPendingJump({ pageIndex: 6, query: '형광' });
    expect(store.getState().pendingJump).toEqual({ pageIndex: 6, query: '형광' });
    store.getState().setPendingJump(null);
    expect(store.getState().pendingJump).toBeNull();
  });
});
