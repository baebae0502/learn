import { useLayoutEffect } from 'react';
import type { LibraryItem } from '@learn/domain';
import { useLibrary } from '../state/library-store';
import { LibraryTable } from './LibraryTable';
import { useLibraryRows } from './useLibraryRows';
import { useLibrarySettings } from './useLibrarySettings';

/** The library view's content area: the table in the stored columns and sort; the search comes with the feature that needs it. */
export function LibraryView({ items, onOpen, onItemMenu }: { items: readonly LibraryItem[]; onOpen(itemId: string): void; onItemMenu(itemIds: readonly string[], x: number, y: number): void }) {
  const settings = useLibrarySettings();
  const { rows } = useLibraryRows(items);
  // Rows that left the list (and, from the search, the ones it hides) leave the selection before the frame is
  // painted: no command then acts on a row that is not on screen (spec 3.3).
  const pruneSelected = useLibrary((s) => s.pruneSelected);
  useLayoutEffect(() => pruneSelected(new Set(rows.map((r) => r.id))), [rows, pruneSelected]);
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
    />
  );
}
