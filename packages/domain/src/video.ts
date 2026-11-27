/** The video reader's speeds (spec 6.2): ⇧, and ⇧. move one step, and nothing in between is offered. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
export const RATE_STEP = 0.25;

/**
 * controlsIdleMs: a still pointer hides the stage's controls after this long (spec 6.6). stageSettleMs: how long main waits
 * for a full-screen change it asked for before it asks again or believes the window (video-stage.ts). frameFallbackMs: one
 * frame step when the video does not say its frame rate. skipShortMs / skipLongMs: ← → and J L.
 */
export const VIDEO_TIMING = { controlsIdleMs: 2000, stageSettleMs: 2000, frameFallbackMs: 1000 / 30, skipShortMs: 5000, skipLongMs: 10000 } as const;

export const isPlaybackRate = (n: number): n is PlaybackRate => (PLAYBACK_RATES as readonly number[]).includes(n);
