import type { SubtitleTrack } from '@learn/domain';
import { t } from '../../strings';

/** The Korean names of languages; a engine without them leaves the codes as they are. */
function displayNames(): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(['ko'], { type: 'language' });
  } catch {
    return null;
  }
}

/**
 * What the screen calls each track (spec 3.8), by asset: the language in Korean ("한국어", "영어(미국)"), a code the engine rejects as it
 * is, "자막 N" for no language (N is the track's place, from 1), and " 2", " 3" after the first of a name that comes again.
 */
export function trackNames(tracks: readonly SubtitleTrack[]): Map<string, string> {
  const names = displayNames();
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  tracks.forEach((track, i) => {
    let base: string;
    if (track.language === null) base = t.video.untitledTrack(i + 1);
    else {
      try {
        base = names?.of(track.language) ?? track.language;
      } catch {
        base = track.language;
      }
    }
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(track.assetId, n === 1 ? base : `${base} ${n}`);
  });
  return out;
}
