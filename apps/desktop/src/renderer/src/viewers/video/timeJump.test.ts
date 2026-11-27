import { describe, expect, it } from 'vitest';
import type { Cue } from '@learn/domain';
import { jumpSearch } from './timeJump';

const cue = (startMs: number, endMs: number, text: string): Cue => ({ startMs, endMs, text });
const CUES = [cue(0, 3500, '세포막'), cue(19_000, 22_500, '칼슘 펌프는'), cue(23_000, 26_500, 'ATP'), cue(34_500, 38_000, '칼슘 펌프가')];

describe('jumpSearch: the transcript search a time row leaves behind', () => {
  it('finds every cue with the query and marks the one that starts at the row\'s time', () => {
    const r = jumpSearch(CUES, '칼슘', 34_500);
    expect(r.hits.map((h) => h.index)).toEqual([1, 3]);
    expect(r.hit).toBe(1);
  });
  it('marks the first match on or after the time when no matching cue starts there', () => {
    expect(jumpSearch(CUES, '칼슘', 20_000).hit).toBe(0);
    expect(jumpSearch(CUES, '칼슘', 30_000).hit).toBe(1);
  });
  it('marks nothing when the cues changed under the row and nothing matches', () => {
    expect(jumpSearch(CUES, '없는말', 19_000)).toEqual({ hits: [], hit: -1 });
  });
});
