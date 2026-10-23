import { useEffect, useState } from 'react';
import { dayKey, msUntilMidnight } from './format';

/** Where a returning user shows up: window focus and the document becoming visible again. */
export interface DayWatchTargets {
  win: EventTarget;
  doc: EventTarget & { readonly visibilityState: string };
}

/**
 * Calls `onDay(now)` once, when the local calendar day is no longer the day of `start`: at the next midnight (+1 s of
 * slack), or on focus / becoming visible after a sleep, a clock change or a time zone change that a timer cannot see.
 * Focus on the same day changes nothing. Returns the stop function; the caller watches again from the new day.
 */
export function watchDay(start: Date, onDay: (now: Date) => void, targets: DayWatchTargets): () => void {
  const day = dayKey(start);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    const now = new Date();
    if (dayKey(now) === day) return arm(now);
    stop();
    onDay(now);
  };
  const arm = (from: Date) => {
    clearTimeout(timer);
    timer = setTimeout(check, msUntilMidnight(from) + 1000);
  };
  const onVisibility = () => {
    if (targets.doc.visibilityState !== 'hidden') check();
  };
  const stop = () => {
    clearTimeout(timer);
    targets.win.removeEventListener('focus', check);
    targets.doc.removeEventListener('visibilitychange', onVisibility);
  };
  arm(start);
  targets.win.addEventListener('focus', check);
  targets.doc.addEventListener('visibilitychange', onVisibility);
  return stop;
}

/** The current time, renewed whenever the local day changes: relative dates ("오늘 오전 9:24", "어제 …") move on. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => watchDay(now, setNow, { win: window, doc: document }), [now]);
  return now;
}
