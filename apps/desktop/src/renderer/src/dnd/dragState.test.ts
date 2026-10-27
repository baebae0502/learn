import { afterEach, describe, expect, it, vi } from 'vitest';
import { dragState, setDndGate } from './dragState';

afterEach(() => {
  dragState.end();
  dragState.clearDropFocus();
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

  it('a drag that hovers a row and ends without a drop on it leaves no guard: exit from the row, a cancel and the drag\'s end', () => {
    dragState.beginItems(['a']);
    dragState.hoverDropFocus('stat');
    expect(dragState.takeDropFocus('stat')).not.toBeNull(); // while the drag is over the row
    dragState.leaveDropFocus('stat'); // drop-exit from the armed row
    expect(dragState.takeDropFocus('stat')).toBeNull();
    dragState.hoverDropFocus('stat');
    dragState.leaveDropFocus('bio'); // another row's exit is not this one's
    expect(dragState.takeDropFocus('stat')).not.toBeNull();
    dragState.end(); // cancelled: no drop on the row
    expect(dragState.takeDropFocus('stat')).toBeNull();
  });

  it('a drop on the row keeps the guard through the drop-exit and the drag\'s end, until the next input', () => {
    dragState.beginItems(['a']);
    dragState.hoverDropFocus('stat');
    dragState.armDropFocus('stat'); // the drop
    dragState.leaveDropFocus('stat');
    dragState.end();
    expect(dragState.takeDropFocus('stat')).not.toBeNull();
    dragState.clearDropFocus();
    expect(dragState.takeDropFocus('stat')).toBeNull();
  });

  it('the tree\'s cursor is off its row while React Aria records a drop on a row, and back as the drop is handed over — so React Aria finds it moved and leaves it', () => {
    // React Aria's rule (useDroppableCollection, updateFocusAfterDrop): after a drop "on" a row it moves the cursor there, with the
    // keyboard modality, whenever it finds the cursor where it was when it recorded the drop — on each render, then on its timer.
    let cursor: string | null = 'all';
    dragState.beginItems(['a']);
    dragState.hoverDropFocus('stat');
    cursor = null; // the sidebar, at the drop's capture
    dragState.parkCursor(() => void (cursor = 'all'));
    const recorded = cursor; // React Aria records the drop
    dragState.armDropFocus('stat'); // and hands it over (onItemDrop)
    expect(cursor).toBe('all');
    expect(cursor, 'React Aria leaves a cursor that moved since the drop').not.toBe(recorded);
    cursor = 'unfiled'; // the user's own move
    dragState.leaveDropFocus('stat');
    dragState.end();
    expect(cursor, 'put back once only').toBe('unfiled');
  });

  it('a parked cursor goes back even when no drop is handed over: on the drop-exit, or at the drag\'s end', () => {
    for (const finish of [() => dragState.leaveDropFocus('stat'), () => dragState.end()]) {
      let back = 0;
      dragState.beginItems(['a']);
      dragState.hoverDropFocus('stat');
      dragState.parkCursor(() => void back++);
      finish();
      dragState.end();
      expect(back).toBe(1);
    }
  });

  it('a keyboard drop expected in this event parks the cursor when React Aria asks the tree for its operation — once; the next key, a null or the drag\'s end forgets it', () => {
    let parks = 0;
    const park = () => void parks++;
    dragState.beginCollection('c1');
    dragState.expectKeyboardDrop(park); // ↩ released
    dragState.dropOperationAsked(); // DragManager.drop asks, then records the cursor
    dragState.dropOperationAsked(); // a later question (the next arrow's targets) is not a drop
    expect(parks).toBe(1);
    dragState.expectKeyboardDrop(park);
    dragState.expectKeyboardDrop(null); // the next key up is not ↩
    dragState.dropOperationAsked();
    dragState.expectKeyboardDrop(park);
    dragState.end(); // ↩ with no target: a cancel, the drag ends
    dragState.dropOperationAsked();
    expect(parks).toBe(1);
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
