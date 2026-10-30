import { useLayoutEffect, useMemo } from 'react';
import type { LibraryItem } from '@learn/domain';
import { resolveScope } from '../organize/scope';
import { useOrganize } from '../organize/useOrganize';
import { ScopeEmpty } from '../sidebar/ScopeEmpty';
import { useLibrary } from '../state/library-store';
import { TagFilterEmpty } from '../tags/TagFilterEmpty';
import { perfMarkLatest } from '../ui/perfMarks';
import { countRender } from '../ui/renderCount';
import { LibraryTable } from './LibraryTable';
import { SearchEmpty } from './SearchEmpty';
import { useLibraryRows } from './useLibraryRows';
import { useLibrarySettings } from './useLibrarySettings';
import { usePaintMark } from './usePaintMark';

/** The library view's content area: the table in the stored columns and sort, in the scope shown, filtered by the tags and the quick search. */
export function LibraryView({ items, onOpen, onItemMenu }: { items: readonly LibraryItem[]; onOpen(itemId: string): void; onItemMenu(itemIds: readonly string[], x: number, y: number): void }) {
  // Where a long frame's script time goes (the drop stall profile): this view's render began here.
  perfMarkLatest('table:render');
  countRender('LibraryView');
  const settings = useLibrarySettings();
  const scopeReady = useLibrary((s) => s.scopeReady);
  const { rows, titleMatches, view } = useLibraryRows(items);
  // The frame that paints these rows (spec 9: input → paint, sort → paint, list → first rows). Before the stored columns
  // and sort are read the view draws nothing, so nothing is marked.
  usePaintMark('table:painted', settings.ready ? rows : null, 'table:first-paint');
  // Rows that left the list (and, from the search, the ones it hides) leave the selection before the frame is
  // painted: no command then acts on a row that is not on screen (spec 3.3).
  const pruneSelected = useLibrary((s) => s.pruneSelected);
  useLayoutEffect(() => pruneSelected(new Set(rows.map((r) => r.id))), [rows, pruneSelected]);
  // A query typed and no row left (the deferred result): the no-results state in the body's place, under the header.
  const query = useLibrary((s) => s.query).trim();
  const noResults = titleMatches !== null && rows.length === 0 && query !== '';
  const revealId = useLibrary((s) => s.lastOpenedId);
  // A view with nothing in it and nothing that would explain it (a query, tags): the view says so (spec 3.6).
  const chosen = useLibrary((s) => s.scope);
  const tagFilterSize = useLibrary((s) => s.tagFilter.size);
  const { model } = useOrganize();
  const scope = useMemo(() => resolveScope(model, chosen), [model, chosen]);
  const scopeEmpty = rows.length === 0 && query === '' && tagFilterSize === 0 && scope.kind !== 'all';
  // The chosen tags leave no item and the search says nothing else: the filter's own empty state (spec 3.6).
  const tagEmpty = rows.length === 0 && query === '' && tagFilterSize > 0;
  const scopeName = scope.kind === 'collection' ? (model?.node(scope.id)?.name ?? '') : '';
  if (!settings.ready || !scopeReady) return null; // the stored columns, sort and view: one IPC round trip each, already in flight while the list loaded (LibraryLoading)
  return (
    <LibraryTable
      rows={rows}
      columns={settings.columns}
      forced={settings.forced}
      sort={settings.sort}
      onSortChange={settings.setSort}
      onColumnsChange={settings.setColumns}
      onOpen={onOpen}
      onContextMenu={onItemMenu}
      revealId={revealId}
      titleMatches={titleMatches}
      tagsOf={model?.tagsOfItem}
      empty={noResults ? <SearchEmpty query={query} view={view.scope.kind === 'all' ? null : view.label} tagCount={tagFilterSize} /> : scopeEmpty ? <ScopeEmpty scope={scope} name={scopeName} /> : tagEmpty ? <TagFilterEmpty /> : undefined}
    />
  );
}
