import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { VIDEO_TIMING } from '@learn/domain';
import { t } from '../../strings';
import { cx } from '../../ui/cx';
import { formatClock, spokenClock } from './videoTime';
import { useVideo } from './videoStore';

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * The playback position (spec 6.2, role slider): the track is 4 high and 6 under the pointer or while dragged, the knob 12 and 14.
 * A press seeks where it lands; a drag only moves the preview and seeks when it is let go, so a slow disk is not asked for every pixel.
 * The slider's own keys (← → 5 s, PageUp PageDown 10 s, Home End) are handled here; the keymap yields to a focused slider.
 */
export function Scrubber() {
  const status = useVideo((s) => s.status);
  const timeMs = useVideo((s) => s.timeMs);
  const durationMs = useVideo((s) => s.durationMs);
  const bufferedMs = useVideo((s) => s.bufferedMs);
  const handle = useVideo((s) => s.handle);
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [keyFocus, setKeyFocus] = useState(false);
  const enabled = status === 'ready' && durationMs > 0;

  const fractionAt = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect();
    return r.width > 0 ? clamp01((clientX - r.left) / r.width) : 0;
  };
  const shown = drag !== null ? drag * durationMs : timeMs;
  const playedFrac = durationMs > 0 ? clamp01(shown / durationMs) : 0;
  const bufferedFrac = durationMs > 0 ? clamp01(bufferedMs / durationMs) : 0;
  const bubbleFrac = drag ?? hover ?? (keyFocus ? playedFrac : null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(fractionAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const f = fractionAt(e.clientX);
    setHover(f);
    if (drag !== null) setDrag(f);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const f = fractionAt(e.clientX);
    setDrag(null);
    handle?.seekTo(Math.round(f * durationMs));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = VIDEO_TIMING.skipShortMs;
    const big = VIDEO_TIMING.skipLongMs;
    const by = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'PageDown' ? -big : e.key === 'PageUp' ? big : null;
    if (by !== null) handle?.seekBy(by);
    else if (e.key === 'Home') handle?.seekTo(0);
    else if (e.key === 'End') handle?.seekTo(durationMs);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={cx('scrubber', bubbleFrac !== null && 'is-hover', drag !== null && 'is-dragging')}
      role="slider"
      tabIndex={enabled ? 0 : -1}
      aria-label={t.video.scrubber}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationMs / 1000)}
      aria-valuenow={Math.round(shown / 1000)}
      aria-valuetext={`${spokenClock(shown)} / ${spokenClock(durationMs)}`}
      aria-disabled={enabled ? undefined : true}
      data-testid="video-scrubber"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      onFocus={(e) => setKeyFocus(e.currentTarget.matches(':focus-visible'))}
      onBlur={() => setKeyFocus(false)}
    >
      <div className="track">
        <span className="buffered" style={{ width: `${bufferedFrac * 100}%` }} />
        <span className="played" style={{ width: `${playedFrac * 100}%` }} />
        <span className="knob" style={{ left: `${playedFrac * 100}%` }} />
      </div>
      {enabled && hover !== null && drag === null && <span className="hover-pos" style={{ left: `${hover * 100}%` }} />}
      {enabled && bubbleFrac !== null && (
        <span className="hover-time num" style={{ left: `${bubbleFrac * 100}%` }} data-testid="video-hover-time" aria-hidden="true">
          {formatClock(bubbleFrac * durationMs, durationMs)}
        </span>
      )}
    </div>
  );
}
