import { useQuery } from '@tanstack/react-query';
import type { Cue, SubtitleTrack } from '@learn/domain';
import { api, unwrap } from '../../api';
import { keys } from '../../data/queries';

/** A video's subtitle tracks in their order; undefined until read. subtitles:changed reads them again (data/queries useSubtitlesSync). */
export function useTracks(itemId: string | null): SubtitleTrack[] | undefined {
  return useQuery({
    queryKey: keys.subtitleTracks(itemId ?? ''),
    queryFn: async () => (await unwrap(api().subtitles.list({ itemId: itemId! }))).tracks,
    enabled: itemId !== null,
  }).data;
}

/** One track's cues in start order; undefined until read, and while no track is chosen. */
export function useCues(itemId: string | null, assetId: string | null): Cue[] | undefined {
  return useQuery({
    queryKey: keys.subtitleCues(itemId ?? '', assetId ?? ''),
    queryFn: async () => (await unwrap(api().subtitles.cues({ itemId: itemId!, assetId: assetId! }))).cues,
    enabled: itemId !== null && assetId !== null,
  }).data;
}
