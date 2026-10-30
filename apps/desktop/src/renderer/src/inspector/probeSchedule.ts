import type { FileFacts, Probe } from './fileFacts';

/**
 * How long a selection must stay on an item before its file is read for the page count or the length (spec 6.4): a row
 * passed with the arrow keys is not worth opening a PDF for.
 */
export const PROBE_DELAY_MS = 150;

/**
 * Starts the probe `start` makes once `delayMs` has passed and hands its facts on. The returned function ends whichever
 * stage it finds: before the delay nothing was opened, after it the read is cancelled and its answer dropped.
 */
export function scheduleProbe(delayMs: number, start: () => Probe, onFacts: (facts: FileFacts) => void): () => void {
  let probe: Probe | null = null;
  let live = true;
  const timer = setTimeout(() => {
    probe = start();
    void probe.done.then((facts) => {
      if (live) onFacts(facts);
    });
  }, delayMs);
  return () => {
    live = false;
    clearTimeout(timer);
    probe?.cancel();
  };
}

/** `scheduleProbe` for a panel that may not need the fact now (several items selected): a disabled one starts nothing. */
export function scheduleProbeWhen(enabled: boolean, delayMs: number, start: () => Probe, onFacts: (facts: FileFacts) => void): () => void {
  return enabled ? scheduleProbe(delayMs, start, onFacts) : () => {};
}
