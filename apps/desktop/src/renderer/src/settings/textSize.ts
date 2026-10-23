import type { CommandContextState } from '@learn/domain';

export type TextSize = CommandContextState['textSize'];
/** A text size step as a function of the current size (⌘+ / ⌘− / ⌘0), so it composes with steps still on their way. */
export type TextSizeUpdate = (current: TextSize) => TextSize;

/**
 * ⌘+ / ⌘− / ⌘0 (review minor 6): each step is applied to the newest size — the last one asked for while its write is on
 * its way, else the confirmed pref — never to a value a render took before prefsChanged came back. Two quick ⌘+ from 13
 * ask for 14, then 15. A refused write is reported and the next step starts from the confirmed size.
 */
export function createTextSizeSetter(opts: { known(): TextSize; write(size: TextSize): Promise<unknown>; failed(error: unknown): void }) {
  let asked: TextSize | null = null;
  return (update: TextSizeUpdate): void => {
    const current = asked ?? opts.known();
    const next = update(current);
    if (next === current) return;
    asked = next;
    void opts
      .write(next)
      .catch(opts.failed)
      .finally(() => {
        if (asked === next) asked = null; // nothing newer on its way: the confirmed pref is the truth again
      });
  };
}
