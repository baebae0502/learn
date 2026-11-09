import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { item } from '../organize/testing';
import type { OrganizeModel } from '../organize/model';
import type { ScopeView } from './useScopeView';

// useMemo with real dependency semantics, one slot per call in render order (the repo tests hooks without a DOM).
const memo = vi.hoisted(() => ({ slots: [] as Array<{ deps: readonly unknown[]; value: unknown }>, at: 0 }));
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  useMemo: <T,>(fn: () => T, deps: readonly unknown[]): T => {
    const slot = memo.slots[memo.at];
    if (slot && slot.deps.length === deps.length && slot.deps.every((d, k) => Object.is(d, deps[k]))) {
      memo.at += 1;
      return slot.value as T;
    }
    const value = fn();
    memo.slots[memo.at++] = { deps, value };
    return value;
  },
}));
const sorted = vi.hoisted(() => ({ calls: 0 }));
vi.mock('./sort', async (orig) => {
  const real = await orig<typeof import('./sort')>();
  return { ...real, sortItems: (...a: Parameters<typeof real.sortItems>) => ((sorted.calls += 1), real.sortItems(...a)) };
});
const ctx = vi.hoisted(() => ({ view: null as unknown }));
const SORT = vi.hoisted(() => ({ column: 'title', direction: 'asc' }));
vi.mock('./useLibrarySettings', () => ({ useLibrarySettings: () => ({ sort: SORT }) }));
vi.mock('./ScopeViewContext', () => ({ useScopeViewContext: () => ctx.view }));
vi.mock('./useSearch', () => ({ useSearch: () => null }));

import { keepFound, useLibraryRows } from './useLibraryRows';

const model = (groups: Record<string, number>): OrganizeModel => ({ duplicateGroupOf: (id: string) => groups[id] }) as unknown as OrganizeModel;
function render(view: Partial<ScopeView>): LibraryItem[] {
  ctx.view = view;
  memo.at = 0;
  return [...useLibraryRows([]).rows];
}
beforeEach(() => {
  memo.slots = [];
  memo.at = 0;
  sorted.calls = 0;
});

describe('the sort depends on the organise model only in the duplicates view (key 1)', () => {
  const filtered = [item('b'), item('a'), item('c')];
  it('a new model (a tag toggled) does not sort the rows again in the library view', () => {
    render({ scope: { kind: 'all' }, filtered, model: model({}) });
    expect(sorted.calls).toBe(1);
    render({ scope: { kind: 'all' }, filtered, model: model({}) });
    expect(sorted.calls).toBe(1);
  });
  it('positive control: a new list sorts again, and the duplicates view sorts again for a new model, grouped as before', () => {
    render({ scope: { kind: 'all' }, filtered, model: model({}) });
    render({ scope: { kind: 'all' }, filtered: [...filtered], model: model({}) });
    expect(sorted.calls).toBe(2);
    sorted.calls = 0;
    memo.slots = [];
    expect(render({ scope: { kind: 'duplicates' }, filtered, model: model({ a: 1, b: 2, c: 2 }) }).map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(sorted.calls).toBe(1);
    expect(render({ scope: { kind: 'duplicates' }, filtered, model: model({ a: 2, b: 1, c: 2 }) }).map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(sorted.calls).toBe(2);
  });
});

describe('the rows the quick search keeps', () => {
  const rows: LibraryItem[] = [item('a'), item('b'), item('c')];
  it('keeps the matching rows in the given order, and every row for no search', () => {
    expect(keepFound(rows, null)).toBe(rows);
    expect(keepFound(rows, { ids: new Set(['c', 'a']), titleMatches: new Map() }).map((i) => i.id)).toEqual(['a', 'c']);
    expect(keepFound(rows, { ids: new Set(), titleMatches: new Map() })).toEqual([]);
  });
});
