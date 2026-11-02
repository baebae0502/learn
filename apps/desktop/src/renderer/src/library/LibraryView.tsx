import { useLayoutEffect, useMemo } from 'react';
import { duplicateMarks } from '../organize/duplicates';
import type { LibraryItem } from '@learn/domain';
import { resolveScope } from '../organize/scope';
import { ScopeEmpty } from '../sidebar/ScopeEmpty';
import { useLibrary } from '../state/library-store';
import { TagFilterEmpty } from '../tags/TagFilterEmpty';
import { useTrashCollectionRows, useViewModel } from '../trash/useTrashSource';
import { perfMarkLatest } from '../ui/perfMarks';
import { countRender } from '../ui/renderCount';
import { LibraryTable } from './LibraryTable';
import { SearchEmpty } from './SearchEmpty';
import { useLibraryRows } from './useLibraryRows';
import { useLibrarySettings } from './useLibrarySettings';
import { usePaintMark } from './usePaintMark';

/** The trash view opens nothing (spec 4.3): ↩ and a double-click on its rows do nothing. */
const OPENS_NOTHING = (): void => {};

/** The library view's content area: the table in the stored columns and sort, in the scope shown, filtered by the tags and the quick search. */
export function LibraryView({ items, onOpen, onItemMenu }: { items: readonly LibraryItem[]; onOpen(itemId: string): void; onItemMenu(ids: readonly string[], x: number, y: number): void }) {
  // Where a long frame's script time goes (the drop stall profile): this view's render began here.
  perfMarkLatest('table:render');
  countRender('LibraryView');
  const settings = useLibrarySettings();
  const scopeReady = useLibrary((s) => s.scopeReady);
  const { rows, titleMatches, view } = useLibraryRows(items);
  // The trash view's collection rows (spec 4.3, P-9): above its items in the same table; none in any other view.
  const collections = useTrashCollectionRows(settings.sort);
  // The frame that paints these rows (spec 9: input → paint, sort → paint, list → first rows). Before the stored columns
  // and sort are read the view draws nothing, so nothing is marked.
  usePaintMark('table:painted', settings.ready ? rows : null, 'table:first-paint');
  // Rows that left the list (and, from the search, the ones it hides) leave the selection before the frame is
  // painted: no command then acts on a row that is not on screen (spec 3.3).
  const pruneSelected = useLibrary((s) => s.pruneSelected);
  useLayoutEffect(() => pruneSelected(new Set([...collections.shown.map((c) => c.id), ...rows.map((r) => r.id)])), [rows, collections.shown, pruneSelected]);
  // A query typed and no row left (the deferred result): the no-results state in the body's place, under the header.
  const query = useLibrary((s) => s.query).trim();
  const shownRows = rows.length + collections.shown.length;
  const noResults = titleMatches !== null && shownRows === 0 && query !== '';
  const revealId = useLibrary((s) => s.lastOpenedId);
  const chosen = useLibrary((s) => s.scope);
  const tagFilterSize = useLibrary((s) => s.tagFilter.size);
  const model = useViewModel();
  const scope = useMemo(() => resolveScope(model, chosen), [model, chosen]);
  const trash = scope.kind === 'trash';
  // 중복 항목: the rows that stay (남김) and the line above each group after the first.
  const marks = useMemo(() => (scope.kind === 'duplicates' && model ? duplicateMarks(rows, model) : null), [scope.kind, model, rows]);
  // A view with nothing in it and nothing that would explain it (spec 3.6). The trash has none: emptied, it closes.
  const scopeEmpty = rows.length === 0 && query === '' && tagFilterSize === 0 && scope.kind !== 'all' && !trash;
  // The chosen tags leave no item and the search says nothing else: the filter's own empty state (spec 3.6).
  const tagEmpty = shownRows === 0 && query === '' && tagFilterSize > 0;
  const scopeName = scope.kind === 'collection' ? (model?.node(scope.id)?.name ?? '') : '';
  if (!settings.ready || !scopeReady) return null; // the stored columns, sort and view: one IPC round trip each, already in flight while the list loaded (LibraryLoading)
  return (
    <LibraryTable
      rows={rows}
      collectionRows={collections.shown}
      collectionQuery={collections.query}
      draggable={!trash}
      columns={settings.columns}
      forced={settings.forced}
      sort={settings.sort}
      onSortChange={settings.setSort}
      onColumnsChange={settings.setColumns}
      onOpen={trash ? OPENS_NOTHING : onOpen}
      onContextMenu={onItemMenu}
      revealId={revealId}
      titleMatches={titleMatches}
      tagsOf={model?.tagsOfItem}
      duplicateMarks={marks}
      empty={noResults ? <SearchEmpty query={query} view={view.scope.kind === 'all' ? null : view.label} tagCount={tagFilterSize} /> : scopeEmpty ? <ScopeEmpty scope={scope} name={scopeName} /> : tagEmpty ? <TagFilterEmpty /> : undefined}
    />
  );
}
