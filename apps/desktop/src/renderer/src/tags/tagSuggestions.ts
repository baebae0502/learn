import type { OrganizeTag } from '@learn/domain';
import { MATCH_RANK, matchKorean } from '../palette/hangul';

/** The most suggestions the add field shows (spec 6.1). */
export const SUGGESTIONS_MAX = 8;
const collator = new Intl.Collator('ko', { numeric: true });

/**
 * The existing tags that fit what is typed, for the add field (spec 6.1): not the ones in `exclude`, matched like the
 * palette does (NFC lower-case substring, 초성, a last syllable still being composed). A name that starts with the query
 * comes first, then one with a word that does, then one that has it inside, then 초성 matches; ties by name, numbers by value.
 */
export function suggestTags(tags: readonly OrganizeTag[], exclude: ReadonlySet<string>, query: string, limit: number = SUGGESTIONS_MAX): OrganizeTag[] {
  if (query.trim() === '') return [];
  const hits: Array<{ tag: OrganizeTag; rank: number; start: number }> = [];
  for (const tag of tags) {
    if (exclude.has(tag.id)) continue;
    const match = matchKorean(query, tag.name);
    if (match) hits.push({ tag, rank: MATCH_RANK[match.kind], start: match.start });
  }
  hits.sort((a, b) => a.rank - b.rank || a.start - b.start || collator.compare(a.tag.name, b.tag.name));
  return hits.slice(0, limit).map((h) => h.tag);
}
