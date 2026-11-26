import { VIDEO_TIMING } from '@learn/domain';

const MIN_MS = 1000 / 120;
const MAX_MS = 1000 / 10;
/** Fewer frames than this say too little: the default step stands until a third has been shown. */
const MIN_FRAMES = 3;

/**
 * One frame of the video in ms, from the media times of the frames the player showed (requestVideoFrameCallback's
 * `mediaTime`): the middle of the positive gaps, so a repeated frame (gap 0), a seek (a negative gap) and one slow frame
 * do not move it. Kept within 120 and 10 frames a second; with too little to go on, the default step.
 */
export function frameDurationMs(mediaTimesSec: readonly number[]): number {
  if (mediaTimesSec.length < MIN_FRAMES) return VIDEO_TIMING.frameFallbackMs;
  const gaps: number[] = [];
  for (let i = 1; i < mediaTimesSec.length; i++) {
    const gap = (mediaTimesSec[i]! - mediaTimesSec[i - 1]!) * 1000;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return VIDEO_TIMING.frameFallbackMs;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.min(MAX_MS, Math.max(MIN_MS, median));
}
