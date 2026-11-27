// V/budget.ts
/** One measured value against its spec budget. */
export interface Limit {
  what: string;
  value: number;
  budget: number;
  /** The value's unit in the failure line; 'ms' when absent (a rate says '/s'). */
  unit?: string;
}

/**
 * The Linux CI rule (spec 1 condition 2, spec 12; M6 spec 1 condition 5): a value fails beyond `factor` times its budget.
 * Every failure is returned, not the first, so one run shows which measurements went over.
 */
export function limitFailures(limits: readonly Limit[], factor = 2): string[] {
  return limits
    .filter((l) => l.value > factor * l.budget)
    .map((l) => {
      const unit = l.unit ?? 'ms';
      return `${l.what}: ${l.value} ${unit} against the Linux CI limit ${factor * l.budget} ${unit} (budget ${l.budget} ${unit})`;
    });
}

/**
 * M8a spec 14, the video's lines (video-perf.json); ms. The transcript's scroll and the playing list with the overlay are p95 of the frame
 * gap (one 60 Hz frame); the cue switch is the p95 lag, at 1×, from the video frame that crossed a cue's start to the start of the frame that paints the
 * overlay's DOM change (one frame); the search is the p95 from the search starting (the debounce over) to the frame that paints its matches.
 */
export const VIDEO_BUDGET_MS = { transcriptScrollP95: 16.7, playingFollowP95: 16.7, cueSwitchP95: 16.7, transcriptSearchP95: 50 } as const;

const VIDEO_WHAT: Record<keyof typeof VIDEO_BUDGET_MS, string> = {
  transcriptScrollP95: 'transcript scroll frame gap p95 (2,000 cues, follow off)',
  playingFollowP95: 'frame gap p95 while playing at 2× for 20 s (follow on, overlay on)',
  cueSwitchP95: 'cue switch → overlay text painted p95 (40 cues, 1×)',
  transcriptSearchP95: 'transcript search → matches painted p95 (2,000 cues)',
};

export function videoLimits(values: Readonly<Record<keyof typeof VIDEO_BUDGET_MS, number>>): Limit[] {
  return (Object.keys(VIDEO_BUDGET_MS) as Array<keyof typeof VIDEO_BUDGET_MS>).map((k) => ({ what: VIDEO_WHAT[k], value: values[k], budget: VIDEO_BUDGET_MS[k] }));
}
