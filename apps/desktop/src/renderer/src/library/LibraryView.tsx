import type { LibraryItem } from '@learn/domain';
import { LibraryTable } from './LibraryTable';
import { useLibraryRows } from './useLibraryRows';
import { useLibrarySettings } from './useLibrarySettings';

/** The library view's content area: the table in the stored columns and sort; the reveal and the search come with the features that need them. */
export function LibraryView({ items, onOpen, onItemMenu }: { items: readonly LibraryItem[]; onOpen(itemId: string): void; onItemMenu(itemIds: readonly string[], x: number, y: number): void }) {
  const settings = useLibrarySettings();
  const { rows } = useLibraryRows(items);
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
    />
  );
}
