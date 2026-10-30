import { flushSync } from 'react-dom';
import type { CommandContextState, CommandId } from '@learn/domain';
import { focusQuickSearch } from '../library/LibrarySearch';
import { SCOPE_ALL } from '../organize/scope';
import { useLibrary } from '../state/library-store';

/**
 * 라이브러리에서 ‘…’ 검색 (spec §4.4): back to the library when the reader shows (nav.back, through the registry), the
 * view to 내 라이브러리 when it is a narrower one (the row says 라이브러리, and the 자료 rows above it searched all of it),
 * the query into the quick search — the table filters as if it had been typed there — and the focus in its field with the
 * query selected, as ⌘F leaves it (focusQuickSearch). Synchronous, so the field is mounted (the library view's toolbar)
 * before it takes the focus.
 */
export function searchLibrary(query: string, run: (id: CommandId) => boolean, view: CommandContextState['view']): void {
  flushSync(() => {
    if (view === 'viewer') run('nav.back');
    const library = useLibrary.getState();
    if (library.scope.kind !== 'all') library.setScope(SCOPE_ALL);
    library.setQuery(query);
  });
  focusQuickSearch();
}

/** ↩ on a 컬렉션 row (spec 7.2): the library shows that collection — from the reader, back to the library first. The query stays. */
export function showCollection(collectionId: string, run: (id: CommandId) => boolean, view: CommandContextState['view']): void {
  flushSync(() => {
    if (view === 'viewer') run('nav.back');
    useLibrary.getState().setScope({ kind: 'collection', id: collectionId });
  });
}
