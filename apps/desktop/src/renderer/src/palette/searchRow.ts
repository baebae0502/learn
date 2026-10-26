import { flushSync } from 'react-dom';
import type { CommandContextState, CommandId } from '@learn/domain';
import { focusQuickSearch } from '../library/LibrarySearch';
import { useLibrary } from '../state/library-store';

/**
 * 라이브러리에서 ‘…’ 검색 (spec §4.4): back to the library when the reader shows (nav.back, through the registry), the
 * query into the quick search — the table filters as if it had been typed there — and the focus in its field with the
 * query selected, as ⌘F leaves it (focusQuickSearch). Synchronous, so the field is mounted (the library view's
 * toolbar) before it takes the focus.
 */
export function searchLibrary(query: string, run: (id: CommandId) => boolean, view: CommandContextState['view']): void {
  flushSync(() => {
    if (view === 'viewer') run('nav.back');
    useLibrary.getState().setQuery(query);
  });
  focusQuickSearch();
}
