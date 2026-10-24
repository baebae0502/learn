import { useLayoutEffect } from 'react';
import type { LibraryItem } from '@learn/domain';
import { useLibrary } from '../state/library-store';
import { LibraryTable } from './LibraryTable';
import { SearchEmpty } from './SearchEmpty';
import { useLibraryRows } from './useLibraryRows';
import { useLibrarySettings } from './useLibrarySettings';

/** The library view's content area: the table in the stored columns and sort, filtered by the quick search. */
export function LibraryView({ items, onOpen, onItemMenu }: { items: readonly LibraryItem[]; onOpen(itemId: string): void; onItemMenu(itemIds: readonly string[], x: number, y: number): void }) {
  const settings = useLibrarySettings();
  const { rows, titleMatches } = useLibraryRows(items);
  // Rows that left the list (and, from the search, the ones it hides) leave the selection before the frame is
  // painted: no command then acts on a row that is not on screen (spec 3.3).
  const pruneSelected = useLibrary((s) => s.pruneSelected);
  useLayoutEffect(() => pruneSelected(new Set(rows.map((r) => r.id))), [rows, pruneSelected]);
  // A query typed and no row left (the deferred result): the no-results state in the body's place, under the header.
  const query = useLibrary((s) => s.query).trim();
  const noResults = titleMatches !== null && rows.length === 0 && query !== '';
  const revealId = useLibrary((s) => s.lastOpenedId);
  if (!settings.ready) return null; // one IPC round trip, already in flight while the list loaded (LibraryLoading)
  return (
    <LibraryTable
      rows={rows}
      columns={settings.columns}
      sort={settings.sort}
      onSortChange={settings.setSort}
      onColumnsChange={settings.setColumns}
      onOpen={onOpen}
      onContextMenu={onItemMenu}
      revealId={revealId}
      titleMatches={titleMatches}
      empty={noResults ? <SearchEmpty query={query} /> : undefined}
    />
  );
}
