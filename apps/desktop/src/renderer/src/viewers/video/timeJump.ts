import type { Cue } from '@learn/domain';
import { findInCues, hitAtOrAfter, type CueHit } from './transcriptSearch';

/**
 * What a 본문 일치 time row leaves in the transcript search: the cues that have the query and the match marked current, the one whose cue
 * starts at the row's time (else the first on or after it, as the pane marks the match on the playhead's side). -1 when nothing matches.
 */
export function jumpSearch(cues: readonly Cue[], query: string, startMs: number): { hits: CueHit[]; hit: number } {
  const hits = findInCues(cues, query);
  const exact = hits.findIndex((h) => cues[h.index]?.startMs === startMs);
  return { hits, hit: exact >= 0 ? exact : hitAtOrAfter(hits, cues, startMs) };
}
