import type { Cue } from '@learn/domain';

export interface CueIndex {
  /** In start order. */
  cues: readonly Cue[];
  /** maxEnd[i] is the latest end of cues[0..i]: where a look back for cues still on can stop. */
  maxEnd: Float64Array;
}

/** A track's cues ready to be looked up at a time (once per track, not per frame). */
export function indexCues(cues: readonly Cue[]): CueIndex {
  let sorted = true;
  for (let i = 1; i < cues.length; i++) {
    if (cues[i]!.startMs < cues[i - 1]!.startMs) {
      sorted = false;
      break;
    }
  }
  // Array.prototype.sort is stable: cues that start together keep the file's order.
  const list = sorted ? cues : [...cues].sort((a, b) => a.startMs - b.startMs);
  const maxEnd = new Float64Array(list.length);
  let top = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < list.length; i++) {
    top = Math.max(top, list[i]!.endMs);
    maxEnd[i] = top;
  }
  return { cues: list, maxEnd };
}

/** The last cue that has started at `ms` (start ≤ ms), -1 before the first. */
export function cueIndexAt(ix: CueIndex, ms: number): number {
  let lo = 0;
  let hi = ix.cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ix.cues[mid]!.startMs <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * The cues on screen at `ms` (start ≤ ms < end), in start order; when more than `max` overlap, the last ones (spec 6.4). Looks back
 * from the last cue that has started only as far as a cue can still be on.
 */
export function activeCues(ix: CueIndex, ms: number, max = 3): number[] {
  const found: number[] = [];
  for (let i = cueIndexAt(ix, ms); i >= 0 && found.length < max && ix.maxEnd[i]! > ms; i--) {
    if (ix.cues[i]!.endMs > ms) found.push(i);
  }
  return found.reverse();
}
