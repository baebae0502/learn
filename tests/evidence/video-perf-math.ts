// The arithmetic of video-perf.json (M8a spec 14), apart from the app so it is unit-tested.

/** A video frame the page was told of (requestVideoFrameCallback): when the callback ran and the media time of the frame. */
export interface VideoFrame {
  now: number;
  mediaTime: number;
}
/** A change of the overlay's text as the page saw it (MutationObserver): when, and what it said then. */
export interface OverlayChange {
  at: number;
  text: string;
}
export interface CueStart {
  startMs: number;
  /** A start of the cue's text that no other cue's overlay begins with. */
  lead: string;
}

/**
 * For each cue, how long after the first video frame whose media time reached its start the overlay's DOM said the cue's text (ms; negative
 * when it said it before that frame, as the clock-based update does). A cue with no such frame or no such change in the log is left out.
 */
export function cueSwitchLags(frames: readonly VideoFrame[], changes: readonly OverlayChange[], cues: readonly CueStart[]): number[] {
  const lags: number[] = [];
  for (const cue of cues) {
    const frame = frames.find((f) => f.mediaTime * 1000 >= cue.startMs);
    const change = changes.find((c) => c.text.startsWith(cue.lead));
    if (frame && change) lags.push(change.at - frame.now);
  }
  return lags;
}
