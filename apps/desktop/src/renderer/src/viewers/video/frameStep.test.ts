import { describe, expect, it } from 'vitest';
import { VIDEO_TIMING } from '@learn/domain';
import { frameDurationMs } from './frameStep';

const at = (fps: number, n: number, start = 10): number[] => Array.from({ length: n }, (_, i) => start + i / fps);

describe('frameDurationMs (the frame step is estimated from the frames the player showed)', () => {
  it('takes the middle gap of twelve 30 fps frames', () => {
    expect(frameDurationMs(at(30, 12))).toBeCloseTo(33.33, 1);
  });
  it('falls back to the default below three frames', () => {
    expect(frameDurationMs(at(30, 2))).toBeCloseTo(VIDEO_TIMING.frameFallbackMs, 5);
    expect(frameDurationMs([])).toBeCloseTo(VIDEO_TIMING.frameFallbackMs, 5);
  });
  it('ignores a zero gap (the same frame reported twice) and a backward step (a seek)', () => {
    expect(frameDurationMs([1, 1, 1 + 1 / 25, 1 + 2 / 25, 1 + 2 / 25, 1 + 3 / 25])).toBeCloseTo(40, 1);
    expect(frameDurationMs([5, 5.04, 5.08, 1, 1.04, 1.08])).toBeCloseTo(40, 1);
  });
  it('falls back when no gap is positive', () => {
    expect(frameDurationMs([2, 2, 2])).toBeCloseTo(VIDEO_TIMING.frameFallbackMs, 5);
  });
  it('clamps to 1000/120 .. 1000/10 ms', () => {
    expect(frameDurationMs(at(1, 5))).toBe(100);
    expect(frameDurationMs(at(1000, 5))).toBeCloseTo(1000 / 120, 5);
  });
  it('is robust to one slow frame among steady ones (the middle value, not the mean)', () => {
    const times = [...at(30, 6), 10 + 5 / 30 + 0.5, 10 + 5 / 30 + 0.5 + 1 / 30];
    expect(frameDurationMs(times)).toBeCloseTo(33.33, 1);
  });
});
