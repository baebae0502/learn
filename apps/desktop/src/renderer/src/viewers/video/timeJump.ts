import { findWordOf, type Cue } from '@learn/domain';
import { findInCues, hitAtOrAfter, type CueHit } from './transcriptSearch';

/** The track a time row asks for if the video still has it; otherwise (no track named, or it was removed since) the one shown now. */
export function jumpTrack(asked: string | null, listed: ReadonlyArray<{ assetId: string }>, current: string | null): string | null {
  return asked !== null && listed.some((track) => track.assetId === asked) ? asked : current;
}

/**
 * What a 본문 일치 time row leaves in the transcript search. The query as typed goes in when the cue at the row's time holds it (as the
 * transcript's own matching reads it: case, accents and line breaks do not matter), so the field and the marks are the ones the panel
 * searched for; otherwise one word of it does (findWordOf: the cue holds every word of the query, not always side by side). The match
 * marked current is the cue that starts at the row's time, else the first on or after it; -1 when nothing matches.
 */
export function jumpSearch(cues: readonly Cue[], query: string, startMs: number): { query: string; hits: CueHit[]; hit: number } {
  const at = (hits: readonly CueHit[]): number => hits.findIndex((h) => cues[h.index]?.startMs === startMs);
  const whole = findInCues(cues, query);
  const word = at(whole) >= 0 ? query : findWordOf(query);
  const hits = word === query ? whole : findInCues(cues, word);
  const exact = at(hits);
  return { query: word, hits, hit: exact >= 0 ? exact : hitAtOrAfter(hits, cues, startMs) };
}
