import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dragState } from './dragState';
import { installDndEvents } from './events';

type Handler = (e: unknown) => void;

describe('installDndEvents: the drag leaving the window', () => {
  let handlers: Record<string, Handler>;
  let remove: () => void;
  let marked: { dispatchEvent: (e: unknown) => void; closest: () => null; querySelectorAll: () => never[] }[];

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = {};
    const win = { addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn), removeEventListener: () => {} };
    // The sweep's own events travel through the window like any other dragleave, untrusted.
    marked = [1, 2, 3].map(() => ({
      dispatchEvent: (e) => handlers.dragleave!(e),
      closest: () => null,
      querySelectorAll: () => [],
    }));
    vi.stubGlobal('DragEvent', class { isTrusted = false; relatedTarget = null; constructor(public type: string) {} });
    vi.stubGlobal('document', { querySelectorAll: () => marked });
    remove = installDndEvents(win as unknown as Window);
  });
  afterEach(() => {
    remove();
    dragState.setFilesOver(false);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const files = { dataTransfer: { types: ['Files'] }, altKey: false };

  it('a sweep leaves no timer behind, so a drag that starts right after it keeps its marks', () => {
    handlers.dragenter!(files);
    handlers.dragleave!({ relatedTarget: null, isTrusted: true });
    vi.advanceTimersByTime(150); // the sweep runs: three synthetic dragleaves
    expect(vi.getTimerCount(), 'the sweep arms nothing').toBe(0);
    handlers.dragenter!(files); // a fresh Finder drag
    expect(dragState.filesOver()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(dragState.filesOver(), 'no orphan timer ends the new drag').toBe(true);
  });

  it('two real leaves in a row keep one timer', () => {
    handlers.dragleave!({ relatedTarget: null, isTrusted: true });
    handlers.dragleave!({ relatedTarget: null, isTrusted: true });
    expect(vi.getTimerCount()).toBe(1);
  });
});
