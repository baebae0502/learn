import { useMemo } from 'react';
import type { LibraryItem, LibraryScope } from '@learn/domain';
import { filterByTags } from '../organize/tagFilter';
import type { OrganizeModel } from '../organize/model';
import { resolveScope, scopeItems, scopeLabel, scopePath } from '../organize/scope';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { useNow } from '../useNow';

export interface ScopeView {
  /** The scope shown (resolveScope of the one chosen). */
  scope: LibraryScope;
  model: OrganizeModel | undefined;
  /** The toolbar title. */
  label: string;
  /** A collection's full path, for the title's tooltip. */
  tooltip: string | undefined;
  /** The items of the scope: what "M" counts in "N개 / M개". */
  scoped: readonly LibraryItem[];
  /** The scope's items that have every chosen tag. */
  filtered: readonly LibraryItem[];
}

/**
 * The first two steps of the table's rows (spec 3.1): the scope, then the tag filter — pure selectors over the snapshot,
 * no IPC. The quick search and the sort come after (useLibraryRows). `now` renews at midnight (useNow), which is when an
 * item can leave the recent view.
 */
export function useScopeView(items: readonly LibraryItem[]): ScopeView {
  const chosen = useLibrary((s) => s.scope);
  const tagFilter = useLibrary((s) => s.tagFilter);
  const { model } = useOrganize();
  const now = useNow().getTime();
  const scope = useMemo(() => resolveScope(model, chosen), [model, chosen]);
  const scoped = useMemo(() => scopeItems(model, items, scope, now), [model, items, scope, now]);
  const filtered = useMemo(() => (model ? filterByTags(model, scoped, tagFilter) : scoped), [model, scoped, tagFilter]);
  return { scope, model, label: scopeLabel(model, scope), tooltip: scopePath(model, scope), scoped, filtered };
}
