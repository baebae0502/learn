import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_REQUEST_MS, usePanelFocusRequest } from './panelFocus';

afterEach(() => {
  usePanelFocusRequest.getState().done();
  vi.useRealTimers();
});

describe('the panel focus request (⌃⌘2)', () => {
  it('waits while nothing answers, and ends when the panel answers', () => {
    usePanelFocusRequest.getState().request();
    expect(usePanelFocusRequest.getState().pending).toBe(true);
    usePanelFocusRequest.getState().done();
    expect(usePanelFocusRequest.getState().pending).toBe(false);
  });
  it('ends by itself when the focus can never land, so a later mount of the panel does not take it unasked', () => {
    vi.useFakeTimers();
    usePanelFocusRequest.getState().request();
    vi.advanceTimersByTime(FOCUS_REQUEST_MS - 1);
    expect(usePanelFocusRequest.getState().pending).toBe(true);
    vi.advanceTimersByTime(1);
    expect(usePanelFocusRequest.getState().pending).toBe(false);
  });
  it('a new request starts the wait again, and an answered one leaves no timer to end the next', () => {
    vi.useFakeTimers();
    usePanelFocusRequest.getState().request();
    vi.advanceTimersByTime(FOCUS_REQUEST_MS - 10);
    usePanelFocusRequest.getState().request();
    vi.advanceTimersByTime(FOCUS_REQUEST_MS - 10);
    expect(usePanelFocusRequest.getState().pending).toBe(true);
    usePanelFocusRequest.getState().done();
    usePanelFocusRequest.getState().request();
    vi.advanceTimersByTime(20);
    expect(usePanelFocusRequest.getState().pending).toBe(true);
  });
});
