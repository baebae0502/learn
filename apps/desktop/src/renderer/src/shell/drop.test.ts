import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DROP_IDLE_MS, dropSummaryText, guardDocumentDrops, summarizeDrop, windowDropTarget, type DropState, type FileDrag } from './drop';

const f = (type: string) => ({ kind: 'file', type });

describe('drop summary (design-spec 6 드롭 오버레이)', () => {
  it('counts files by kind', () => {
    expect(summarizeDrop([f('application/pdf'), f('application/pdf'), f('video/mp4'), { kind: 'string', type: 'text/uri-list' }])).toEqual({ files: 3, pdf: 2, video: 1, other: 0 });
  });
  it('writes "파일 3개(PDF 2 · 동영상 1)" and names other files only next to known kinds', () => {
    expect(dropSummaryText({ files: 3, pdf: 2, video: 1, other: 0 })).toBe('파일 3개(PDF 2 · 동영상 1)');
    expect(dropSummaryText({ files: 4, pdf: 2, video: 1, other: 1 })).toBe('파일 4개(PDF 2 · 동영상 1 · 기타 1)');
    expect(dropSummaryText({ files: 2, pdf: 0, video: 0, other: 2 })).toBe('파일 2개');
  });
});

/** An element the drag passes over; `isConnected` turns false when it leaves the document. */
const el = () => ({ isConnected: true }) as unknown as EventTarget & { isConnected: boolean };
const file = (name: string, type = 'application/pdf') => ({ name, type }) as File;
/** A drag event as the handlers read it; the files' paths are what webUtils.getPathForFile returns (PATHS). */
function drag(opts: { target?: EventTarget; altKey?: boolean; types?: string[]; files?: File[] } = {}) {
  const files = opts.files ?? [file('a.pdf')];
  const dataTransfer = { types: opts.types ?? ['Files'], items: files.map((x) => ({ kind: 'file', type: x.type })), files, dropEffect: 'none' };
  const e: FileDrag = { target: opts.target ?? null, altKey: opts.altKey ?? false, dataTransfer, preventDefault: vi.fn() };
  return e;
}
const PATHS: Record<string, string> = { 'a.pdf': '/Users/me/a.pdf', 'b.mp4': '/Users/me/b.mp4', 'synthetic.pdf': '' };

function setup(idleMs?: number) {
  const shown: Array<DropState | null> = [];
  const entered = vi.fn();
  const onDrop = vi.fn();
  const target = windowDropTarget({ show: (s) => shown.push(s), entered, drop: onDrop, pathForFile: (x) => PATHS[x.name] ?? '', idleMs });
  const last = () => shown.at(-1) ?? null;
  return { target, shown, last, entered, onDrop };
}

describe('window drop target (design-spec 7.2: copy, ⌥ = link)', () => {
  it('a file drag coming in shows the overlay with the counts and the mode, and says so once (the palette closes)', () => {
    const { target, last, entered } = setup();
    const content = el();
    target.enter(drag({ target: content, files: [file('a.pdf'), file('b.mp4', 'video/mp4')] }));
    expect(last()).toEqual({ link: false, summary: { files: 2, pdf: 1, video: 1, other: 0 } });
    // Moving onto the overlay (a new element) is not a new drag.
    target.enter(drag({ target: el() }));
    target.leave(drag({ target: content }));
    expect(entered).toHaveBeenCalledTimes(1);
    expect(last()).toEqual({ link: false, summary: { files: 2, pdf: 1, video: 1, other: 0 } });
  });

  it('⌥ held at the start, or pressed and released on the way, switches the mode at once', () => {
    const { target, last, shown } = setup();
    target.enter(drag({ target: el(), altKey: true }));
    expect(last()?.link).toBe(true);
    const over = drag({ altKey: false });
    target.over(over);
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer!.dropEffect).toBe('copy');
    expect(last()?.link).toBe(false);
    const link = drag({ altKey: true });
    target.over(link);
    expect(link.dataTransfer!.dropEffect).toBe('link');
    expect(last()?.link).toBe(true);
    const count = shown.length;
    target.over(drag({ altKey: true })); // dragover repeats every few ms: no new state without a change
    expect(shown).toHaveLength(count);
  });

  it('hides only when the drag has left every element it entered (or the elements left the document)', () => {
    const { target, last } = setup();
    const content = el();
    const overlay = el();
    target.enter(drag({ target: content }));
    target.enter(drag({ target: overlay }));
    target.leave(drag({ target: content }));
    expect(last()).not.toBeNull();
    target.leave(drag({ target: overlay }));
    expect(last()).toBeNull();
    // The palette's scrim takes the first dragenter and is gone when the palette closes: no dragleave reaches us for it.
    const scrim = el();
    target.enter(drag({ target: scrim }));
    scrim.isConnected = false;
    target.enter(drag({ target: overlay }));
    target.leave(drag({ target: overlay }));
    expect(last()).toBeNull();
  });

  it('a dragover without a dragenter (enabled during the drag) still shows the overlay', () => {
    const { target, last, entered } = setup();
    target.over(drag({ target: el(), altKey: true }));
    expect(last()).toEqual({ link: true, summary: { files: 1, pdf: 1, video: 0, other: 0 } });
    expect(entered).toHaveBeenCalledTimes(1);
  });

  it('a plain drop imports copies, a drop with ⌥ links; the overlay goes', () => {
    const { target, last, onDrop } = setup();
    target.enter(drag({ target: el() }));
    target.drop(drag({ files: [file('a.pdf'), file('b.mp4', 'video/mp4')] }));
    expect(last()).toBeNull();
    target.drop(drag({ altKey: true }));
    expect(onDrop.mock.calls).toEqual([
      [['/Users/me/a.pdf', '/Users/me/b.mp4'], 'managed', 0],
      [['/Users/me/a.pdf'], 'linked', 0],
    ]);
    // The next drag starts from nothing.
    target.enter(drag({ target: el() }));
    expect(last()).not.toBeNull();
  });

  it('counts the files whose location cannot be read', () => {
    const { target, onDrop } = setup();
    target.drop(drag({ files: [file('a.pdf'), file('synthetic.pdf')] }));
    target.drop(drag({ files: [file('synthetic.pdf')] }));
    expect(onDrop.mock.calls).toEqual([
      [['/Users/me/a.pdf'], 'managed', 1],
      [[], 'managed', 1],
    ]);
  });

  it('ignores drags that carry no files (text, links), so they keep their default handling', () => {
    const { target, shown, entered, onDrop } = setup();
    const text = drag({ target: el(), types: ['text/plain'] });
    target.enter(text);
    target.over(text);
    target.leave(text);
    target.drop(text);
    expect(text.preventDefault).not.toHaveBeenCalled();
    expect(text.dataTransfer!.dropEffect).toBe('none');
    const none: FileDrag = { target: null, altKey: false, dataTransfer: null, preventDefault: vi.fn() };
    target.enter(none);
    target.drop(none);
    expect(shown).toEqual([]);
    expect(entered).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('reset (disabled, unmounted) hides the overlay and forgets the drag', () => {
    const { target, last } = setup();
    const content = el();
    target.enter(drag({ target: content }));
    target.reset();
    expect(last()).toBeNull();
    target.enter(drag({ target: el() }));
    target.leave(drag({ target: content })); // an element from before the reset
    expect(last()).not.toBeNull();
  });
});

describe('safety net: the opaque overlay never outlives the drag (review minor 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes when no dragover has come for a second; every dragover re-arms the timer', () => {
    expect(DROP_IDLE_MS).toBe(1000);
    const { target, last } = setup();
    target.enter(drag({ target: el() }));
    vi.advanceTimersByTime(900);
    target.over(drag());
    vi.advanceTimersByTime(900);
    expect(last()).not.toBeNull();
    // A drag cancelled outside the window whose dragleave never came: the dragovers stop.
    vi.advanceTimersByTime(100);
    expect(last()).toBeNull();
    // The drag was still there after all: the next dragover brings the overlay back at once, and a drop still imports.
    target.over(drag({ target: el(), altKey: true }));
    expect(last()?.link).toBe(true);
  });

  it('a short injected timeout; a timer left from a drag that ended does nothing', () => {
    const { target, shown, onDrop } = setup(50);
    target.enter(drag({ target: el() }));
    vi.advanceTimersByTime(49);
    expect(shown.at(-1)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(shown.at(-1)).toBeNull();
    // Ended by a drop, by the last dragleave or by reset: the overlay went then, and nothing fires later.
    const content = el();
    target.enter(drag({ target: content }));
    target.drop(drag());
    target.enter(drag({ target: content }));
    target.leave(drag({ target: content }));
    target.enter(drag({ target: content }));
    target.reset();
    const count = shown.length;
    vi.advanceTimersByTime(1000);
    expect(shown).toHaveLength(count);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});

describe('the document refuses drops nothing takes (review minor 2)', () => {
  /** The listeners guardDocumentDrops adds, by event type. */
  function guarded() {
    const listeners = new Map<string, (e: Event) => void>();
    guardDocumentDrops({ addEventListener: (type: string, fn: (e: Event) => void) => listeners.set(type, fn) } as unknown as Document);
    return (type: 'dragover' | 'drop', init: { defaultPrevented?: boolean; dropEffect?: string } = {}) => {
      const dataTransfer = { dropEffect: init.dropEffect ?? 'copy' };
      const e = { defaultPrevented: init.defaultPrevented ?? false, dataTransfer, preventDefault: vi.fn() };
      listeners.get(type)!(e as unknown as Event);
      return e;
    };
  }

  it('a dragover no drop target took shows "none" (the no-drop cursor on macOS), and nothing navigates the window', () => {
    const fire = guarded();
    const over = fire('dragover');
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe('none');
    const drop = fire('drop');
    expect(drop.preventDefault).toHaveBeenCalled();
  });

  it('a drop target inside the page that accepted the dragover keeps its own effect', () => {
    const fire = guarded();
    const taken = fire('dragover', { defaultPrevented: true, dropEffect: 'move' });
    expect(taken.dataTransfer.dropEffect).toBe('move');
  });
});
