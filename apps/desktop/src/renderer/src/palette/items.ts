import type { LibraryItem } from '@learn/domain';
import { parseQuery, type SearchResult } from '../library/search';
import { t } from '../strings';
import { initialOf, matchKorean, type Match } from './hangul';

/** Spec §4.4: the 자료 group lists five at most. */
export const ITEM_RESULTS_MAX = 5;

export interface RankedItem {
  item: LibraryItem;
  /** Where the query matched the title (for <mark>); null when only another field matched. */
  match: Match | null;
}

const openedAt = (i: LibraryItem): number => (i.openedAt === null ? -Infinity : Date.parse(i.openedAt));
/** -1 when `a` comes first (the larger value), 1 when `b` does, 0 when equal. */
const larger = (a: number | string, b: number | string): number => (a === b ? 0 : a > b ? -1 : 1);

/** A 초성 match scores past every letter match, and a match outside the title past every 초성 match (a title is far shorter than 2^20 characters). */
const INITIALS = 1 << 20;
const NO_TITLE = 1 << 21;

/**
 * How well the title matched, lower first (spec 7.2): a letter match by its offset, then a 초성 match by its offset
 * (ㅅㅎ reads 신호, but a title that holds 신호 itself is the better answer), then rows that matched in another field.
 */
export function matchScore(match: Match | null): number {
  if (match === null) return NO_TITLE;
  return (match.kind === 'initials' ? INITIALS : 0) + match.start;
}

interface Scored extends RankedItem {
  score: number;
}

/** Among equal scores: the last opened, then the newest added, then the id (stable). Negative when `a` comes first. */
const tieBreak = (a: LibraryItem, b: LibraryItem): number => larger(openedAt(a), openedAt(b)) || larger(a.createdAt, b.createdAt) || -larger(a.id, b.id);

/**
 * The 자료 group: the quick search's matches (search.ts, the same rules) ranked by `matchScore`, the best `max` kept. Each
 * match is scored once and only a row that could enter the top `max` is compared further — a partial selection over the
 * matches instead of sorting all of them on every keystroke (measured at 10,000 matches in items.rank.test.ts). The dates behind
 * a tie are parsed only for rows that tie.
 */
export function rankItems(items: readonly LibraryItem[], result: SearchResult, max = ITEM_RESULTS_MAX): RankedItem[] {
  const top: Scored[] = [];
  if (max <= 0) return [];
  for (const item of items) {
    if (!result.ids.has(item.id)) continue;
    const match = result.titleMatches.get(item.id) ?? null;
    const score = matchScore(match);
    if (top.length === max && score > top[max - 1]!.score) continue; // worse than everything kept: nothing to compare
    let at = top.length;
    while (at > 0 && (score < top[at - 1]!.score || (score === top[at - 1]!.score && tieBreak(item, top[at - 1]!.item) < 0))) at--;
    if (at === max) continue; // ties with the last kept and loses the tie-break
    top.splice(at, 0, { item, match, score });
    if (top.length > max) top.pop();
  }
  return top.map(({ item, match }) => ({ item, match }));
}

/** Right of the title (spec §4.4): 저자 · 연도, whichever there are; the kind when there is neither. */
export function itemMeta(item: Pick<LibraryItem, 'creators' | 'year' | 'type'>): string {
  const parts = [item.creators.join(', '), item.year === null ? '' : String(item.year)].filter((p) => p !== '');
  return parts.length > 0 ? parts.join(' · ') : t.library.type[item.type];
}

/**
 * Where the query matched in the row's 저자 · 연도 (for <mark>), the first query word found: a row the author or the year
 * brought in, with nothing marked in its title, then shows why it is there. null on the kind (it is not searched).
 */
export function itemMetaMatch(item: Pick<LibraryItem, 'creators' | 'year' | 'type'>, query: string): Match | null {
  if (item.creators.length === 0 && item.year === null) return null;
  const meta = itemMeta(item);
  for (const term of parseQuery(query)) {
    const m = matchKorean(term.text, meta);
    if (m) return m;
  }
  return null;
}

const HANGUL_WORD = /^[가-힣]{2,4}$/;

/**
 * The 초성 example of the key hints (spec §4.4, palette.html "ㅅㅎ → 신호"): from the first title, in list order (newest
 * first), that has a word of two to four Hangul syllables. null: none has one (the hint then says ㅅㅈ → 설정).
 */
export function initialsExample(items: Iterable<Pick<LibraryItem, 'title'>>): { initials: string; word: string } | null {
  for (const { title } of items) {
    for (const word of title.normalize('NFC').split(/[^가-힣]+/)) {
      if (HANGUL_WORD.test(word)) return { initials: [...word].map(initialOf).join(''), word };
    }
  }
  return null;
}
