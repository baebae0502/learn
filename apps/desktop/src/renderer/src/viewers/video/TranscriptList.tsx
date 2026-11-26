import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { Cue } from '@learn/domain';
import { t } from '../../strings';
import { cx } from '../../ui/cx';
import { useReaderScope } from '../readerScope';
import { activeCues, cueIndexAt, type CueIndex } from './activeCues';
import { cursorAfter, segments } from './transcriptRows';
import { formatClock } from './videoTime';
import { patchTranscript, useVideo } from './videoStore';

/** What the pane asks of its list: the keyboard cursor row takes the focus (esc in the search field, ⌘F's way back). */
export interface TranscriptListHandle {
  focusCursor(): void;
}

/** A row's height before it is measured: one line of text under the time, with the row's padding. */
const ROW_ESTIMATE = 54;
const OVERSCAN = 8;
/** How many frames after a follow scroll its target is read again while the rows it passed are measured. */
const SETTLE_FRAMES = 40;
/** The list's own edge room, above the first row and below the last (the mockup's .transcript padding). */
const PAD_TOP = 4;
const PAD_BOTTOM = 8;
/** The most cues that can be on at once in a transcript: more than a screen shows is not a reading. */
const MAX_ACTIVE = 12;
const NONE: readonly number[] = [];
const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** The cues on at the playhead and the last one that has started (past cues are the started ones that are not on), found in the index they were read from. */
interface Clock {
  ix: CueIndex | null;
  active: readonly number[];
  at: number;
}

function useCueClock(ix: CueIndex): Clock {
  const store = useReaderScope().video;
  const [clock, setClock] = useState<Clock>({ ix: null, active: NONE, at: -1 });
  useEffect(() => {
    let last = Number.NaN;
    const sync = () => {
      const ms = store.getState().timeMs;
      if (ms === last) return;
      last = ms;
      const active = activeCues(ix, ms, MAX_ACTIVE);
      const at = cueIndexAt(ix, ms);
      setClock((prev) => (prev.ix === ix && prev.at === at && sameList(prev.active, active) ? prev : { ix, active, at }));
    };
    sync();
    return store.subscribe(sync);
  }, [ix, store]);
  // What was found in an older index (one render behind a track switch) is not read through this one.
  return clock.ix === ix ? clock : { ix, active: NONE, at: -1 };
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface RowProps {
  cue: Cue;
  index: number;
  clockText: string;
  current: boolean;
  past: boolean;
  ranges: ReadonlyArray<readonly [number, number]> | undefined;
  matchCurrent: boolean;
  stop: boolean;
}

/** One sentence: its time over its text; the matches are marks, everything is a text node. */
const Row = memo(function Row({ cue, index, clockText, current, past, ranges, matchCurrent, stop }: RowProps) {
  return (
    <div
      role="option"
      aria-selected={false}
      aria-current={current ? 'true' : undefined}
      tabIndex={stop ? 0 : -1}
      className={cx('cue', current && 'is-current', past && 'is-past')}
      data-testid="cue-row"
      data-index={index}
      data-current={current ? 'true' : undefined}
    >
      <span className="ts num">{clockText}</span>
      <span className="tx">
        {segments(cue.text, ranges).map((s, i) =>
          s.match ? (
            <mark key={i} className={matchCurrent ? 'is-current' : undefined}>
              {s.text}
            </mark>
          ) : (
            s.text
          ),
        )}
      </span>
    </div>
  );
});

/**
 * The transcript's list (spec 7.2, 7.3): every sentence of the track, virtualised, rows of any height. The sentences on at the playhead are
 * current, the ones before are past. A press or ↩ on a row goes there; ↑↓ Home End PageUp PageDown move the cursor row, which is always drawn
 * so it keeps the focus. While `follow` is on the current sentence is kept in the upper third; a wheel, a drag of the bar or a scrolling key
 * of the list turns it off (our own scrolls never do: they are not those inputs).
 */
export function TranscriptList({ ix, ranges, hitIndex, handleRef }: { ix: CueIndex; ranges: ReadonlyMap<number, ReadonlyArray<readonly [number, number]>>; hitIndex: number; handleRef: RefObject<TranscriptListHandle | null> }) {
  const store = useReaderScope().video;
  const follow = useVideo((s) => s.transcript.follow);
  const cursor = useVideo((s) => s.transcript.cursor);
  const durationMs = useVideo((s) => s.durationMs);
  const clock = useCueClock(ix);
  const cues = ix.cues;
  const count = cues.length;
  const scroller = useRef<HTMLDivElement>(null);

  // The row that is the list's one tab stop: the cursor, before there is one the current sentence.
  const stop = cursor >= 0 && cursor < count ? cursor : Math.max(0, clock.at);
  // The stop row is always drawn, however far the view scrolled from it: a focused row that left the DOM would drop the focus to <body>.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const shown = defaultRangeExtractor(range);
      if (stop < range.count && !shown.includes(stop)) return [...shown, stop].sort((a, b) => a - b);
      return shown;
    },
    [stop],
  );
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
    rangeExtractor,
    paddingStart: PAD_TOP,
    paddingEnd: PAD_BOTTOM,
    scrollPaddingStart: PAD_TOP,
    scrollPaddingEnd: PAD_BOTTOM,
  });

  const clockWidth = Math.max(durationMs, count > 0 ? ix.maxEnd[count - 1]! : 0);
  const clockTexts = useMemo(() => cues.map((c) => formatClock(c.startMs, clockWidth)), [cues, clockWidth]);

  const wantFocus = useRef(false);
  const moveCursor = (to: number, focus: boolean) => {
    patchTranscript(store, { cursor: to });
    virtualizer.scrollToIndex(to, { align: 'auto' });
    wantFocus.current = focus;
  };
  // The cursor row takes the focus once it is drawn (it always is: it is the stop).
  useEffect(() => {
    if (!wantFocus.current || cursor < 0) return;
    const row = scroller.current?.querySelector<HTMLElement>(`[data-index="${cursor}"][role="option"]`);
    if (!row) return;
    wantFocus.current = false;
    row.focus({ preventScroll: true });
  });
  useImperativeHandle(handleRef, () => ({
    focusCursor: () => {
      const to = cursor >= 0 && cursor < count ? cursor : Math.max(0, clock.at);
      if (count > 0) moveCursor(to, true);
    },
  }));

  // A cursor moved from outside (a match ↩ went to) comes into view.
  const shownCursor = useRef(cursor);
  useEffect(() => {
    if (cursor === shownCursor.current) return;
    shownCursor.current = cursor;
    if (cursor >= 0 && cursor < count) virtualizer.scrollToIndex(cursor, { align: 'auto' });
  }, [cursor, count, virtualizer]);

  // The current sentence stays in the upper third while following; the first time (and a reduced-motion setting) it goes at once.
  const followed = useRef(false);
  useEffect(() => {
    const view = scroller.current;
    if (!follow || !view || clock.at < 0 || clock.at >= count) return;
    const instant = !followed.current || reducedMotion();
    followed.current = true;
    const top = () => Math.max(0, (virtualizer.measurementsCache[clock.at]?.start ?? 0) - view.clientHeight / 3);
    let target = top();
    const behavior = instant ? 'instant' : 'smooth';
    view.scrollTo({ top: target, behavior });
    // Rows above the sentence were only estimated: as they are measured its place moves, so the target is read again for a few frames
    // (a smooth scroll is given a new target, not stopped) until it stands still.
    let id = 0;
    let frames = 0;
    const settle = () => {
      const next = top();
      if (Math.abs(next - target) > 1) {
        target = next;
        view.scrollTo({ top: target, behavior });
      }
      if (++frames < SETTLE_FRAMES) id = requestAnimationFrame(settle);
    };
    id = requestAnimationFrame(settle);
    return () => cancelAnimationFrame(id);
  }, [follow, clock.at, count, virtualizer]);

  const stopFollowing = () => {
    if (store.getState().transcript.follow) patchTranscript(store, { follow: false });
  };
  const seekTo = (index: number) => {
    const cue = cues[index];
    if (cue) store.getState().handle?.seekTo(cue.startMs);
  };
  const rowOf = (target: EventTarget): number | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[role="option"]') : null;
    return el ? Number(el.dataset['index']) : null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const row = rowOf(e.target);
    if (e.key === 'Enter' || e.key === ' ') {
      if (row === null) return;
      e.preventDefault();
      seekTo(row);
      return;
    }
    const view = scroller.current;
    const page = Math.max(1, Math.floor((view?.clientHeight ?? ROW_ESTIMATE) / ROW_ESTIMATE) - 1);
    const to = cursorAfter(e.key, row ?? cursor, count, page);
    if (to === null) return;
    e.preventDefault();
    // The list scrolls to the cursor: a scroll the user asked for with a key.
    stopFollowing();
    moveCursor(to, true);
  };

  const items = virtualizer.getVirtualItems();
  return (
    <div
      ref={scroller}
      className="transcript"
      role="listbox"
      aria-label={t.video.transcript}
      data-testid="transcript"
      data-count={count}
      onWheel={stopFollowing}
      onTouchMove={stopFollowing}
      // A press on the bar itself (not on a row) is the bar's drag.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) stopFollowing();
      }}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        const row = rowOf(e.target);
        if (row !== null && row !== store.getState().transcript.cursor) patchTranscript(store, { cursor: row });
      }}
      onClick={(e) => {
        const row = rowOf(e.target);
        if (row === null) return;
        patchTranscript(store, { cursor: row });
        seekTo(row);
      }}
    >
      <div role="presentation" className="transcript-rows" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((item) => {
          const i = item.index;
          const cue = cues[i]!;
          const current = clock.active.includes(i);
          return (
            <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} role="presentation" className="transcript-slot" style={{ transform: `translateY(${item.start}px)` }}>
              <Row cue={cue} index={i} clockText={clockTexts[i]!} current={current} past={!current && i <= clock.at} ranges={ranges.get(i)} matchCurrent={i === hitIndex} stop={i === stop} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
