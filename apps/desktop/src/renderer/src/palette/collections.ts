import { parseQuery } from '../library/search';
import type { CollectionNode, OrganizeModel } from '../organize/model';
import { t } from '../strings';
import { matchKorean, type Match } from './hangul';

/** Spec 7.2: the 컬렉션 group lists five at most. */
export const COLLECTION_RESULTS_MAX = 5;

export interface RankedCollection {
  node: CollectionNode;
  /** Where the first query word matched the name (for <mark>). */
  match: Match;
  /** "분자생물학 안 · 14개" (mockup): the parent's name and the collection's count; just "14개" at the top level. */
  secondary: string;
}

const collator = new Intl.Collator('ko', { numeric: true });

/** Where the first query word is in `name`, or null when any word is missing: every word must be in the name. */
function nameMatch(name: string, words: readonly string[]): Match | null {
  let first: Match | null = null;
  for (const word of words) {
    const m = matchKorean(word, name);
    if (!m) return null;
    first ??= m;
  }
  return first;
}

/** Negative when `a` ranks first: the earlier match, then the shorter path, then the name (then the id, so nothing swaps between renders). */
function rank(a: { node: CollectionNode; match: Match }, b: { node: CollectionNode; match: Match }, model: OrganizeModel): number {
  return (
    a.match.start - b.match.start ||
    model.path(a.node.id).length - model.path(b.node.id).length ||
    collator.compare(a.node.name, b.node.name) ||
    (a.node.id < b.node.id ? -1 : 1)
  );
}

/**
 * The 컬렉션 group for a palette query (spec 7.2): the collections whose NAME holds every word of the query (letters or
 * 초성, as the item search reads a word), the best `max` by `rank`. A selection over the tree in one pass, like rankItems.
 */
export function rankCollections(model: OrganizeModel, query: string, max = COLLECTION_RESULTS_MAX): RankedCollection[] {
  const words = parseQuery(query).map((term) => term.text);
  if (words.length === 0 || max <= 0) return [];
  const top: Array<{ node: CollectionNode; match: Match }> = [];
  for (const node of model.flat) {
    const match = nameMatch(node.name, words);
    if (!match) continue;
    const entry = { node, match };
    let at = top.length;
    while (at > 0 && rank(entry, top[at - 1]!, model) < 0) at--;
    if (at === max) continue;
    top.splice(at, 0, entry);
    if (top.length > max) top.pop();
  }
  return top.map(({ node, match }) => {
    const parent = model.path(node.id).at(-2);
    return { node, match, secondary: t.palette.collectionMeta(parent?.name ?? null, model.count(node.id)) };
  });
}
