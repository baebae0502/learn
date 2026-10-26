import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmUp } from './warmUp';

// A document with just what warmUp touches: createElement, a body to append to, and an element that knows it was removed.
function fakeDoc() {
  const appended: FakeEl[] = [];
  interface FakeEl {
    className: string;
    textContent: string;
    children: FakeEl[];
    removed: number;
    setAttribute: (k: string, v: string) => void;
    append: (...c: FakeEl[]) => void;
    remove: () => void;
  }
  const el = (): FakeEl => ({
    className: '',
    textContent: '',
    children: [],
    removed: 0,
    setAttribute() {},
    append(...c) {
      this.children.push(...c);
    },
    remove() {
      this.removed++;
    },
  });
  const doc = { createElement: () => el(), body: { append: (e: FakeEl) => appended.push(e) } };
  return { doc: doc as unknown as Document, appended };
}

let frames: Array<() => void>;
const flushFrame = () => frames.splice(0).forEach((cb) => cb());

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('warmUp', () => {
  it('adds one probe, and removes it after the frame that painted it', () => {
    const { doc, appended } = fakeDoc();
    warmUp(doc);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.children.length).toBeGreaterThan(0);
    flushFrame();
    expect(appended[0]!.removed).toBe(0);
    flushFrame();
    expect(appended[0]!.removed).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(appended[0]!.removed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes it after 1 s where no frames come', () => {
    const { doc, appended } = fakeDoc();
    warmUp(doc);
    vi.advanceTimersByTime(999);
    expect(appended[0]!.removed).toBe(0);
    vi.advanceTimersByTime(1);
    expect(appended[0]!.removed).toBe(1);
  });

  it('removes it and leaves no timer when cancelled while it is still in place', () => {
    const { doc, appended } = fakeDoc();
    const cancel = warmUp(doc);
    flushFrame();
    cancel();
    expect(appended[0]!.removed).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBe(0);
    const removedAt = appended[0]!.removed;
    flushFrame();
    vi.advanceTimersByTime(5000);
    expect(appended[0]!.removed).toBe(removedAt);
  });
});
