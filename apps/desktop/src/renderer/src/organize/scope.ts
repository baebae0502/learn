import { libraryScopeSchema, type LibraryItem, type LibraryScope } from '@learn/domain';
import { t } from '../strings';
import type { OrganizeModel } from './model';

/** The recent view's window: items opened within this many days (spec 3.2). */
export const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;
export const SCOPE_ALL: LibraryScope = Object.freeze({ kind: 'all' }) as LibraryScope;

export function sameScope(a: LibraryScope, b: LibraryScope): boolean {
  return a.kind === b.kind && (a.kind !== 'collection' || (b.kind === 'collection' && a.id === b.id));
}

/** Items opened within the last 30 days of `now` (ms), in the list's order. A date that does not read is not recent. */
export function recentItems(items: readonly LibraryItem[], now: number): readonly LibraryItem[] {
  const since = now - RECENT_DAYS * DAY_MS;
  return items.filter((i) => {
    if (i.openedAt === null) return false;
    const opened = Date.parse(i.openedAt);
    return !Number.isNaN(opened) && opened >= since;
  });
}

/**
 * The items of a scope, in the list's own order (sorting comes after). `all` is the list itself, so a memo downstream
 * keeps its identity. A scope that needs the snapshot, asked for without one, shows the whole list (resolveScope turns
 * such a scope into `all` first).
 */
export function scopeItems(model: OrganizeModel | undefined, items: readonly LibraryItem[], scope: LibraryScope, now: number): readonly LibraryItem[] {
  if (scope.kind === 'recent') return recentItems(items, now);
  if (scope.kind === 'all' || model === undefined) return items;
  switch (scope.kind) {
    case 'collection': {
      const inside = model.subtreeItems(scope.id);
      return items.filter((i) => inside.has(i.id));
    }
    case 'unfiled':
      return items.filter((i) => model.unfiled.has(i.id));
    case 'duplicates':
      return items.filter((i) => model.duplicates.has(i.id));
  }
}

/** The toolbar title: a special view by its name, a collection by its own name (its path is the tooltip). */
export function scopeLabel(model: OrganizeModel | undefined, scope: LibraryScope): string {
  switch (scope.kind) {
    case 'all':
      return t.shell.myLibrary;
    case 'recent':
      return t.organize.scopes.recent;
    case 'unfiled':
      return t.organize.scopes.unfiled;
    case 'duplicates':
      return t.organize.scopes.duplicates;
    case 'collection':
      return model?.node(scope.id)?.name ?? t.shell.myLibrary;
  }
}

/** A collection's full path ("분자생물학 › 6장 · 신호 전달"), for the title's tooltip; undefined for every other scope. */
export function scopePath(model: OrganizeModel | undefined, scope: LibraryScope): string | undefined {
  if (scope.kind !== 'collection' || model === undefined) return undefined;
  const path = model.path(scope.id);
  return path.length === 0 ? undefined : path.map((n) => n.name).join(t.organize.pathSeparator);
}

/**
 * What the table shows for the scope the user chose: a collection that is gone, or a view that needs the snapshot before
 * it arrived, shows `all`. The chosen scope itself is left as it is — an undo that brings the collection back brings the
 * view back with it.
 */
export function resolveScope(model: OrganizeModel | undefined, scope: LibraryScope): LibraryScope {
  switch (scope.kind) {
    case 'all':
    case 'recent':
      return scope;
    case 'collection':
      return model?.node(scope.id) ? scope : SCOPE_ALL;
    case 'unfiled':
    case 'duplicates':
      return model ? scope : SCOPE_ALL;
  }
}

/**
 * The view to open at start from the stored `library.view` (spec 3.1): the stored scope when it can still be shown — its
 * collection exists, the special view has content — else `all`. The unfiled view is offered only while a collection
 * exists (spec 3.2), so it needs one here too.
 */
export function restorableScope(raw: unknown, model: OrganizeModel | undefined, items: readonly LibraryItem[], now: number): LibraryScope {
  const parsed = libraryScopeSchema.safeParse(raw);
  if (!parsed.success) return SCOPE_ALL;
  const scope = parsed.data;
  switch (scope.kind) {
    case 'all':
      return scope;
    case 'recent':
      return recentItems(items, now).length > 0 ? scope : SCOPE_ALL;
    case 'collection':
      return model?.node(scope.id) ? scope : SCOPE_ALL;
    case 'unfiled':
      return model && model.collectionCount > 0 && model.unfiled.size > 0 ? scope : SCOPE_ALL;
    case 'duplicates':
      return model && model.duplicates.size > 0 ? scope : SCOPE_ALL;
  }
}
