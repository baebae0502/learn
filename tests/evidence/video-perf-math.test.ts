import { describe, expect, it } from 'vitest';
import { cueSwitchLags } from './video-perf-math';

describe('cueSwitchLags', () => {
  const cues = [
    { startMs: 1500, lead: '2번째' },
    { startMs: 3000, lead: '3번째' },
  ];
  const frames = [
    { now: 100, mediaTime: 1.45 },
    { now: 117, mediaTime: 1.5 },
    { now: 134, mediaTime: 1.55 },
    { now: 250, mediaTime: 3.0 },
  ];
  it('measures from the first frame at or past the start to the change that says the cue', () => {
    const changes = [
      { at: 90, text: '1번째 문장' },
      { at: 121, text: '2번째 문장' },
      { at: 262, text: '3번째 문장' },
    ];
    expect(cueSwitchLags(frames, changes, cues)).toEqual([4, 12]);
  });
  it('is negative when the overlay changed before the frame did', () => {
    expect(cueSwitchLags(frames, [{ at: 110, text: '2번째 문장' }], cues)).toEqual([-7]);
  });
  it('leaves out a cue that has no frame or no change', () => {
    expect(cueSwitchLags(frames, [{ at: 121, text: '2번째 문장' }], cues)).toEqual([4]);
    expect(cueSwitchLags([{ now: 100, mediaTime: 1.0 }], [{ at: 121, text: '2번째 문장' }], cues)).toEqual([]);
  });
});
