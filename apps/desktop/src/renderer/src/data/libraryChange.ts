import type { LearnEventMap, LibraryChangeReason, LibraryItem } from '@learn/domain';

/** Ids per notice that are read one by one (spec 10.3); more than this reads the whole list. */
export const NARROW_LIMIT = 500;
/** The reasons that change an item's own row and nothing about which items exist. */
const NARROW: ReadonlySet<LibraryChangeReason> = new Set<LibraryChangeReason>(['metadata', 'relink', 'availability', 'opened']);

export interface ChangeDeps {
  /** The list in the query cache, or undefined before it was first read. */
  cached(): readonly LibraryItem[] | undefined;
  /** A read of the whole list is running. */
  refetching(): boolean;
  /** Stores a patched list. */
  put(prev: readonly LibraryItem[], next: readonly LibraryItem[]): void;
  getItems(ids: string[]): Promise<LibraryItem[]>;
  /** Everything under ['library']: the list, the snapshot, the search texts, every item and detail. */
  invalidateAll(): void;
  invalidateOrganize(): void;
  invalidateItem(itemId: string): void;
  invalidateTexts(): void;
}

const same = (a: LibraryItem, b: LibraryItem): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The list with `fresh` put over its rows, or null when it cannot be patched: an item that was asked for did not come
 * back (it left the library) or one came back that the list has no row for. An unchanged list comes back as it is.
 */
function patched(list: readonly LibraryItem[], ids: readonly string[], fresh: readonly LibraryItem[]): readonly LibraryItem[] | null {
  const byId = new Map(fresh.map((i) => [i.id, i]));
  if (ids.some((id) => !byId.has(id))) return null;
  const at = new Map(list.map((i, k) => [i.id, k]));
  let next: LibraryItem[] | null = null;
  for (const item of fresh) {
    const k = at.get(item.id);
    if (k === undefined) return null;
    if (same(list[k]!, item)) continue;
    next ??= [...list];
    next[k] = item;
  }
  return next ?? list;
}

/**
 * What the renderer reads again after `libraryChanged` (spec 10.3). Collections and tags change only the snapshot. A
 * change to the rows of known items (metadata, relink, availability, opened) with 1–500 ids reads those items and puts
 * them into the cached list; everything else reads the whole list. A patch that a whole-list read overtook is dropped
 * (the whole read has the change), and a patch that cannot be applied falls back to the whole read.
 */
export function createChangeHandler(d: ChangeDeps): (change: LearnEventMap['libraryChanged']) => void {
  let epoch = 0;
  const everything = (): void => {
    epoch += 1;
    d.invalidateAll();
  };
  return ({ reason, itemIds }) => {
    if (reason === 'collections' || reason === 'tags') {
      d.invalidateOrganize();
      return;
    }
    const ids = itemIds === undefined ? [] : [...new Set(itemIds)];
    if (!NARROW.has(reason) || ids.length === 0 || ids.length > NARROW_LIMIT || d.cached() === undefined || d.refetching()) {
      everything();
      return;
    }
    const started = epoch;
    for (const id of ids) d.invalidateItem(id);
    if (reason === 'metadata') d.invalidateTexts();
    d.getItems(ids).then(
      (fresh) => {
        if (started !== epoch) return;
        const list = d.cached();
        const next = list === undefined ? null : patched(list, ids, fresh);
        if (list === undefined || next === null) everything();
        else if (next !== list) d.put(list, next);
      },
      () => everything(),
    );
  };
}
