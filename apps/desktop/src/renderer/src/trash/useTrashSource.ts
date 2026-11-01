import { useDeferredValue, useEffect, useMemo } from 'react';
import type { LibraryItem, TrashedCollection } from '@learn/domain';
import { useItems, useTrashView } from '../data/queries';
import type { LibrarySort } from '../library/sort';
import type { OrganizeModel } from '../organize/model';
import { SCOPE_ALL } from '../organize/scope';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { trashCollectionRows, trashModelFor } from './trashRows';

const NONE: readonly TrashedCollection[] = Object.freeze([]);

/** The trash view shows (spec 4.3): it was chosen, and the trash has something — an empty trash has no view (resolveScope). */
export function useInTrash(): boolean {
  const chosen = useLibrary((s) => s.scope.kind === 'trash');
  const count = useOrganize().model?.trashCount ?? 0;
  return chosen && count > 0;
}

/** The trash view's read (P-8, library:trashView), only while it shows. */
export function useTrash() {
  return useTrashView(useInTrash());
}

/** The list the library view shows: the trashed items in the trash view, else the library's live items. */
export function useViewItems(): readonly LibraryItem[] | undefined {
  const inTrash = useInTrash();
  const live = useItems().data;
  const trash = useTrashView(inTrash).data;
  return inTrash ? trash?.items : live;
}

/** The organize model of the view shown: the trash's (its items' places and tags, Q-6a) in the trash view, else the library's. */
export function useViewModel(): OrganizeModel | undefined {
  const inTrash = useInTrash();
  const { snapshot, model } = useOrganize();
  const trash = useTrashView(inTrash).data;
  return useMemo(() => (!inTrash ? model : snapshot && trash ? trashModelFor(snapshot, trash) : undefined), [inTrash, model, snapshot, trash]);
}

/**
 * The trash view's collection rows (spec 4.3): all of them (the count), and those the quick search and the tag filter leave,
 * in `sort` (the table and the toolbar). None in any other view. `query` is the deferred one the table's rows use.
 */
export function useTrashCollectionRows(sort: LibrarySort): { all: readonly TrashedCollection[]; shown: readonly TrashedCollection[]; query: string } {
  const inTrash = useInTrash();
  const view = useTrashView(inTrash).data;
  const query = useDeferredValue(useLibrary((s) => s.query));
  const tagFiltered = useLibrary((s) => s.tagFilter.size > 0);
  const all = inTrash ? (view?.collections ?? NONE) : NONE;
  const shown = useMemo(() => (all.length === 0 ? NONE : trashCollectionRows(all, { sort, query, tagFiltered })), [all, sort, query, tagFiltered]);
  return { all, shown, query };
}

/** An emptied trash closes its view for good (spec 4.3: no empty state — the last row restored or purged goes to 내 라이브러리). */
export function useLeaveEmptyTrash(): void {
  const chosen = useLibrary((s) => s.scope.kind === 'trash');
  const { model } = useOrganize();
  const emptied = model !== undefined && model.trashCount === 0;
  useEffect(() => {
    if (chosen && emptied) useLibrary.getState().setScope(SCOPE_ALL);
  }, [chosen, emptied]);
}

/** An import asked for in the trash view shows the library it lands in (the approved mockup: the trash has no 가져오기, Q-6i). */
export function leaveTrashView(): void {
  const s = useLibrary.getState();
  if (s.scope.kind === 'trash') s.setScope(SCOPE_ALL);
}
