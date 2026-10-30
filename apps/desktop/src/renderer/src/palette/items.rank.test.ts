import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { item } from '../organize/testing';
import type { SearchResult } from '../library/search';
import type { Match } from './hangul';
import { matchScore, rankItems } from './items';

/** The ranking written the way M4 did it — every match mapped, sorted, then cut — with the same rules (spec 7.2). */
function bySorting(items: readonly LibraryItem[], result: SearchResult, max: number) {
  const opened = (i: LibraryItem) => (i.openedAt === null ? -Infinity : Date.parse(i.openedAt));
  return items
    .filter((i) => result.ids.has(i.id))
    .map((i) => ({ item: i, match: result.titleMatches.get(i.id) ?? null }))
    .sort(
      (a, b) =>
        matchScore(a.match) - matchScore(b.match) ||
        opened(b.item) - opened(a.item) ||
        (a.item.createdAt === b.item.createdAt ? 0 : a.item.createdAt > b.item.createdAt ? -1 : 1) ||
        (a.item.id < b.item.id ? -1 : 1),
    )
    .slice(0, max);
}

/** mulberry32: the same sequence on every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const KINDS: Match['kind'][] = ['exact', 'prefix', 'word', 'substring', 'initials'];

/** `count` items: a few start values and few opened/created dates, so scores and tie-breaks both collide often. */
function fixture(count: number, seed: number): { items: LibraryItem[]; result: { ids: Set<string>; titleMatches: Map<string, Match> } } {
  const rand = rng(seed);
  const items: LibraryItem[] = [];
  const ids = new Set<string>();
  const titleMatches = new Map<string, Match>();
  for (let n = 0; n < count; n++) {
    const id = `i${String(n).padStart(5, '0')}`;
    items.push(
      item(id, {
        createdAt: `2026-10-0${1 + Math.floor(rand() * 3)}T00:00:00.000Z`,
        openedAt: rand() < 0.3 ? `2026-10-1${Math.floor(rand() * 3)}T09:00:00.000Z` : null,
      }),
    );
    if (rand() < 0.9) ids.add(id);
    if (ids.has(id) && rand() < 0.7) {
      const start = Math.floor(rand() * 4);
      titleMatches.set(id, { start, end: start + 2, kind: KINDS[Math.floor(rand() * KINDS.length)]! });
    }
  }
  return { items, result: { ids, titleMatches } };
}

describe('palette 자료 ranking: the same order as sorting every match (spec 7.2)', () => {
  it('a letter match ranks above a 초성 match whatever their offsets; a match outside the title comes last', () => {
    const match = (start: number, kind: Match['kind']): Match => ({ start, end: start + 2, kind });
    expect(matchScore(match(9, 'substring'))).toBeLessThan(matchScore(match(0, 'initials')));
    expect(matchScore(match(0, 'initials'))).toBeLessThan(matchScore(null));
    expect(matchScore(match(1, 'exact'))).toBeGreaterThan(matchScore(match(0, 'word')));
    expect(matchScore(match(0, 'prefix'))).toBe(matchScore(match(0, 'word'))); // letters share a class: the offset decides
  });

  it('agrees with the full sort for every cut, on a list full of equal scores and equal dates', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { items, result } = fixture(400, seed);
      for (const max of [1, 5, 17, 400]) {
        const fast = rankItems(items, result, max);
        const slow = bySorting(items, result, max);
        expect(fast.map((r) => r.item.id), `seed ${seed}, top ${max}`).toEqual(slow.map((r) => r.item.id));
        expect(fast.map((r) => r.match)).toEqual(slow.map((r) => r.match));
      }
    }
  });

  it('asks for nothing, or from nothing, and gets nothing', () => {
    const { items, result } = fixture(20, 9);
    expect(rankItems(items, result, 0)).toEqual([]);
    expect(rankItems(items, { ids: new Set(), titleMatches: new Map() })).toEqual([]);
  });
});

describe('palette 자료 ranking at 10,000 matches (spec 7.2, 12)', () => {
  it('picks the top five by partial selection, in a fraction of the time sorting every match takes', () => {
    const { items, result } = fixture(10_000, 7);
    for (const id of items.map((i) => i.id)) result.ids.add(id); // every item matches: the worst case for a sort
    const time = (run: () => void): number => {
      const t0 = performance.now();
      run();
      return performance.now() - t0;
    };
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    rankItems(items, result); // warm both
    bySorting(items, result, 5);
    const partial = median(Array.from({ length: 7 }, () => time(() => rankItems(items, result))));
    const sorting = median(Array.from({ length: 7 }, () => time(() => bySorting(items, result, 5))));
    console.info(`[measure] palette 자료 ranking, 10,000 matches: sorting every match ${sorting.toFixed(2)} ms, partial selection ${partial.toFixed(2)} ms`);
    expect(rankItems(items, result).map((r) => r.item.id)).toEqual(bySorting(items, result, 5).map((r) => r.item.id));
    expect(partial).toBeLessThan(sorting / 2);
  });
});
