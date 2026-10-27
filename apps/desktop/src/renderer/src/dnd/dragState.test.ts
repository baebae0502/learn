import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragState, setDndGate } from './dragState';

afterEach(() => {
  dragState.end();
  dragState.setFilesOver(false);
  dragState.setAlt(false);
  dragState.setNative(false);
  setDndGate(true);
});

describe('dragState', () => {
  it('holds what is being dragged; a new drag replaces the last and subscribers hear each change', () => {
    const heard = vi.fn();
    const stop = dragState.subscribe(heard);
    dragState.beginItems(['a', 'b']);
    expect(dragState.get()).toMatchObject({ kind: 'items', itemIds: ['a', 'b'], collectionId: null, tagId: null });
    dragState.beginCollection('c1');
    expect(dragState.get()).toMatchObject({ kind: 'collection', itemIds: [], collectionId: 'c1', tagId: null });
    dragState.beginTag('t1');
    expect(dragState.get()).toMatchObject({ kind: 'tag', collectionId: null, tagId: 't1' });
    dragState.end();
    expect(dragState.get().kind).toBeNull();
    expect(heard).toHaveBeenCalledTimes(4);
    stop();
  });

  it('React Aria\'s end counts unless a native drag is running — a drag by keyboard has no native one', () => {
    dragState.beginCollection('c1');
    dragState.setNative(true);
    dragState.endUnlessNative();
    expect(dragState.get().kind).toBe('collection');
    dragState.setNative(false);
    dragState.endUnlessNative();
    expect(dragState.get().kind).toBeNull();
  });

  it('ending a drag that is not there says nothing', () => {
    const heard = vi.fn();
    const stop = dragState.subscribe(heard);
    dragState.end();
    dragState.end();
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it('keeps Finder files and the ⌥ key apart from a drag of our own', () => {
    dragState.setFilesOver(true);
    dragState.setAlt(true);
    expect(dragState.filesOver()).toBe(true);
    expect(dragState.alt()).toBe(true);
    expect(dragState.get().kind).toBeNull();
  });

  it('remembers that a drop was just handled, for half a second', () => {
    vi.useFakeTimers();
    try {
      expect(dragState.justDropped()).toBe(false);
      dragState.markDrop();
      expect(dragState.justDropped()).toBe(true);
      vi.advanceTimersByTime(499);
      expect(dragState.justDropped()).toBe(true);
      vi.advanceTimersByTime(2);
      expect(dragState.justDropped()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the gate starts open, and closing and opening it is heard once each', () => {
    const heard = vi.fn();
    const stop = dragState.subscribe(heard);
    setDndGate(true);
    expect(heard).not.toHaveBeenCalled();
    setDndGate(false);
    setDndGate(false);
    setDndGate(true);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });
});
