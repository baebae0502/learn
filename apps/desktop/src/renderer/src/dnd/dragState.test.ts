import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React Aria's transition queue (runAfterTransition) listens for transitions on the document it finds when it loads: it finds this
// one, whose transitions the tests start and end, and nothing else here sees it.
const transitions = vi.hoisted(() => {
  const listeners: Record<string, (e: unknown) => void> = {};
  const doc = { readyState: 'complete', addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn) };
  (globalThis as { document?: unknown }).document = doc;
  const sheet = { isConnected: true, addEventListener: () => {}, removeEventListener: () => {} }; // an element in a transition
  return {
    doc,
    send: (type: 'transitionrun' | 'transitionend') => listeners[type]!({ type, target: sheet, propertyName: 'opacity' }),
  };
});
import { runAfterTransition } from 'react-aria/private/utils/runAfterTransition';
import { dragState, setDndGate } from './dragState';
if ((globalThis as { document?: unknown }).document === transitions.doc) delete (globalThis as { document?: unknown }).document;

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

  it('a drop guards the focus on every row — React Aria moves it more than once, and late onto another row — in the drop\'s own task, and until the user\'s next input', () => {
    dragState.armDropFocus('stat');
    expect(dragState.takeDropFocus('stat')).toEqual({ pointer: false });
    expect(dragState.takeDropFocus('stat')).toEqual({ pointer: false });
    // No input since the drop: a focus on another row is React Aria's too (its focus moves after a screen reader's click wait for
    // the next frame and any transition, and land on the element they found then), and so is a change of selection.
    expect(dragState.takeDropFocus('bio')).toEqual({ pointer: false });
    expect(dragState.dropGuarded()).toBe(true);
    dragState.clearDropFocus();
    expect(dragState.takeDropFocus('stat')).toBeNull();
    expect(dragState.takeDropFocus('bio')).toBeNull();
    expect(dragState.dropGuarded()).toBe(false);
  });

  it('a drag over a row guards that row only: no drop yet, so another row\'s focus or a selection is not the drop\'s', () => {
    dragState.beginItems(['a']);
    dragState.hoverDropFocus('stat');
    expect(dragState.takeDropFocus('stat')).not.toBeNull();
    expect(dragState.takeDropFocus('bio')).toBeNull();
    expect(dragState.dropGuarded()).toBe(false);
    dragState.end();
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

  it('a drop on the row keeps the guard through the drop-exit and the drag\'s end, until the next input (or React Aria\'s wait\'s end)', () => {
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

  describe('a drop\'s guard lasts until React Aria\'s own late focus moves have had their turn, then goes — the dropped-on row\'s too', () => {
    const state = dragState;
    const afterTransition = runAfterTransition;
    const transition = transitions.send;
    // The page's frames, run by hand.
    let frames: Array<() => void> = [];
    const frame = () => {
      const now = frames;
      frames = [];
      for (const fn of now) fn();
    };
    // React, by hand: an update asks for a render, run as a task of its own (`flush`); all updates asked by then go into it. In a
    // commit, the rows' effects run before the sidebar's (SidebarTree's `rendered` effect).
    let rowsUpdate = false; // React Aria moved the tree's cursor: its rows' effects ask for a focus move
    let sidebar: Array<() => void> = [];
    const moves: Array<{ pointer: boolean } | null> = [];
    const reactAriaMove = () => afterTransition(() => moves.push(state.takeDropFocus('bio'))); // focusSafely, to a row it found then
    const commit = () => {
      if (rowsUpdate) reactAriaMove();
      rowsUpdate = false;
      const thens = sidebar;
      sidebar = [];
      for (const then of thens) then();
    };
    // React Aria's drop, as useDroppableCollection's onDrop runs it: the drop handed over (onItemDrop), then its wait's timer.
    const drop = () => {
      state.armDropFocus('stat');
      setTimeout(() => void (rowsUpdate = true), 50); // updateFocusAfterDrop: the cursor to the dropped-on row
    };
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.stubGlobal('window', { requestAnimationFrame: (fn: () => void) => frames.push(fn), cancelAnimationFrame: () => {} });
      state.setAfterRender((then) => void sidebar.push(then));
      moves.length = 0;
      rowsUpdate = false;
      sidebar = [];
    });
    afterEach(() => {
      state.clearDropFocus();
      state.setAfterRender(null);
      frames = [];
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    it('the drop\'s render, then each 50 ms timer a task of its own with its render and a frame after it: each of React Aria\'s moves is guarded; then a focus on any row is the user\'s (VoiceOver\'s, no input)', async () => {
      // In the page each timer is a task: React's render of what it asked for, and a frame, may come before the next one.
      state.setAfterRender((then) => {
        sidebar.push(then);
        commit();
        frame();
      });
      state.armDropFocus('stat'); // onItemDrop
      setTimeout(() => {
        rowsUpdate = true; // React Aria's wait ends (updateFocusAfterDrop)
        commit();
        frame();
      }, 50);
      await Promise.resolve(); // React renders the drop's event in a microtask: the rows' effects ask for a move
      reactAriaMove();
      frame();
      expect(moves, 'the move the drop\'s render asked for').toEqual([{ pointer: false }]);
      await vi.advanceTimersByTimeAsync(50);
      expect(state.dropGuarded(), 'the release has not come yet').toBe(true);
      frame();
      frame();
      frame();
      expect(moves, 'the move React Aria\'s wait asked for — fails when the release\'s timer is set before React Aria\'s').toEqual([{ pointer: false }, { pointer: false }]);
      expect(state.dropGuarded()).toBe(false);
      expect(state.takeDropFocus('bio'), 'another row').toBeNull();
      expect(state.takeDropFocus('stat'), 'the dropped-on row').toBeNull();
    });

    it('React Aria\'s wait ends in the same render as the release asks for, and a layout effect\'s render after it moves the focus again: that move is guarded', async () => {
      drop();
      await vi.advanceTimersByTimeAsync(50); // both timers
      commit(); // the render both asked for: the sidebar's effects run at its end, before the follow-up render
      rowsUpdate = true; // a layout effect in it moved the cursor (useDroppableCollection: the collection changed)
      commit(); // the follow-up render
      frame();
      frame();
      frame();
      expect(moves, 'the follow-up render\'s move — fails without the release\'s extra frame').toEqual([{ pointer: false }, { pointer: false }]);
      expect(state.takeDropFocus('stat')).toBeNull();
    });

    it('a transition running when the moves come holds them, and the release waits behind them in the same queue', async () => {
      drop();
      await vi.advanceTimersByTimeAsync(50);
      commit();
      transition('transitionrun'); // the sheet's dimming, say
      for (let i = 0; i < 10; i++) frame();
      expect(moves, 'React Aria\'s move waits for the transition').toEqual([]);
      expect(state.dropGuarded(), 'and so does the release').toBe(true);
      expect(state.takeDropFocus('stat')).not.toBeNull();
      transition('transitionend');
      expect(moves).toEqual([{ pointer: false }]);
      expect(state.dropGuarded()).toBe(false);
      expect(state.takeDropFocus('stat')).toBeNull();
    });

    it('a mouse drop: no ring and no scroll up to the release', async () => {
      state.setPointerDrop(true);
      drop();
      await vi.advanceTimersByTimeAsync(50);
      commit();
      frame();
      expect(state.takeDropFocus('stat')).toEqual({ pointer: true });
      frame();
      expect(state.takeDropFocus('stat')).toBeNull();
      state.setPointerDrop(false);
    });

    it('a release from an earlier drop does not end a later drop\'s guard, nor a later drag\'s hover', async () => {
      state.armDropFocus('stat');
      await vi.advanceTimersByTimeAsync(25);
      state.clearDropFocus(); // the next input
      state.armDropFocus('bio'); // a second drop
      await vi.advanceTimersByTimeAsync(25); // the first drop's wait ends
      commit();
      frame();
      frame();
      expect(state.takeDropFocus('chem')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(25);
      commit();
      frame();
      frame();
      expect(state.takeDropFocus('chem')).toBeNull();
      expect(state.takeDropFocus('bio')).toBeNull();
      // A new drag is over a row when the last drop's release comes: the hover's guard stays.
      state.armDropFocus('stat');
      state.beginItems(['a']);
      state.hoverDropFocus('bio');
      await vi.advanceTimersByTimeAsync(50);
      commit();
      frame();
      frame();
      expect(state.takeDropFocus('bio')).not.toBeNull();
      state.end();
    });

    it('a sidebar that goes before its render runs the release at once', async () => {
      state.setAfterRender(null);
      drop();
      await vi.advanceTimersByTimeAsync(50);
      frame();
      frame();
      expect(state.takeDropFocus('stat')).toBeNull();
    });
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
