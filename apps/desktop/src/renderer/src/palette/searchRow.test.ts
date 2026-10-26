import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandId } from '@learn/domain';
import { useLibrary } from '../state/library-store';

const order: string[] = [];
vi.mock('../library/LibrarySearch', () => ({ focusQuickSearch: () => order.push(`focus:${useLibrary.getState().query}`) }));

import { searchLibrary } from './searchRow';

describe('라이브러리에서 ‘…’ 검색 (spec §4.4, Q-12)', () => {
  beforeEach(() => {
    order.length = 0;
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
