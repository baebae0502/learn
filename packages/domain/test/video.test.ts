import { describe, expect, it } from 'vitest';
import { LearnError } from '../src/errors';
import { newId } from '../src/ids';
import { readingLocatorSchema } from '../src/reading';
import { SETTINGS, parseSetting } from '../src/settings';
import { PLAYBACK_RATES, RATE_STEP, VIDEO_TIMING, isPlaybackRate } from '../src/video';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof LearnError ? e.code : 'other';
  }
  return undefined;
};

describe('playback rates', () => {
  it('are the seven steps from 0.5 to 2, a quarter apart', () => {
    expect(PLAYBACK_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(RATE_STEP).toBe(0.25);
    for (let i = 1; i < PLAYBACK_RATES.length; i++) expect(PLAYBACK_RATES[i]! - PLAYBACK_RATES[i - 1]!).toBe(RATE_STEP);
  });
  it('isPlaybackRate takes exactly those', () => {
    for (const r of PLAYBACK_RATES) expect(isPlaybackRate(r), String(r)).toBe(true);
    for (const r of [0, 0.25, 0.3, 0.6, 1.1, 2.25, 2.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(isPlaybackRate(r), String(r)).toBe(false);
  });
  it('the timings: controls hide after 2 s, the stage settles in 2 s, a frame is 1/30 s by default, skips are 5 and 10 s', () => {
    expect(VIDEO_TIMING).toEqual({ controlsIdleMs: 2000, stageSettleMs: 2000, frameFallbackMs: 1000 / 30, skipShortMs: 5000, skipLongMs: 10000 });
  });
});

describe('the video settings', () => {
  it('video.playbackRate: a rate of the list; 0.3 and 2.5 are refused on the way in and on the way out', () => {
    for (const r of PLAYBACK_RATES) expect(parseSetting('video.playbackRate', r)).toBe(r);
    for (const v of [0.3, 2.5, 0, '1', null, true]) {
      expect(code(() => parseSetting('video.playbackRate', v)), String(v)).toBe('VALIDATION_FAILED');
      expect(SETTINGS['video.playbackRate'].safeParse(v).success, String(v)).toBe(false);
    }
  });
  it('video.volume: 0 to 1', () => {
    for (const v of [0, 0.35, 1]) expect(parseSetting('video.volume', v)).toBe(v);
    for (const v of [-0.01, 1.01, Number.NaN, '0.5', null]) expect(code(() => parseSetting('video.volume', v)), String(v)).toBe('VALIDATION_FAILED');
  });
  it('video.muted: a boolean', () => {
    for (const v of [true, false]) expect(parseSetting('video.muted', v)).toBe(v);
    for (const v of [0, 1, 'true', null]) expect(code(() => parseSetting('video.muted', v)), String(v)).toBe('VALIDATION_FAILED');
  });
});

describe("the video locator's captions", () => {
  it('reads an old value without captions as it was', () => {
    const old = readingLocatorSchema.parse({ kind: 'video', timeMs: 18_000 });
    expect(old).toEqual({ kind: 'video', timeMs: 18_000 });
    expect(old).not.toHaveProperty('captions');
  });
  it('reads the chosen track and whether it is on', () => {
    const assetId = newId();
    for (const on of [true, false]) {
      const v = { kind: 'video', timeMs: 0, captions: { assetId, on } } as const;
      expect(readingLocatorSchema.parse(v)).toEqual(v);
    }
  });
  it('refuses captions whose assetId is not a uuid, or that lack a field', () => {
    for (const assetId of ['not-a-uuid', '', 42, null]) expect(readingLocatorSchema.safeParse({ kind: 'video', timeMs: 0, captions: { assetId, on: true } }).success, String(assetId)).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'video', timeMs: 0, captions: { assetId: newId() } }).success).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'video', timeMs: 0, captions: { on: true } }).success).toBe(false);
    expect(readingLocatorSchema.safeParse({ kind: 'video', timeMs: 0, captions: { assetId: newId(), on: 'yes' } }).success).toBe(false);
  });
});
