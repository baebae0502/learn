import { useEffect, useReducer } from 'react';
import { afterPaint, afterPaintOr } from '../ui/afterPaint';
import { perfMark } from '../ui/perfMarks';

/** design-spec 6: work shorter than this shows nothing. Counted from the first painted frame of the busy screen. */
export const BUSY_DELAY_MS = 300;
/** Once "자료 N개를 가져오는 중…" is on screen it stays at least this long: never a flash (Mac run 3, critique n6). */
export const BUSY_MIN_MS = 300;

/**
 * The empty library's busy screen while a drop brings files in (T13R2-m1), as a state machine:
 * - `quiet`: the screen is up with nothing on it (no empty-library buttons, no text) for the first BUSY_DELAY_MS;
 * - `text`: the spinner and "자료 N개를 가져오는 중…", once the import is still running then;
 * - once the text has been painted it holds the screen for BUSY_MIN_MS, even when the rows or the end come sooner.
 */
export interface BusyState {
  count: number;
  phase: 'quiet' | 'text';
  /** performance.now() of the text's first painted frame. */
  textAt: number | null;
  /** The import is still running with the list empty. */
  active: boolean;
  /** The text has been up BUSY_MIN_MS. */
  minDone: boolean;
}
export type BusyEvent =
  | { type: 'start'; count: number }
  | { type: 'delayDone' }
  | { type: 'textPainted'; at: number }
  | { type: 'minDone' }
  | { type: 'end' };

export function busyReducer(s: BusyState | null, e: BusyEvent): BusyState | null {
  switch (e.type) {
    case 'start':
      return { count: e.count, phase: 'quiet', textAt: null, active: true, minDone: false };
    case 'delayDone':
      return s && s.active && s.phase === 'quiet' ? { ...s, phase: 'text' } : s;
    case 'textPainted':
      return s && s.phase === 'text' && s.textAt === null ? { ...s, textAt: e.at } : s;
    case 'minDone':
      return s ? (s.active ? { ...s, minDone: true } : null) : s;
    case 'end':
      return !s || s.phase === 'quiet' || s.minDone ? null : { ...s, active: false };
  }
}

/** What the screen shows: null when it is not up; `holding` while it must stay up although the import has moved on. */
export interface BusyScreen {
  count: number;
  text: boolean;
  holding: boolean;
}
export const busyScreen = (s: BusyState | null): BusyScreen | null =>
  s ? { count: s.count, text: s.phase === 'text', holding: s.phase === 'text' && !s.minDone } : null;

/** While the text holds the screen: resolved when it lets go (the import's success toast waits for it). */
let held: { promise: Promise<void>; release: () => void } | null = null;
function setHeld(holding: boolean): void {
  if (holding && !held) {
    let release = () => {};
    const promise = new Promise<void>((resolve) => (release = resolve));
    held = { promise, release };
  } else if (!holding && held) {
    held.release();
    held = null;
  }
}
/**
 * Resolves once the busy screen no longer holds the rows back: the success toast never says "가져왔습니다" over a
 * screen that still says "가져오는 중…".
 */
export const busyScreenSettled = (): Promise<void> => held?.promise ?? Promise.resolve();

/**
 * `count`: the files a drop into the empty library brings in while that import runs with the list still empty; null
 * otherwise (no import, a dialog import, or the rows have come).
 */
export function useBusyScreen(count: number | null): BusyScreen | null {
  const [s, dispatch] = useReducer(busyReducer, null);
  useEffect(() => {
    if (count === null) {
      dispatch({ type: 'end' });
      return;
    }
    dispatch({ type: 'start', count });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = afterPaintOr(BUSY_DELAY_MS, () => (timer = setTimeout(() => dispatch({ type: 'delayDone' }), BUSY_DELAY_MS)));
    return () => {
      cancel();
      clearTimeout(timer);
    };
  }, [count]);
  const text = s?.phase === 'text';
  const textAt = s?.textAt ?? null;
  useEffect(() => {
    if (!text || textAt !== null) return;
    return afterPaint(() => {
      perfMark('import:busy-text');
      dispatch({ type: 'textPainted', at: performance.now() });
    });
  }, [text, textAt]);
  useEffect(() => {
    if (textAt === null) return;
    const timer = setTimeout(() => dispatch({ type: 'minDone' }), Math.max(0, textAt + BUSY_MIN_MS - performance.now()));
    return () => clearTimeout(timer);
  }, [textAt]);
  const screen = busyScreen(s);
  const holding = screen?.holding ?? false;
  useEffect(() => setHeld(holding), [holding]);
  useEffect(() => () => setHeld(false), []);
  return screen;
}
