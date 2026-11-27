import { describe, expect, it } from 'vitest';
import type { Cue } from '@learn/domain';
import { jumpSearch, jumpTrack } from './timeJump';

const cue = (startMs: number, endMs: number, text: string): Cue => ({ startMs, endMs, text });
const CUES = [cue(0, 3500, '세포막'), cue(19_000, 22_500, '칼슘 펌프는'), cue(23_000, 26_500, 'ATP'), cue(34_500, 38_000, '칼슘 이온과 펌프가')];

describe('jumpSearch: the transcript search a time row leaves behind', () => {
  it('puts the whole query in when the cue at the row\'s time holds it, and marks that cue', () => {
    const r = jumpSearch(CUES, '칼슘 펌프', 19_000);
    expect(r.query).toBe('칼슘 펌프');
    expect(r.hits.map((h) => h.index)).toEqual([1]);
    expect(r.hit).toBe(0);
  });
  it('reads the query as the transcript does: case and spaces do not matter', () => {
    expect(jumpSearch([cue(0, 1000, 'The  ATP pump')], 'atp PUMP', 0).query).toBe('atp PUMP');
  });
  it('falls back to one word of the query when the cue holds the words apart', () => {
    // cue 3 has both words but not side by side: the field takes the longest word, as the PDF's find bar does
    const r = jumpSearch(CUES, '칼슘 펌프', 34_500);
    expect(r.query).toBe('칼슘');
    expect(r.hits.map((h) => h.index)).toEqual([1, 3]);
    expect(r.hit).toBe(1);
  });
  it('marks the first match on or after the time when no matching cue starts there', () => {
    expect(jumpSearch(CUES, '칼슘', 20_000).hit).toBe(0);
    expect(jumpSearch(CUES, '칼슘', 30_000).hit).toBe(1);
  });
  it('marks nothing when the cues changed under the row and nothing matches', () => {
    expect(jumpSearch(CUES, '없는말', 19_000)).toEqual({ query: '없는말', hits: [], hit: -1 });
  });
});

describe('jumpTrack: which track a time row shows', () => {
  const listed = [{ assetId: 'ko' }, { assetId: 'en' }];
  it('the asked track when the video still has it', () => {
    expect(jumpTrack('en', listed, 'ko')).toBe('en');
  });
  it('the track shown now when none is asked (a video with one track) or the asked one was removed since', () => {
    expect(jumpTrack(null, listed, 'ko')).toBe('ko');
    expect(jumpTrack('gone', listed, 'ko')).toBe('ko');
  });
  it('none for a video with no track', () => {
    expect(jumpTrack('gone', [], null)).toBeNull();
    expect(jumpTrack(null, [], null)).toBeNull();
  });
});
