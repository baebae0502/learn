import { useMemo, type ReactNode } from 'react';
import type { LibraryItem } from '@learn/domain';
import { Toolbar } from '../shell/Toolbar';
import { useLibrary } from '../state/library-store';
import { t } from '../strings';
import { useTrashCollectionRows } from '../trash/useTrashSource';
import { countRender } from '../ui/renderCount';
import { useLibrarySettings } from './useLibrarySettings';
import { useSearch } from './useSearch';

/**
 * The library view's toolbar: the view's name and "N개 / M개" while a search or a tag filter narrows the view (M the view's
 * items, N what is left). It subscribes to the quick search itself, so a keystroke renders this and not MainWindow, which
 * hands it the same `actions` and `trailing` elements again.
 */
export function LibraryToolbar(props: {
  title: string;
  titleTip?: string;
  /** The whole list: the search index belongs to it. */
  items: readonly LibraryItem[];
  /** The view's items, before the tags and the search. */
  scoped: number;
  /** The view's items that have every chosen tag. */
  filtered: readonly LibraryItem[];
  actions: ReactNode;
  trailing: ReactNode;
}) {
  countRender('LibraryToolbar');
  const found = useSearch(props.items);
  const tagCount = useLibrary((s) => s.tagFilter.size);
  const { sort } = useLibrarySettings();
  // The trash view counts its collection rows with its items (library.html?state=trash: 휴지통 9개 = 자료 7 + 컬렉션 2).
  const collections = useTrashCollectionRows(sort);
  const shown = useMemo(
    () => (found ? props.filtered.reduce((n, i) => n + (found.ids.has(i.id) ? 1 : 0), 0) : props.filtered.length) + collections.shown.length,
    [found, props.filtered, collections.shown],
  );
  const total = props.scoped + collections.all.length;
  const count = props.items.length + collections.all.length === 0 ? undefined : found || tagCount > 0 ? t.shell.countOf(shown, total) : t.shell.count(total);
  return <Toolbar title={props.title} titleTip={props.titleTip} count={count} actions={props.actions} trailing={props.trailing} />;
}
