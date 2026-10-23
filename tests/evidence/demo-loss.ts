/**
 * When a demo recording is lost (re-review I1, m1). A lost recording sends the demo into its next attempt, and the
 * last attempt's loss fails the test: a run can never pass with no video, or with a video that misses part of the demo.
 */

/** The attempt's recording was lost: thrown at the demo's next step (chapter, pause) and caught by the attempt. */
export class RecordingLost extends Error {
  override name = 'RecordingLost';
}

/** What a recording ended with (capture.ts ManifestEntry). */
export interface RecordingEnd {
  file: string | null;
  skipped?: string;
  error?: string;
}

const lastLine = (text: string | undefined) => (text ?? 'no error').trim().split('\n').at(-1) || 'no error';
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));

/**
 * screencapture has exited: lost when the demo had not ended yet, whether it left no file or a partial one (a video
 * that stops before the last chapter has ended is a lost demo). Null once the demo is over (the rest is the fixed
 * length's tail).
 */
export function exitedEarly(o: { afterSeconds: number; demoEnded: boolean; end: RecordingEnd }): string | null {
  if (o.demoEnded) return null;
  const left = o.end.file ? 'a partial file' : 'no file';
  return `screencapture ended after ${o.afterSeconds.toFixed(1)} s, before the demo's end, with ${left} (${lastLine(o.end.error)})`;
}

/**
 * The attempt's recording as it ended: the loss, or null when it is whole. `end` null: no recording was started (the
 * attempt failed before it; that error is the result). A skipped one (no recorder on this platform: Linux CI) is no
 * loss. Any recorder that ends without a file is: a screencast that received no frames, an x11grab that wrote none.
 */
export function recordingLoss(o: { capture: string; end: RecordingEnd | null; early: string | null }): string | null {
  if (o.early) return o.early;
  if (o.end === null || o.end.skipped) return null;
  if (!o.end.file) return `the ${o.capture} recording left no file (${lastLine(o.end.error)})`;
  return null;
}

/**
 * The error that ended an attempt, as a loss: a RecordingLost, or any error thrown while a loss was pending (the lost
 * capture can make a step fail before the next check; re-review m1). Null: a real failure, to be rethrown.
 */
export function lossOf(e: unknown, pending: string | null): string | null {
  if (e instanceof RecordingLost) return e.message;
  if (pending) return `${pending}; a step then failed: ${errorText(e)}`;
  return null;
}
