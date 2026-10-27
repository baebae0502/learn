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

  it('a drag of our own starts clean: Finder files that left the window, ⌥ and a native drag whose source went away are not carried over', () => {
    for (const begin of [() => dragState.beginItems(['a']), () => dragState.beginCollection('c1'), () => dragState.beginTag('t1')]) {
      dragState.setFilesOver(true);
      dragState.setAlt(true);
      dragState.setNative(true);
      begin();
      expect(dragState.filesOver()).toBe(false);
      expect(dragState.alt()).toBe(false);
      expect(dragState.native()).toBe(false);
      dragState.end();
    }
  });

  it('a drop guards the focus on the dropped-on key only — React Aria moves it more than once — until the user\'s next input', () => {
    dragState.armDropFocus('stat');
    expect(dragState.takeDropFocus('bio')).toBeNull(); // another row's focus is the user's
    expect(dragState.takeDropFocus('stat')).toEqual({ pointer: false });
    expect(dragState.takeDropFocus('stat')).toEqual({ pointer: false });
    dragState.clearDropFocus();
    expect(dragState.takeDropFocus('stat')).toBeNull();
  });

  it('it tells a drop by mouse from one by keyboard, and the next pointer or key forgets the guard', () => {
    dragState.armDropFocus('stat');
    dragState.setPointerDrop(true); // the native drop event comes after the drag was over the row
    expect(dragState.takeDropFocus('stat')).toEqual({ pointer: true });
    dragState.clearDropFocus(); // the next pointerdown or keydown
    expect(dragState.takeDropFocus('stat')).toBeNull();
    dragState.setPointerDrop(false);
  });

  it('does not run on a timer: the guard is still there long after a drop', () => {
    vi.useFakeTimers();
    try {
      dragState.armDropFocus('stat');
      vi.advanceTimersByTime(60_000);
      expect(dragState.takeDropFocus('stat')).not.toBeNull();
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
