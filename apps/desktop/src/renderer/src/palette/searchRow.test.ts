import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '@learn/domain';
import { useLibrary } from '../state/library-store';

const order: string[] = [];
vi.mock('../data/saveSetting', () => ({ saveSetting: vi.fn() }));
vi.mock('../library/LibrarySearch', () => ({ focusQuickSearch: () => order.push(`focus:${useLibrary.getState().query}`) }));

import { searchLibrary, showCollection } from './searchRow';

describe('라이브러리에서 ‘…’ 검색 (spec §4.4, Q-12)', () => {
  beforeEach(() => {
    order.length = 0;
    useLibrary.setState({ scope: { kind: 'all' }, tagFilter: new Set() });
    useLibrary.getState().setQuery('');
  });

  it('puts the query into the quick search first, then focuses its field (the table filters as if it had been typed)', () => {
    const run = vi.fn((_id: CommandId) => true);
    searchLibrary('신호', run, 'library');
    expect(run).not.toHaveBeenCalled();
    expect(useLibrary.getState().query).toBe('신호');
    expect(order).toEqual(['focus:신호']);
  });

  it('goes back to the library through the registry (nav.back) before it hands the query over, when the reader shows', () => {
    const run = vi.fn((id: CommandId) => (order.push(`run:${id}`), true));
    searchLibrary('신호', run, 'viewer');
    expect(run).toHaveBeenCalledWith('nav.back');
    expect(order).toEqual(['run:nav.back', 'focus:신호']);
    expect(useLibrary.getState().query).toBe('신호');
  });
});

describe("a collection row (spec 7.2) and the search row's view", () => {
  beforeEach(() => {
    order.length = 0;
    useLibrary.setState({ scope: { kind: 'all' }, tagFilter: new Set() });
    useLibrary.getState().setQuery('');
  });

  it('shows the collection in the table and leaves the query alone', () => {
    const run = vi.fn((_id: CommandId) => true);
    useLibrary.getState().setQuery('신호');
    showCollection('c-1', run, 'library');
    expect(run).not.toHaveBeenCalled();
    expect(useLibrary.getState().scope).toEqual({ kind: 'collection', id: 'c-1' });
    expect(useLibrary.getState().query).toBe('신호');
  });

  it('from the reader it goes back to the library first (nav.back through the registry)', () => {
    const run = vi.fn((id: CommandId) => (order.push(`run:${id}`), true));
    showCollection('c-1', run, 'viewer');
    expect(order).toEqual(['run:nav.back']);
    expect(useLibrary.getState().scope).toEqual({ kind: 'collection', id: 'c-1' });
  });

  it('라이브러리에서 ‘…’ 검색 returns a narrower view to 내 라이브러리 and leaves 내 라이브러리, with its tag filter, as it is', () => {
    const run = vi.fn((_id: CommandId) => true);
    useLibrary.setState({ scope: { kind: 'collection', id: 'c-1' } });
    searchLibrary('신호', run, 'library');
    expect(useLibrary.getState().scope).toEqual({ kind: 'all' });
    expect(useLibrary.getState().query).toBe('신호');
    useLibrary.setState({ scope: { kind: 'all' }, tagFilter: new Set(['t-1']) });
    searchLibrary('증폭', run, 'library');
    expect([...useLibrary.getState().tagFilter]).toEqual(['t-1']); // no view change: the filter is not cleared
  });
});
