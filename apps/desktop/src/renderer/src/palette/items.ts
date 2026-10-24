import type { LibraryItem } from '@learn/domain';
import type { SearchResult } from '../library/search';
import { t } from '../strings';
import { initialOf, type Match } from './hangul';

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

/**
 * The 자료 group: the quick search's matches (search.ts, the same rules), title matches first — the earlier in the title
 * the higher — then matches in other fields; a tie goes to the last opened, then the newest added, then the id (stable).
 */
export function rankItems(items: readonly LibraryItem[], result: SearchResult, max = ITEM_RESULTS_MAX): RankedItem[] {
  return items
    .filter((item) => result.ids.has(item.id))
    .map((item) => ({ item, match: result.titleMatches.get(item.id) ?? null }))
    .sort(
      (a, b) =>
        Number(a.match === null) - Number(b.match === null) ||
        (a.match && b.match ? a.match.start - b.match.start : 0) ||
        larger(openedAt(a.item), openedAt(b.item)) ||
        larger(a.item.createdAt, b.item.createdAt) ||
        -larger(a.item.id, b.item.id),
    )
    .slice(0, max);
}

/** Right of the title (spec §4.4): 저자 · 연도, whichever there are; the kind when there is neither. */
export function itemMeta(item: Pick<LibraryItem, 'creators' | 'year' | 'type'>): string {
  const parts = [item.creators.join(', '), item.year === null ? '' : String(item.year)].filter((p) => p !== '');
  return parts.length > 0 ? parts.join(' · ') : t.library.type[item.type];
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
