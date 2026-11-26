import { describe, expect, it } from 'vitest';
import type { Cue } from '@learn/domain';
import { activeCues, cueIndexAt, indexCues } from './activeCues';

const cue = (startMs: number, endMs: number, text = `${startMs}`): Cue => ({ startMs, endMs, text });

describe('activeCues (spec 6.4)', () => {
  const overlap = indexCues([cue(0, 5000), cue(1000, 2000), cue(3000, 6000)]);
  it('lists every cue on at the playhead in start order', () => {
    expect(activeCues(overlap, 1500)).toEqual([0, 1]);
    expect(activeCues(overlap, 4000)).toEqual([0, 2]);
    expect(activeCues(overlap, 2500)).toEqual([0]);
    expect(activeCues(overlap, 5500)).toEqual([2]);
  });
  it('is empty before the first cue, between cues and after the last', () => {
    const ix = indexCues([cue(1000, 2000), cue(5000, 6000)]);
    expect(activeCues(ix, 500)).toEqual([]);
    expect(activeCues(ix, 3000)).toEqual([]);
    expect(activeCues(ix, 7000)).toEqual([]);
    expect(activeCues(indexCues([]), 0)).toEqual([]);
  });
  it('keeps the last three when more than three overlap', () => {
    const ix = indexCues([cue(0, 9000), cue(100, 9000), cue(200, 9000), cue(300, 9000), cue(9000, 9500)]);
    expect(activeCues(ix, 1000)).toEqual([1, 2, 3]);
    expect(activeCues(ix, 1000, 2)).toEqual([2, 3]);
  });
  it('starts a cue at its start and ends it before its end', () => {
    const ix = indexCues([cue(1000, 2000)]);
    expect(activeCues(ix, 999)).toEqual([]);
    expect(activeCues(ix, 1000)).toEqual([0]);
    expect(activeCues(ix, 1999)).toEqual([0]);
    expect(activeCues(ix, 2000)).toEqual([]);
  });
  it('puts cues that arrive out of order in start order', () => {
    const ix = indexCues([cue(5000, 6000, 'b'), cue(1000, 2000, 'a')]);
    expect(ix.cues.map((c) => c.text)).toEqual(['a', 'b']);
    expect(activeCues(ix, 1500)).toEqual([0]);
  });
  it('stops looking back once nothing earlier can still be on', () => {
    const ix = indexCues([cue(0, 100), cue(1000, 1100), cue(2000, 2100)]);
    expect(Array.from(ix.maxEnd)).toEqual([100, 1100, 2100]);
    expect(activeCues(ix, 2050)).toEqual([2]);
  });
});

describe('cueIndexAt', () => {
  const ix = indexCues([cue(1000, 2000), cue(5000, 6000), cue(5000, 5500)]);
  it('is the last cue that has started: -1 before the first, the last after the end', () => {
    expect(cueIndexAt(ix, 0)).toBe(-1);
    expect(cueIndexAt(ix, 999)).toBe(-1);
    expect(cueIndexAt(ix, 1000)).toBe(0);
    expect(cueIndexAt(ix, 3000)).toBe(0);
    expect(cueIndexAt(ix, 5000)).toBe(2);
    expect(cueIndexAt(ix, 99_999)).toBe(2);
  });
});

describe('speed (spec 14)', () => {
  it('answers ten thousand lookups in a track of twenty thousand cues in under 50 ms', () => {
    const cues = Array.from({ length: 20_000 }, (_, i) => cue(i * 1000, i * 1000 + 1500));
    const ix = indexCues(cues);
    const t0 = performance.now();
    let seen = 0;
    for (let i = 0; i < 10_000; i++) seen += activeCues(ix, (i * 1999) % 20_000_000).length;
    expect(performance.now() - t0).toBeLessThan(50);
    expect(seen).toBeGreaterThan(0);
  });
});
