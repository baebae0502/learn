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
    store.getState().setPendingJump({ kind: 'page', pageIndex: 6, query: '형광' });
    expect(store.getState().pendingJump).toEqual({ kind: 'page', pageIndex: 6, query: '형광' });
    store.getState().setPendingJump(null);
    expect(store.getState().pendingJump).toBeNull();
  });
  it('holds a time jump as well: the sentence\'s start, the word to search and the track (null: the one shown)', () => {
    const store = createReaderStore();
    store.getState().setPendingJump({ kind: 'time', startMs: 12_000, query: '칼슘', track: 'asset-en' });
    expect(store.getState().pendingJump).toEqual({ kind: 'time', startMs: 12_000, query: '칼슘', track: 'asset-en' });
  });
});
