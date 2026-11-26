import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '@learn/domain';
import { trackNames } from './trackNames';

const track = (assetId: string, language: string | null, position = 0): SubtitleTrack => ({ assetId, language, position, originalName: `${assetId}.srt`, cueCount: 3 });
const names = (languages: (string | null)[]): string[] => {
  const tracks = languages.map((l, i) => track(`a${i}`, l, i));
  const named = trackNames(tracks);
  return tracks.map((t) => named.get(t.assetId)!);
};

describe('trackNames (spec 3.8)', () => {
  it('names a language by its Korean display name', () => {
    expect(names(['ko', 'en'])).toEqual(['한국어', '영어']);
    expect(names(['en-US'])).toEqual(['영어(미국)']);
    expect(names(['fil'])).toEqual(['필리핀어']);
  });
  it('numbers a track with no language by its place in the order', () => {
    expect(names([null, null])).toEqual(['자막 1', '자막 2']);
    expect(names(['ko', null])).toEqual(['한국어', '자막 2']);
  });
  it('tells two tracks of one name apart from the second on', () => {
    expect(names(['ko', 'ko'])).toEqual(['한국어', '한국어 2']);
    expect(names(['ko', 'ko', 'ko'])).toEqual(['한국어', '한국어 2', '한국어 3']);
  });
  it('shows a code the engine does not accept as it is', () => {
    expect(names(['xx-invalid!'])).toEqual(['xx-invalid!']);
  });
});
