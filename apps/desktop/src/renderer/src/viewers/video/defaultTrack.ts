import type { SubtitleTrack } from '@learn/domain';

const isKorean = (language: string | null): boolean => language === 'ko' || (language?.startsWith('ko-') ?? false);

/**
 * The track a video opens on (spec 4.4): the remembered one if it is still attached, else the first Korean one (the owner reads Korean:
 * with English and Korean both, Korean shows first), else the first; a default is on. No track is no choice and off.
 */
export function pickTrack(tracks: readonly SubtitleTrack[], saved: { assetId: string; on: boolean } | undefined): { trackId: string | null; on: boolean } {
  if (saved && tracks.some((t) => t.assetId === saved.assetId)) return { trackId: saved.assetId, on: saved.on };
  const first = tracks.find((t) => isKorean(t.language)) ?? tracks[0];
  return first ? { trackId: first.assetId, on: true } : { trackId: null, on: false };
}
